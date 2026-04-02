# Basketball Modeling Backend Reference

## Route Handlers

All route handlers live in `backend/src/routes/tools.js` under `/api/tools/basketball-modeling/*`.

## Service Modules

- `dataService.js`
  - loads results rows
  - loads/dedupes stat columns
  - loads stats rows keyed by `seasonStartYear:normalizedTeam`
- `filterService.js`
  - applies results pool filters
- `configValidationService.js`
  - validates config shape and values
- `featureBuilderService.js`
  - builds base and cross-stat feature specs
  - builds feature vectors for each game row
- `ridgeTrainerService.js`
  - standardization
  - train/test split
  - ridge fit and metrics
  - cross-validation aggregate metrics
- `runModelService.js`
  - orchestration from config -> trained run summary
  - run lookup
  - matchup prediction
- `runStoreService.js`
  - in-memory run storage
- `mathService.js`
  - matrix math and linear solver
- `errors.js`
  - HTTP-flavored error helper

## Primary Request Object

```json
{
  "poolFilters": {},
  "featureConfig": {
    "statFeatureRules": []
  },
  "modelSettings": {
    "advanced": {
      "symmetricAugmentation": true,
      "targetCapEnabled": true,
      "targetCapMin": -40,
      "targetCapMax": 40,
      "predictorNormalization": "zscore_train",
      "targetNormalization": "none"
    }
  }
}
```

`statFeatureRules` is the preferred config format. Legacy `selectedStatColumns/statTransforms/crossStatPairs` is still supported for compatibility.

## Persistence State (Current)

- Run store is process memory only.
- Max retained runs: 50.
- Restart clears all run IDs and artifacts.

## Backend Operational Notes

- `seasonStartYear` for results rows is parsed from filename pattern.
- Stat columns are deduplicated before being returned in meta.
- Split mode can be chronological or random.
- Intercept is intentionally left unregularized in ridge fitting.

## Migration Plan to Mongo (Next)

When persisting runs:

1. Add `BasketballModelRun` model with config, metrics, diagnostics, artifact.
2. Replace in-memory store reads/writes with Mongo reads/writes.
3. Keep a bounded index + TTL policy if storage growth is a concern.
4. Add version fields for backward-compatible artifact loading.
