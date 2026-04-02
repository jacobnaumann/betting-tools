import { useEffect, useMemo, useRef, useState } from 'react';
import { useBetLab } from '../state/BetLabContext';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000';
const DEFAULT_SEASON_PHASES = ['early', 'mid', 'late', 'postseason'];
const LOCATION_OPTIONS = ['H', 'N', 'V'];
const DEFAULT_BASE_TRANSFORMS = ['diff', 'avg', 'ratio', 'interaction'];

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function toNumberOrEmpty(value) {
  if (value === '' || value === null || value === undefined) return '';
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : '';
}

function formatMetric(value, digits = 4) {
  return Number.isFinite(value) ? value.toFixed(digits) : '-';
}

function formatDelta(primary, baseline) {
  if (!Number.isFinite(primary) || !Number.isFinite(baseline)) return '-';
  const delta = baseline - primary;
  const sign = delta >= 0 ? '+' : '';
  return `${sign}${delta.toFixed(4)}`;
}

function toLlmJsonClipboardText(payload) {
  return JSON.stringify(payload, null, 2);
}

function uniqueStrings(values) {
  return [...new Set(asArray(values).filter((value) => typeof value === 'string' && value.trim()))];
}

function formatSavedDate(value) {
  if (!value) return '-';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '-';
  return parsed.toLocaleDateString('en-US');
}

function pickRaeValue(metricsBucket) {
  if (!metricsBucket) return null;
  if (Number.isFinite(metricsBucket.rae)) return metricsBucket.rae;
  if (Number.isFinite(metricsBucket.mae)) return metricsBucket.mae;
  return null;
}

function getSavedModelSortValue(item, key) {
  switch (key) {
    case 'date': {
      const timestamp = new Date(item.createdAt || '').getTime();
      return Number.isFinite(timestamp) ? timestamp : null;
    }
    case 'name':
      return String(item.name || '').toLowerCase();
    case 'features':
      return Number.isFinite(item.featureCount) ? item.featureCount : null;
    case 'rows':
      return Number.isFinite(item.rowCounts?.modelRows) ? item.rowCounts.modelRows : null;
    case 'testCorrelation':
      return Number.isFinite(item.metrics?.crossValidation?.correlation) ? item.metrics.crossValidation.correlation : null;
    case 'testRmse':
      return Number.isFinite(item.metrics?.crossValidation?.rmse) ? item.metrics.crossValidation.rmse : null;
    case 'testRae':
      return pickRaeValue(item.metrics?.crossValidation);
    case 'heldCorrelation':
      return Number.isFinite(item.metrics?.test?.correlation) ? item.metrics.test.correlation : null;
    case 'heldRmse':
      return Number.isFinite(item.metrics?.test?.rmse) ? item.metrics.test.rmse : null;
    case 'heldRae':
      return pickRaeValue(item.metrics?.test);
    case 'actions':
      return String(item.name || '').toLowerCase();
    default:
      return null;
  }
}

function createDefaultConfig() {
  return {
    poolFilters: {
      seasonStartYearMin: 2016,
      seasonStartYearMax: 2025,
      dateFrom: '',
      dateTo: '',
      seasonPhases: [],
      locations: ['H', 'N'],
      conferenceMode: 'any',
    },
    featureConfig: {
      statFeatureRules: [],
      selectedStatColumns: [],
      statTransforms: [],
      crossStatPairs: [],
    },
    modelSettings: {
      ridgeAlpha: 0.25,
      folds: 10,
      splitMode: 'chronological',
      trainRatio: 0.9,
      seed: 42,
      advanced: {
        symmetricAugmentation: true,
        targetCapEnabled: true,
        targetCapMin: -40,
        targetCapMax: 40,
        predictorNormalization: 'zscore_train',
        targetNormalization: 'none',
      },
    },
  };
}

function toRequestConfig(config) {
  return {
    poolFilters: {
      ...config.poolFilters,
      seasonStartYearMin: toNumberOrEmpty(config.poolFilters.seasonStartYearMin),
      seasonStartYearMax: toNumberOrEmpty(config.poolFilters.seasonStartYearMax),
    },
    featureConfig: {
      statFeatureRules: config.featureConfig.statFeatureRules,
      selectedStatColumns: [],
      statTransforms: [],
      crossStatPairs: [],
    },
    modelSettings: {
      ridgeAlpha: Number(config.modelSettings.ridgeAlpha),
      folds: Number(config.modelSettings.folds),
      splitMode: config.modelSettings.splitMode,
      trainRatio: Number(config.modelSettings.trainRatio),
      seed: Number(config.modelSettings.seed),
      advanced: {
        symmetricAugmentation: Boolean(config.modelSettings.advanced?.symmetricAugmentation),
        targetCapEnabled: Boolean(config.modelSettings.advanced?.targetCapEnabled),
        targetCapMin: Number(config.modelSettings.advanced?.targetCapMin),
        targetCapMax: Number(config.modelSettings.advanced?.targetCapMax),
        predictorNormalization: config.modelSettings.advanced?.predictorNormalization || 'zscore_train',
        targetNormalization: config.modelSettings.advanced?.targetNormalization || 'none',
      },
    },
  };
}

