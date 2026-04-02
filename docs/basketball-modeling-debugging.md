# Basketball Modeling Debugging Guide

Use this checklist when the tool behaves unexpectedly.

## 1) API Health and Startup

- Confirm backend is running and reachable (`/api/health` and `/api/tools/ping`).
- Confirm Mongo connects at startup (`MONGO_DB_URI` or `mongo_db_uri` set).
- If startup fails, check backend terminal for `Failed to start backend`.

## 2) Data Loading Issues

Symptoms:

- `meta` endpoint works but row counts are 0.
- `preview-pool` returns empty rows unexpectedly.

Checks:

- Verify results directory contains files matching:
  - `ncaa-*-adjusted-diff.csv`
- Verify each expected file has `adjust_diff`.
- Verify stats directory contains files matching:
  - `NCAA_D1_Team_Stats_*-results-names.csv`
- Check `preview-pool` warnings for skipped files.

## 3) Join and Feature Drop Issues

Symptoms:

- Large difference between filtered rows and model rows.

Checks:

- Inspect run diagnostics (`droppedMissingStats`, `droppedInvalidFeatureValue`).
- Check team naming consistency in stats/results files.
- Confirm selected stats exist as numeric columns in stats rows.

## 4) Validation Errors

Symptoms:

- `validate-config` or `run` returns 400.

Checks:

- Verify `seasonStartYearMin <= seasonStartYearMax`.
- Verify date format is `YYYY-MM-DD`.
- Verify transforms are supported values.
- Verify at least one feature source exists:
  - `selectedStatColumns` or `crossStatPairs`.

## 5) Frontend Warning/Rendering Issues

Symptoms:

- React key warnings, duplicate option behavior.

Checks:

- Confirm backend `meta` returns deduped `statsColumns`.
- Confirm frontend has latest `BasketballModelingTool.jsx` with dedupe fallback.
- Hard refresh browser and retry.

## 6) Prediction Issues

Symptoms:

- `predict` endpoint returns team-not-found.

Checks:

- Ensure `runId` exists (in-memory store is reset on backend restart).
- Ensure `seasonStartYear` matches available stats file season.
- Ensure team names are entered in a recognizable form.

## 7) Logging Recommendations

For deep debugging, add temporary logs in:

- `dataService.js` (file load counts, skipped reasons)
- `featureBuilderService.js` (feature spec count, per-row drop reason)
- `runModelService.js` (config hash, row counts through each stage)

Remove or downgrade noisy logs after issue resolution.