export function BasketballModelingTool() {
  const { addHistoryItem } = useBetLab();
  const [config, setConfig] = useState(createDefaultConfig);
  const [meta, setMeta] = useState(null);
  const [loadingMeta, setLoadingMeta] = useState(false);
  const [searchStat, setSearchStat] = useState('');
  const searchStatInputRef = useRef(null);

  const [preview, setPreview] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const [validation, setValidation] = useState(null);
  const [validationLoading, setValidationLoading] = useState(false);

  const [runSummary, setRunSummary] = useState(null);
  const [runDetails, setRunDetails] = useState(null);
  const [runLoading, setRunLoading] = useState(false);
  const [saveModelLoading, setSaveModelLoading] = useState(false);
  const [copiedRunResults, setCopiedRunResults] = useState(false);
  const [savedModels, setSavedModels] = useState([]);
  const [savedModelsLoading, setSavedModelsLoading] = useState(false);
  const [loadModelLoadingId, setLoadModelLoadingId] = useState('');
  const [deleteModelLoadingId, setDeleteModelLoadingId] = useState('');
  const [copyModelLoadingId, setCopyModelLoadingId] = useState('');
  const [copiedModelId, setCopiedModelId] = useState('');
  const [isLoadModelModalOpen, setIsLoadModelModalOpen] = useState(false);
  const [savedModelsSort, setSavedModelsSort] = useState({
    key: 'date',
    direction: 'desc',
  });

  const [predictForm, setPredictForm] = useState({
    runId: '',
    seasonStartYear: 2025,
    team1: '',
    team2: '',
  });
  const [predictionResult, setPredictionResult] = useState(null);
  const [predictionLoading, setPredictionLoading] = useState(false);
  const [error, setError] = useState('');
  const predictionResultsRef = useRef(null);

  const availableStats = asArray(meta?.statsColumns);
  const uniqueAvailableStats = useMemo(() => [...new Set(availableStats)], [availableStats]);
  const baseTransforms = useMemo(() => {
    const supported = asArray(meta?.supportedStatTransforms).map((value) => String(value).replace(/^cross_/, ''));
    return supported.length ? [...new Set(supported)] : DEFAULT_BASE_TRANSFORMS;
  }, [meta?.supportedStatTransforms]);

  const selectedRuleStatsSet = useMemo(
    () => new Set(asArray(config.featureConfig.statFeatureRules).map((rule) => rule.statColumn)),
    [config.featureConfig.statFeatureRules]
  );

  const filteredStats = useMemo(() => {
    const query = searchStat.trim().toLowerCase();
    if (!query) return uniqueAvailableStats.slice(0, 120);
    return uniqueAvailableStats.filter((value) => value.toLowerCase().includes(query)).slice(0, 120);
  }, [uniqueAvailableStats, searchStat]);

  const sortedSavedModels = useMemo(() => {
    const directionMultiplier = savedModelsSort.direction === 'asc' ? 1 : -1;
    return [...savedModels].sort((left, right) => {
      const leftValue = getSavedModelSortValue(left, savedModelsSort.key);
      const rightValue = getSavedModelSortValue(right, savedModelsSort.key);

      const leftIsNullish = leftValue === null || leftValue === undefined;
      const rightIsNullish = rightValue === null || rightValue === undefined;

      if (leftIsNullish && rightIsNullish) return 0;
      if (leftIsNullish) return 1;
      if (rightIsNullish) return -1;

      let comparison = 0;
      if (typeof leftValue === 'string' || typeof rightValue === 'string') {
        comparison = String(leftValue).localeCompare(String(rightValue), undefined, {
          numeric: true,
          sensitivity: 'base',
        });
      } else {
        comparison = Number(leftValue) - Number(rightValue);
      }

      return comparison * directionMultiplier;
    });
  }, [savedModels, savedModelsSort]);

  useEffect(() => {
    const loadMeta = async () => {
      setLoadingMeta(true);
      setError('');
      try {
        const response = await fetch(`${API_BASE_URL}/api/tools/basketball-modeling/meta`);
        const json = await response.json();
        if (!response.ok || !json?.ok) {
          throw new Error(json?.error || 'Failed to load basketball modeling metadata.');
        }
        setMeta(json.data);
      } catch (requestError) {
        setError(requestError.message || 'Failed to load basketball modeling metadata.');
      } finally {
        setLoadingMeta(false);
      }
    };

    loadMeta();
  }, []);

  const updatePoolFilter = (key, value) => {
    setConfig((previous) => ({
      ...previous,
      poolFilters: {
        ...previous.poolFilters,
        [key]: value,
      },
    }));
  };

  const toggleLocation = (location) => {
    setConfig((previous) => {
      const set = new Set(previous.poolFilters.locations);
      if (set.has(location)) set.delete(location);
      else set.add(location);
      return {
        ...previous,
        poolFilters: {
          ...previous.poolFilters,
          locations: [...set],
        },
      };
    });
  };

  const toggleSeasonPhase = (phase) => {
    setConfig((previous) => {
      const set = new Set(previous.poolFilters.seasonPhases);
      if (set.has(phase)) set.delete(phase);
      else set.add(phase);
      return {
        ...previous,
        poolFilters: {
          ...previous.poolFilters,
          seasonPhases: [...set],
        },
      };
    });
  };

  const addStatRule = (statColumn) => {
    setConfig((previous) => {
      const existing = asArray(previous.featureConfig.statFeatureRules);
      if (existing.some((rule) => rule.statColumn === statColumn)) return previous;

      return {
        ...previous,
        featureConfig: {
          ...previous.featureConfig,
          statFeatureRules: [
            ...existing,
            {
              statColumn,
              transforms: ['diff'],
              enableCrossPair: false,
              crossPairStatColumn: statColumn,
              crossTransforms: ['diff'],
            },
          ],
        },
      };
    });
  };

  const updateStatRule = (index, patch) => {
    setConfig((previous) => ({
      ...previous,
      featureConfig: {
        ...previous.featureConfig,
        statFeatureRules: asArray(previous.featureConfig.statFeatureRules).map((rule, ruleIndex) =>
          ruleIndex === index ? { ...rule, ...patch } : rule
        ),
      },
    }));
  };

  const removeStatRule = (index) => {
    setConfig((previous) => ({
      ...previous,
      featureConfig: {
        ...previous.featureConfig,
        statFeatureRules: asArray(previous.featureConfig.statFeatureRules).filter((_, ruleIndex) => ruleIndex !== index),
      },
    }));
  };

  const toggleRuleBaseTransform = (index, transform) => {
    const currentRule = asArray(config.featureConfig.statFeatureRules)[index];
    if (!currentRule) return;
    const set = new Set(asArray(currentRule.transforms));
    if (set.has(transform)) set.delete(transform);
    else set.add(transform);
    updateStatRule(index, { transforms: [...set] });
  };

  const toggleCrossPairEnabled = (index) => {
    const currentRule = asArray(config.featureConfig.statFeatureRules)[index];
    if (!currentRule) return;
    const nextEnabled = !currentRule.enableCrossPair;
    updateStatRule(index, {
      enableCrossPair: nextEnabled,
      crossPairStatColumn: currentRule.crossPairStatColumn || currentRule.statColumn,
    });
  };

  const updateModelSetting = (key, value) => {
    setConfig((previous) => ({
      ...previous,
      modelSettings: {
        ...previous.modelSettings,
        [key]: value,
      },
    }));
  };

  const updateAdvancedSetting = (key, value) => {
    setConfig((previous) => ({
      ...previous,
      modelSettings: {
        ...previous.modelSettings,
        advanced: {
          ...previous.modelSettings.advanced,
          [key]: value,
        },
      },
    }));
  };

  const runPreview = async () => {
    setPreviewLoading(true);
    setError('');
    setPreview(null);

    try {
      const response = await fetch(`${API_BASE_URL}/api/tools/basketball-modeling/preview-pool`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ poolFilters: config.poolFilters }),
      });
      const json = await response.json();
      if (!response.ok || !json?.ok) {
        throw new Error(json?.error || 'Failed to preview results pool.');
      }
      setPreview(json.data);
    } catch (requestError) {
      setError(requestError.message || 'Failed to preview results pool.');
    } finally {
      setPreviewLoading(false);
    }
  };

  const runValidation = async () => {
    setValidationLoading(true);
    setError('');
    setValidation(null);
    try {
      const response = await fetch(`${API_BASE_URL}/api/tools/basketball-modeling/validate-config`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(toRequestConfig(config)),
      });
      const json = await response.json();
      setValidation({
        ok: Boolean(json?.ok),
        errors: asArray(json?.errors),
        warnings: asArray(json?.warnings),
      });
      if (!response.ok && !json?.ok && !asArray(json?.errors).length) {
        throw new Error(json?.error || 'Config validation failed.');
      }
    } catch (requestError) {
      setError(requestError.message || 'Failed to validate config.');
    } finally {
      setValidationLoading(false);
    }
  };

  const runModel = async () => {
    setRunLoading(true);
    setError('');
    setRunSummary(null);
    setRunDetails(null);
    setPredictionResult(null);
    try {
      const response = await fetch(`${API_BASE_URL}/api/tools/basketball-modeling/run`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(toRequestConfig(config)),
      });
      const json = await response.json();
      if (!response.ok || !json?.ok) {
        throw new Error(json?.error || 'Failed to run ridge model.');
      }
      setRunSummary(json.data);
      setPredictForm((previous) => ({
        ...previous,
        runId: json.data.runId,
      }));
    } catch (requestError) {
      setError(requestError.message || 'Failed to run ridge model.');
    } finally {
      setRunLoading(false);
    }
  };

  const loadRunDetails = async () => {
    if (!runSummary?.runId) return;
    setError('');
    try {
      const response = await fetch(`${API_BASE_URL}/api/tools/basketball-modeling/run/${runSummary.runId}`);
      const json = await response.json();
      if (!response.ok || !json?.ok) {
        throw new Error(json?.error || 'Failed to load run details.');
      }
      setRunDetails(json.data);
    } catch (requestError) {
      setError(requestError.message || 'Failed to load run details.');
    }
  };

  const runPrediction = async () => {
    setPredictionLoading(true);
    setError('');
    setPredictionResult(null);
    try {
      const response = await fetch(`${API_BASE_URL}/api/tools/basketball-modeling/predict`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          runId: predictForm.runId,
          seasonStartYear: Number(predictForm.seasonStartYear),
          team1: predictForm.team1,
          team2: predictForm.team2,
        }),
      });
      const json = await response.json();
      if (!response.ok || !json?.ok) {
        throw new Error(json?.error || 'Failed to predict matchup.');
      }
      setPredictionResult(json.data);
    } catch (requestError) {
      setError(requestError.message || 'Failed to predict matchup.');
    } finally {
      setPredictionLoading(false);
    }
  };

  useEffect(() => {
    if (!predictionResult) return;
    predictionResultsRef.current?.scrollIntoView({
      behavior: 'smooth',
      block: 'end',
    });
  }, [predictionResult]);

  const canPredict = Boolean(predictForm.runId && predictForm.team1 && predictForm.team2);

  const onPredictSubmit = async (event) => {
    event.preventDefault();
    if (!canPredict || predictionLoading) return;
    await runPrediction();
  };

  const saveSnapshot = () => {
    if (!runSummary) return;
    addHistoryItem({
      id: `${Date.now()}-basketball-modeling`,
      toolName: 'Basketball Modeling',
      summary: `Run ${runSummary.runId} | Test RMSE ${formatMetric(runSummary.metrics?.test?.rmse, 3)}`,
    });
  };

  const saveModel = async () => {
    if (!runSummary?.runId) return;
    const defaultName = `Basketball Model ${new Date().toLocaleString()}`;
    const providedName = window.prompt('Enter a name for this saved model:', defaultName);
    if (providedName === null) return;
    const name = providedName.trim();
    if (!name) {
      setError('Model name is required to save.');
      return;
    }

    setSaveModelLoading(true);
    setError('');
    try {
      const response = await fetch(`${API_BASE_URL}/api/tools/basketball-modeling/save-model`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          runId: runSummary.runId,
          name,
        }),
      });
      const json = await response.json();
      if (!response.ok || !json?.ok) {
        throw new Error(json?.error || 'Failed to save model.');
      }
    } catch (requestError) {
      setError(requestError.message || 'Failed to save model.');
    } finally {
      setSaveModelLoading(false);
    }
  };

  const fetchSavedModels = async () => {
    setSavedModelsLoading(true);
    setError('');
    try {
      const response = await fetch(`${API_BASE_URL}/api/tools/basketball-modeling/saved-models`);
      const json = await response.json();
      if (!response.ok || !json?.ok) {
        throw new Error(json?.error || 'Failed to load saved models.');
      }
      setSavedModels(asArray(json.data));
    } catch (requestError) {
      setError(requestError.message || 'Failed to load saved models.');
      setSavedModels([]);
    } finally {
      setSavedModelsLoading(false);
    }
  };

  const openLoadModelModal = async () => {
    setIsLoadModelModalOpen(true);
    await fetchSavedModels();
  };

  const loadSavedModel = async (savedModelId) => {
    setLoadModelLoadingId(savedModelId);
    setError('');
    try {
      const response = await fetch(`${API_BASE_URL}/api/tools/basketball-modeling/saved-models/${savedModelId}/load`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
      });
      const json = await response.json();
      if (!response.ok || !json?.ok) {
        throw new Error(json?.error || 'Failed to load saved model.');
      }
      if (json.data?.config) {
        setConfig(json.data.config);
      }
      setRunSummary(json.data?.runSummary || null);
      setRunDetails(null);
      setPredictionResult(null);
      setPredictForm((previous) => ({
        ...previous,
        runId: json.data?.runSummary?.runId || '',
      }));
      setIsLoadModelModalOpen(false);
    } catch (requestError) {
      setError(requestError.message || 'Failed to load saved model.');
    } finally {
      setLoadModelLoadingId('');
    }
  };

  const deleteSavedModel = async (savedModelId) => {
    const target = savedModels.find((item) => item.id === savedModelId);
    const confirmed = window.confirm(`Delete saved model "${target?.name || 'this model'}"?`);
    if (!confirmed) return;

    setDeleteModelLoadingId(savedModelId);
    setError('');
    try {
      const response = await fetch(`${API_BASE_URL}/api/tools/basketball-modeling/saved-models/${savedModelId}`, {
        method: 'DELETE',
      });
      const json = await response.json();
      if (!response.ok || !json?.ok) {
        throw new Error(json?.error || 'Failed to delete saved model.');
      }
      setSavedModels((previous) => previous.filter((item) => item.id !== savedModelId));
    } catch (requestError) {
      setError(requestError.message || 'Failed to delete saved model.');
    } finally {
      setDeleteModelLoadingId('');
    }
  };

  const toggleSavedModelsSort = (key) => {
    setSavedModelsSort((previous) => {
      if (previous.key === key) {
        return {
          key,
          direction: previous.direction === 'asc' ? 'desc' : 'asc',
        };
      }
      return {
        key,
        direction: key === 'name' ? 'asc' : 'desc',
      };
    });
  };

  const sortIndicator = (key) => {
    if (savedModelsSort.key !== key) return '↕';
    return savedModelsSort.direction === 'asc' ? '↑' : '↓';
  };

  const copyRunResultsToClipboard = async () => {
    if (!runSummary?.runId || !navigator?.clipboard) return;
    setError('');

    let details = runDetails;
    if (!details || details.runId !== runSummary.runId) {
      try {
        const response = await fetch(`${API_BASE_URL}/api/tools/basketball-modeling/run/${runSummary.runId}`);
        const json = await response.json();
        if (!response.ok || !json?.ok) {
          throw new Error(json?.error || 'Failed to load full run details for copy.');
        }
        details = json.data;
        setRunDetails(details);
      } catch (requestError) {
        setError(requestError.message || 'Failed to load full run details for copy.');
        return;
      }
    }

    const statFeatureRules = asArray(details?.config?.featureConfig?.statFeatureRules);
    const selectedStats = uniqueStrings(statFeatureRules.map((rule) => rule?.statColumn));
    const crossPairStats = uniqueStrings(statFeatureRules.map((rule) => rule?.crossPairStatColumn));

    const payload = {
      copyType: 'basketball_model_run_results',
      generatedAt: new Date().toISOString(),
      run: {
        runId: runSummary.runId,
        modelType: runSummary.modelType || 'ridge',
        createdAt: details?.createdAt || null,
        warnings: details?.warnings || runSummary.warnings || [],
      },
      config: details?.config || null,
      statsUsed: {
        selectedStats,
        crossPairStats,
        featureCount: details?.featureCount ?? runSummary.featureCount ?? null,
        featureSpecs: details?.featureSpecs || [],
      },
      results: {
        rowCounts: details?.rowCounts || runSummary.rowCounts || null,
        diagnostics: details?.diagnostics || null,
        metrics: details?.metrics || runSummary.metrics || null,
        topCoefficients: runSummary.topCoefficients || [],
        coefficients: details?.coefficients || null,
      },
    };

    await navigator.clipboard.writeText(toLlmJsonClipboardText(payload));
    setCopiedRunResults(true);
    setTimeout(() => setCopiedRunResults(false), 1200);
  };

  const copySavedModelConfigToClipboard = async (savedModelId) => {
    if (!savedModelId || !navigator?.clipboard) return;
    setCopyModelLoadingId(savedModelId);
    setError('');
    try {
      const response = await fetch(`${API_BASE_URL}/api/tools/basketball-modeling/saved-models/${savedModelId}/export`);
      const json = await response.json();
      if (!response.ok || !json?.ok) {
        throw new Error(json?.error || 'Failed to export saved model settings.');
      }

      const payload = {
        copyType: 'basketball_model_saved_model',
        generatedAt: new Date().toISOString(),
        savedModel: json.data,
      };
      await navigator.clipboard.writeText(toLlmJsonClipboardText(payload));
      setCopiedModelId(savedModelId);
      setTimeout(() => setCopiedModelId(''), 1200);
    } catch (requestError) {
      setError(requestError.message || 'Failed to copy saved model settings.');
    } finally {
      setCopyModelLoadingId('');
    }
  };

  const clearSearchStat = () => {
    setSearchStat('');
    searchStatInputRef.current?.focus();
  };

  const resetAllState = () => {
    setConfig(createDefaultConfig());
    setSearchStat('');
    setPreview(null);
    setValidation(null);
    setRunSummary(null);
    setRunDetails(null);
    setCopiedRunResults(false);
    setPredictionResult(null);
    setPredictForm({
      runId: '',
      seasonStartYear: 2025,
      team1: '',
      team2: '',
    });
    setError('');
  };

  return (
    <section className="stack">
      <header>
        <h2>Basketball Modeling</h2>
        <p className="page-subtitle">
          Build a custom results pool, configure features, train a ridge model, and predict matchup margins.
        </p>
      </header>

      {error ? <p className="muted">{error}</p> : null}

      <div className="panel stack">
        <div className="row-between">
          <h3>Data + Model Setup</h3>
          <div className="row">
            <button type="button" className="ghost-button" onClick={openLoadModelModal}>
              Load Model
            </button>
            <button type="button" className="ghost-button" onClick={resetAllState}>
              Reset Config
            </button>
          </div>
        </div>

        <section className="stack bm-section">
          <h4>Pool Filters</h4>
          <div className="stat-grid">
            <label>
              Season Start Year Min
              <input
                className="incremental-number-input"
                type="number"
                step="1"
                value={config.poolFilters.seasonStartYearMin}
                onChange={(event) => updatePoolFilter('seasonStartYearMin', event.target.value)}
              />
            </label>
            <label>
              Season Start Year Max
              <input
                className="incremental-number-input"
                type="number"
                step="1"
                value={config.poolFilters.seasonStartYearMax}
                onChange={(event) => updatePoolFilter('seasonStartYearMax', event.target.value)}
              />
            </label>
            <label>
              Date From
              <input type="date" value={config.poolFilters.dateFrom} onChange={(e) => updatePoolFilter('dateFrom', e.target.value)} />
            </label>
            <label>
              Date To
              <input type="date" value={config.poolFilters.dateTo} onChange={(e) => updatePoolFilter('dateTo', e.target.value)} />
            </label>
          </div>

          <div className="stack">
            <strong>Locations</strong>
            <div className="chip-row">
              {LOCATION_OPTIONS.map((location) => (
                <button
                  key={location}
                  type="button"
                  className={`ghost-button ${config.poolFilters.locations.includes(location) ? 'bm-chip-active' : ''}`}
                  onClick={() => toggleLocation(location)}
                >
                  {location}
                </button>
              ))}
            </div>
          </div>

          <div className="stack">
            <strong>Conference Mode</strong>
            <select
              value={config.poolFilters.conferenceMode}
              onChange={(event) => updatePoolFilter('conferenceMode', event.target.value)}
            >
              <option value="any">Any</option>
              <option value="conference">Conference Only</option>
              <option value="non_conference">Non-Conference Only</option>
            </select>
          </div>

          <div className="stack">
            <div className="row-between">
              <strong>Season Phases</strong>
              <button type="button" className="ghost-button" onClick={() => updatePoolFilter('seasonPhases', [])}>
                Clear
              </button>
            </div>
            <div className="chip-row">
              {DEFAULT_SEASON_PHASES.map((phase) => (
                <button
                  key={phase}
                  type="button"
                  className={`ghost-button ${config.poolFilters.seasonPhases.includes(phase) ? 'bm-chip-active' : ''}`}
                  onClick={() => toggleSeasonPhase(phase)}
                >
                  {phase}
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className="stack bm-section">
          <h4>Feature Builder</h4>
          <div className="row">
            <label>
              Search Stat Columns
              <input
                ref={searchStatInputRef}
                value={searchStat}
                onChange={(event) => setSearchStat(event.target.value)}
                placeholder="offensive_efficiency"
              />
            </label>
            <button type="button" className="ghost-button" onClick={clearSearchStat} disabled={!searchStat}>
              Clear
            </button>
          </div>

          <div className="bm-scroll-list">
            {loadingMeta ? (
              <p className="muted">Loading stat columns...</p>
            ) : (
              filteredStats.map((stat) => (
                <div key={stat} className="row-between">
                  <span>{stat}</span>
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() => addStatRule(stat)}
                    disabled={selectedRuleStatsSet.has(stat)}
                  >
                    {selectedRuleStatsSet.has(stat) ? 'Added' : 'Add'}
                  </button>
                </div>
              ))
            )}
          </div>

          <div className="stack">
            <strong>Selected Stat Rules</strong>
            {asArray(config.featureConfig.statFeatureRules).length === 0 ? (
              <p className="muted">Add stats from the list above to configure transforms and optional cross pairing.</p>
            ) : (
              asArray(config.featureConfig.statFeatureRules).map((rule, index) => (
                <div key={`feature-rule-${rule.statColumn}-${index}`} className="panel bm-rule-row">
                  <div className="bm-rule-left">
                    <strong className="bm-rule-stat-name">{rule.statColumn}</strong>
                    <div className="chip-row">
                      {baseTransforms.map((transform) => (
                        <button
                          key={`base-${rule.statColumn}-${transform}`}
                          type="button"
                          className={`ghost-button ${asArray(rule.transforms).includes(transform) ? 'bm-chip-active' : ''}`}
                          onClick={() => toggleRuleBaseTransform(index, transform)}
                        >
                          {transform}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="bm-rule-right">
                    <label className="bm-checkbox-row">
                      <input
                        type="checkbox"
                        checked={Boolean(rule.enableCrossPair)}
                        onChange={() => toggleCrossPairEnabled(index)}
                      />
                      <span>Cross Pair</span>
                    </label>

                    <select
                      className="bm-cross-pair-select"
                      value={rule.crossPairStatColumn || rule.statColumn}
                      onChange={(event) => updateStatRule(index, { crossPairStatColumn: event.target.value })}
                      disabled={!rule.enableCrossPair}
                    >
                      {uniqueAvailableStats.map((stat, statIndex) => (
                        <option key={`pair-${index}-${stat}-${statIndex}`} value={stat}>
                          {stat}
                        </option>
                      ))}
                    </select>

                    <button
                      type="button"
                      className="bm-remove-x-button"
                      aria-label={`Remove ${rule.statColumn} rule`}
                      onClick={() => removeStatRule(index)}
                    >
                      X
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        <details className="bm-advanced-details">
          <summary>Advanced Modeling Options</summary>
          <div className="stack bm-advanced-body">
            <label className="bm-checkbox-row">
              <input
                type="checkbox"
                checked={Boolean(config.modelSettings.advanced?.symmetricAugmentation)}
                onChange={(event) => updateAdvancedSetting('symmetricAugmentation', event.target.checked)}
              />
              <span>Symmetric Augmentation (add reverse matchup rows)</span>
            </label>

            <label className="bm-checkbox-row">
              <input
                type="checkbox"
                checked={Boolean(config.modelSettings.advanced?.targetCapEnabled)}
                onChange={(event) => updateAdvancedSetting('targetCapEnabled', event.target.checked)}
              />
              <span>Target Cap</span>
            </label>

            <div className="stat-grid">
              <label>
                Target Cap Min
                <input
                  className="incremental-number-input"
                  type="number"
                  step="1"
                  value={config.modelSettings.advanced?.targetCapMin}
                  onChange={(event) => updateAdvancedSetting('targetCapMin', event.target.value)}
                  disabled={!config.modelSettings.advanced?.targetCapEnabled}
                />
              </label>
              <label>
                Target Cap Max
                <input
                  className="incremental-number-input"
                  type="number"
                  step="1"
                  value={config.modelSettings.advanced?.targetCapMax}
                  onChange={(event) => updateAdvancedSetting('targetCapMax', event.target.value)}
                  disabled={!config.modelSettings.advanced?.targetCapEnabled}
                />
              </label>
              <label>
                Predictor Normalization
                <select
                  value={config.modelSettings.advanced?.predictorNormalization || 'zscore_train'}
                  onChange={(event) => updateAdvancedSetting('predictorNormalization', event.target.value)}
                >
                  <option value="zscore_train">zscore_train</option>
                  <option value="none">none</option>
                </select>
              </label>
              <label>
                Target Normalization
                <select
                  value={config.modelSettings.advanced?.targetNormalization || 'none'}
                  onChange={(event) => updateAdvancedSetting('targetNormalization', event.target.value)}
                >
                  <option value="none">none</option>
                  <option value="zscore_train">zscore_train</option>
                </select>
              </label>
            </div>
          </div>
        </details>

        <section className="stack bm-section">
          <h4>Ridge Settings</h4>
          <div className="stat-grid">
            <label>
              Ridge Alpha
              <input
                className="incremental-number-input"
                type="number"
                step="0.01"
                min="0"
                value={config.modelSettings.ridgeAlpha}
                onChange={(event) => updateModelSetting('ridgeAlpha', event.target.value)}
              />
            </label>
            <label>
              Folds
              <input
                className="incremental-number-input"
                type="number"
                step="1"
                min="2"
                max="20"
                value={config.modelSettings.folds}
                onChange={(event) => updateModelSetting('folds', event.target.value)}
              />
            </label>
            <label>
              Train Ratio
              <input
                className="incremental-number-input"
                type="number"
                step="0.01"
                min="0.1"
                max="0.99"
                value={config.modelSettings.trainRatio}
                onChange={(event) => updateModelSetting('trainRatio', event.target.value)}
              />
            </label>
            <label>
              Seed
              <input
                className="incremental-number-input"
                type="number"
                step="1"
                value={config.modelSettings.seed}
                onChange={(event) => updateModelSetting('seed', event.target.value)}
              />
            </label>
            <label>
              Split Mode
              <select value={config.modelSettings.splitMode} onChange={(event) => updateModelSetting('splitMode', event.target.value)}>
                <option value="chronological">chronological</option>
                <option value="random">random</option>
              </select>
            </label>
          </div>
        </section>

        <div className="row">
          <button type="button" className="ghost-button" onClick={runPreview} disabled={previewLoading}>
            {previewLoading ? 'Previewing...' : 'Preview Pool'}
          </button>
          <button type="button" className="ghost-button" onClick={runValidation} disabled={validationLoading}>
            {validationLoading ? 'Validating...' : 'Validate Config'}
          </button>
          <button type="button" className="ghost-button" onClick={saveModel} disabled={saveModelLoading || !runSummary?.runId}>
            {saveModelLoading ? 'Saving...' : 'Save Model'}
          </button>
          <button type="button" className="primary-button" onClick={runModel} disabled={runLoading}>
            {runLoading ? 'Training...' : 'Run Ridge Model'}
          </button>
        </div>
      </div>

      {isLoadModelModalOpen ? (
        <div className="bm-modal-backdrop" role="presentation" onClick={() => setIsLoadModelModalOpen(false)}>
          <div
            className="panel stack bm-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Load saved basketball model"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="row-between">
              <h3>Load Model</h3>
              <button type="button" className="ghost-button" onClick={() => setIsLoadModelModalOpen(false)}>
                Close
              </button>
            </div>
            <p className="muted">Select one of your saved models to restore its config and run context.</p>
            {savedModelsLoading ? (
              <p className="muted">Loading saved models...</p>
            ) : asArray(savedModels).length === 0 ? (
              <p className="muted">No saved models yet. Train and save a model first.</p>
            ) : (
              <div className="bm-saved-model-list">
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th colSpan={4} className="bm-group-header-spacer">
                          &nbsp;
                        </th>
                        <th className="bm-group-title-cell bm-test-col bm-group-start">
                          &nbsp;
                        </th>
                        <th className="bm-group-title-cell bm-test-col">
                          <span className="bm-group-title-text">Test</span>
                        </th>
                        <th className="bm-group-title-cell bm-test-col">
                          &nbsp;
                        </th>
                        <th className="bm-group-title-cell bm-held-col bm-group-start">
                          &nbsp;
                        </th>
                        <th className="bm-group-title-cell bm-held-col">
                          <span className="bm-group-title-text">Heldout</span>
                        </th>
                        <th className="bm-group-title-cell bm-held-col bm-group-end">
                          &nbsp;
                        </th>
                        <th colSpan={1} className="bm-group-header-spacer">
                          &nbsp;
                        </th>
                      </tr>
                      <tr>
                        <th>
                          <button type="button" className="table-sort-button" onClick={() => toggleSavedModelsSort('date')}>
                            Date
                            <span className="table-sort-indicator">{sortIndicator('date')}</span>
                          </button>
                        </th>
                        <th className="bm-col-name">
                          <button type="button" className="table-sort-button" onClick={() => toggleSavedModelsSort('name')}>
                            Name
                            <span className="table-sort-indicator">{sortIndicator('name')}</span>
                          </button>
                        </th>
                        <th>
                          <button type="button" className="table-sort-button" onClick={() => toggleSavedModelsSort('features')}>
                            Features
                            <span className="table-sort-indicator">{sortIndicator('features')}</span>
                          </button>
                        </th>
                        <th>
                          <button type="button" className="table-sort-button" onClick={() => toggleSavedModelsSort('rows')}>
                            Rows
                            <span className="table-sort-indicator">{sortIndicator('rows')}</span>
                          </button>
                        </th>
                        <th className="bm-test-col bm-group-start">
                          <button type="button" className="table-sort-button" onClick={() => toggleSavedModelsSort('testCorrelation')}>
                            Corr.
                            <span className="table-sort-indicator">{sortIndicator('testCorrelation')}</span>
                          </button>
                        </th>
                        <th className="bm-test-col">
                          <button type="button" className="table-sort-button" onClick={() => toggleSavedModelsSort('testRmse')}>
                            RMSE
                            <span className="table-sort-indicator">{sortIndicator('testRmse')}</span>
                          </button>
                        </th>
                        <th className="bm-test-col">
                          <button type="button" className="table-sort-button" onClick={() => toggleSavedModelsSort('testRae')}>
                            RAE
                            <span className="table-sort-indicator">{sortIndicator('testRae')}</span>
                          </button>
                        </th>
                        <th className="bm-held-col bm-group-start">
                          <button type="button" className="table-sort-button" onClick={() => toggleSavedModelsSort('heldCorrelation')}>
                            Corr.
                            <span className="table-sort-indicator">{sortIndicator('heldCorrelation')}</span>
                          </button>
                        </th>
                        <th className="bm-held-col">
                          <button type="button" className="table-sort-button" onClick={() => toggleSavedModelsSort('heldRmse')}>
                            RMSE
                            <span className="table-sort-indicator">{sortIndicator('heldRmse')}</span>
                          </button>
                        </th>
                        <th className="bm-held-col bm-group-end">
                          <button type="button" className="table-sort-button" onClick={() => toggleSavedModelsSort('heldRae')}>
                            RAE
                            <span className="table-sort-indicator">{sortIndicator('heldRae')}</span>
                          </button>
                        </th>
                        <th className="bm-actions-header">
                          <span>Actions</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedSavedModels.map((item) => (
                        <tr key={item.id}>
                          <td>{formatSavedDate(item.createdAt)}</td>
                          <td className="bm-col-name">
                            <div className="bm-name-cell">
                              <span className="bm-name-text" title={item.name}>
                                {item.name}
                              </span>
                              <button
                                type="button"
                                className="bm-inline-copy-button"
                                title={
                                  copiedModelId === item.id
                                    ? 'Copied model settings'
                                    : 'Copy model settings + config for LLM'
                                }
                                aria-label={`Copy settings for ${item.name}`}
                                onClick={() => copySavedModelConfigToClipboard(item.id)}
                                disabled={copyModelLoadingId === item.id}
                              >
                                {copyModelLoadingId === item.id ? '…' : copiedModelId === item.id ? '✓' : '⧉'}
                              </button>
                            </div>
                          </td>
                          <td>{item.featureCount ?? '-'}</td>
                          <td>{item.rowCounts?.modelRows ?? '-'}</td>
                          <td className="bm-test-col bm-group-start">{formatMetric(item.metrics?.crossValidation?.correlation, 3)}</td>
                          <td className="bm-test-col">{formatMetric(item.metrics?.crossValidation?.rmse, 3)}</td>
                          <td className="bm-test-col">{formatMetric(pickRaeValue(item.metrics?.crossValidation), 3)}</td>
                          <td className="bm-held-col bm-group-start">{formatMetric(item.metrics?.test?.correlation, 3)}</td>
                          <td className="bm-held-col">{formatMetric(item.metrics?.test?.rmse, 3)}</td>
                          <td className="bm-held-col bm-group-end">{formatMetric(pickRaeValue(item.metrics?.test), 3)}</td>
                          <td className="bm-actions-cell">
                            <div className="bm-table-actions">
                              <button
                                type="button"
                                className="primary-button"
                                onClick={() => loadSavedModel(item.id)}
                                disabled={loadModelLoadingId === item.id || deleteModelLoadingId === item.id}
                              >
                                {loadModelLoadingId === item.id ? 'Loading...' : 'Load'}
                              </button>
                              <button
                                type="button"
                                className="ghost-button bm-delete-button"
                                onClick={() => deleteSavedModel(item.id)}
                                disabled={loadModelLoadingId === item.id || deleteModelLoadingId === item.id}
                              >
                                {deleteModelLoadingId === item.id ? 'Deleting...' : 'Delete'}
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : null}

      {preview ? (
        <div className="panel stack">
          <h3>Pool Preview</h3>
          <div className="stat-grid">
            <div className="stat-card">
              <span>All Rows</span>
              <strong>{preview.totals?.allRows ?? '-'}</strong>
            </div>
            <div className="stat-card">
              <span>Matched Rows</span>
              <strong>{preview.totals?.matchedRows ?? '-'}</strong>
            </div>
            <div className="stat-card">
              <span>Results Files</span>
              <strong>{preview.dataSources?.resultsFilesCount ?? '-'}</strong>
            </div>
            <div className="stat-card">
              <span>Available Stats</span>
              <strong>{preview.dataSources?.availableStatColumnsCount ?? '-'}</strong>
            </div>
          </div>
          {asArray(preview.warnings).length ? (
            <div className="stack">
              <strong>Preview Warnings</strong>
              {preview.warnings.map((warning) => (
                <p key={warning} className="muted">
                  {warning}
                </p>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {validation ? (
        <div className="panel stack">
          <h3>Config Validation</h3>
          <p className="muted">{validation.ok ? 'Configuration is valid.' : 'Configuration has errors.'}</p>
          {validation.errors.map((value) => (
            <p key={`error-${value}`} className="muted">
              Error: {value}
            </p>
          ))}
          {validation.warnings.map((value) => (
            <p key={`warning-${value}`} className="muted">
              Warning: {value}
            </p>
          ))}
        </div>
      ) : null}

      {runSummary ? (
        <div className="panel stack">
          <div className="row-between">
            <div className="bm-heading-inline">
              <h3>Run Results</h3>
              <button
                type="button"
                className="bm-icon-copy-button"
                aria-label="Copy run results"
                title={copiedRunResults ? 'Copied' : 'Copy run results'}
                onClick={copyRunResultsToClipboard}
              >
                {copiedRunResults ? '✓' : '⧉'}
              </button>
            </div>
            <div className="row">
              <button type="button" className="ghost-button" onClick={loadRunDetails}>
                Load Full Coefficients
              </button>
              <button type="button" className="primary-button" onClick={saveSnapshot}>
                Save to History
              </button>
            </div>
          </div>

          <div className="bm-run-id-banner">
            <span>Run ID</span>
            <div className="bm-run-id-row">
              <strong className="bm-run-id-text">{runSummary.runId}</strong>
            </div>
          </div>

          <div className="stat-grid bm-run-stats-grid">
            <div className="stat-card bm-run-stat-card">
              <span>Feature Count</span>
              <strong className="bm-run-stat-value">{runSummary.featureCount}</strong>
            </div>
            <div className="stat-card bm-run-stat-card">
              <span>Model Rows</span>
              <strong className="bm-run-stat-value">{runSummary.rowCounts?.modelRows}</strong>
            </div>
            <div className="stat-card bm-run-stat-card">
              <span>Test RMSE</span>
              <strong className="bm-run-stat-value">{formatMetric(runSummary.metrics?.test?.rmse, 4)}</strong>
            </div>
            <div className="stat-card bm-run-stat-card">
              <span>Test MAE</span>
              <strong className="bm-run-stat-value">{formatMetric(runSummary.metrics?.test?.mae, 4)}</strong>
            </div>
            <div className="stat-card bm-run-stat-card">
              <span>Test R2</span>
              <strong className="bm-run-stat-value">{formatMetric(runSummary.metrics?.test?.r2, 4)}</strong>
            </div>
            <div className="stat-card bm-run-stat-card">
              <span>Test Correlation</span>
              <strong className="bm-run-stat-value">{formatMetric(runSummary.metrics?.test?.correlation, 4)}</strong>
            </div>
          </div>

          {runSummary.metrics?.baselines?.test ? (
            <div className="panel bm-baseline-panel stack">
              <h4>Baseline Comparison (Holdout Test)</h4>
              <div className="stat-grid">
                <div className="stat-card">
                  <span>Model RMSE</span>
                  <strong>{formatMetric(runSummary.metrics?.test?.rmse, 4)}</strong>
                </div>
                <div className="stat-card">
                  <span>Zero Baseline RMSE</span>
                  <strong>{formatMetric(runSummary.metrics?.baselines?.test?.zero?.rmse, 4)}</strong>
                </div>
                <div className="stat-card">
                  <span>RMSE Lift vs Zero</span>
                  <strong>
                    {formatDelta(runSummary.metrics?.test?.rmse, runSummary.metrics?.baselines?.test?.zero?.rmse)}
                  </strong>
                </div>
                <div className="stat-card">
                  <span>Train-Mean Baseline RMSE</span>
                  <strong>{formatMetric(runSummary.metrics?.baselines?.test?.trainMean?.rmse, 4)}</strong>
                </div>
                <div className="stat-card">
                  <span>RMSE Lift vs Train Mean</span>
                  <strong>
                    {formatDelta(
                      runSummary.metrics?.test?.rmse,
                      runSummary.metrics?.baselines?.test?.trainMean?.rmse
                    )}
                  </strong>
                </div>
                <div className="stat-card">
                  <span>Train Mean Margin</span>
                  <strong>{formatMetric(runSummary.metrics?.baselines?.test?.trainMeanValue, 4)}</strong>
                </div>
                <div className="stat-card">
                  <span>Model Correlation</span>
                  <strong>{formatMetric(runSummary.metrics?.test?.correlation, 4)}</strong>
                </div>
                <div className="stat-card">
                  <span>Zero Baseline Correlation</span>
                  <strong>{formatMetric(runSummary.metrics?.baselines?.test?.zero?.correlation, 4)}</strong>
                </div>
                <div className="stat-card">
                  <span>Train-Mean Baseline Correlation</span>
                  <strong>{formatMetric(runSummary.metrics?.baselines?.test?.trainMean?.correlation, 4)}</strong>
                </div>
              </div>
            </div>
          ) : null}

          {asArray(runSummary.topCoefficients).length ? (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Top Feature</th>
                    <th>Coefficient</th>
                  </tr>
                </thead>
                <tbody>
                  {runSummary.topCoefficients.map((item) => (
                    <tr key={item.feature}>
                      <td>{item.feature}</td>
                      <td>{item.coefficient}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {runDetails ? (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Feature</th>
                    <th>Coefficient</th>
                  </tr>
                </thead>
                <tbody>
                  {asArray(runDetails.coefficients?.byFeature).map((item) => (
                    <tr key={item.feature}>
                      <td>{item.feature}</td>
                      <td>{item.coefficient}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      ) : null}

      <form className="panel stack" onSubmit={onPredictSubmit}>
        <h3>Matchup Prediction</h3>
        <div className="stat-grid">
          <label>
            Run ID
            <input
              value={predictForm.runId}
              onChange={(event) => setPredictForm((prev) => ({ ...prev, runId: event.target.value }))}
              placeholder="bm-..."
            />
          </label>
          <label>
            Season Start Year
            <input
              className="incremental-number-input"
              type="number"
              step="1"
              value={predictForm.seasonStartYear}
              onChange={(event) => setPredictForm((prev) => ({ ...prev, seasonStartYear: event.target.value }))}
            />
          </label>
          <label>
            Team 1
            <input
              value={predictForm.team1}
              onChange={(event) => setPredictForm((prev) => ({ ...prev, team1: event.target.value }))}
              placeholder="Duke"
            />
          </label>
          <label>
            Team 2
            <input
              value={predictForm.team2}
              onChange={(event) => setPredictForm((prev) => ({ ...prev, team2: event.target.value }))}
              placeholder="North Carolina"
            />
          </label>
        </div>
        <button
          type="submit"
          className="primary-button"
          disabled={predictionLoading || !canPredict}
        >
          {predictionLoading ? 'Predicting...' : 'Predict Matchup'}
        </button>
        {predictionResult ? (
          <div className="stat-grid" ref={predictionResultsRef}>
            <div className="stat-card">
              <span>Forward Predicted Diff</span>
              <strong>{predictionResult.forwardPredictedDiff}</strong>
            </div>
            <div className="stat-card">
              <span>Reverse Predicted Diff</span>
              <strong>{predictionResult.reversePredictedDiff}</strong>
            </div>
            <div className="stat-card">
              <span>Symmetric Margin</span>
              <strong>{predictionResult.symmetricMargin}</strong>
            </div>
            <div className="stat-card">
              <span>Favored Team</span>
              <strong>{predictionResult.favoredTeam}</strong>
            </div>
          </div>
        ) : null}
      </form>
    </section>
  );
}
