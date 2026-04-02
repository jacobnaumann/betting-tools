# Basketball Modeling Tool

This is the main documentation file for the BetLab Basketball Modeling tool.

Use this file as the source of truth for architecture, API surface, data contracts, and extension planning.

## Purpose

The tool lets users:

- Build a custom results pool from multi-season game data.
- Configure feature engineering from team stats.
- Train a ridge regression model.
- Inspect metrics and coefficients.
- Predict matchup margins using trained runs.

## Current Scope (Implemented)

- Model type: ridge regression.
- Target variable: `adjust_diff`.
- Filters:
  - season range (`seasonStartYearMin` / `seasonStartYearMax`)
  - date range (`dateFrom` / `dateTo`)
  - `locations` (`H`, `N`, `V`)
  - `conferenceMode` (`any`, `conference`, `non_conference`)
  - `seasonPhases` (if available in results rows)
- Feature transforms:
  - base: `diff`, `avg`, `ratio`, `interaction`
  - cross-stat: `cross_diff`, `cross_avg`, `cross_ratio`, `cross_interaction`
- Validation, preview, training, run detail lookup, and prediction endpoints.
- Frontend pre-run module + run results + matchup prediction UI.
- Advanced modeling options (collapsible in UI) with Pitino-style defaults:
  - symmetric augmentation: enabled
  - target cap: enabled (`-40` to `40`)
  - predictor normalization: `zscore_train`
  - target normalization: `none`

## Core Data Inputs

- Results files:
  - `NCAA Results/Raw results/ncaa-*-adjusted-diff.csv`
  - `backend/data/ncaa-master-results-2016-2025.csv` (master-file format supported)
- Team stats files:
  - `multi-season-team-stats/normalized-names-results/NCAA_D1_Team_Stats_*-results-names.csv`
  - `backend/data/ncaa-master-stats-2016-2025.csv` (master-file format supported)

## High-Level Architecture

- Frontend:
  - `frontend/src/tools/BasketballModelingTool.jsx`
  - Route: `/tools/basketball-modeling`
- Backend routes:
  - `backend/src/routes/tools.js`
- Backend services:
  - `backend/src/services/basketballModeling/*`

The flow is:

1. Frontend sends config to backend.
2. Backend loads and filters results rows.
3. Backend joins results rows to team stats by season/team key.
4. Backend builds feature vectors.
5. Backend trains ridge model and computes metrics.
6. Backend stores run artifact in memory and returns run ID.
7. Frontend can query run details and request matchup predictions.

## Endpoints

- `GET /api/tools/basketball-modeling/meta`
- `POST /api/tools/basketball-modeling/preview-pool`
- `POST /api/tools/basketball-modeling/validate-config`
- `POST /api/tools/basketball-modeling/run`
- `GET /api/tools/basketball-modeling/run/:runId`
- `POST /api/tools/basketball-modeling/predict`

## Environment Variables

Backend variables relevant to this tool:

- `MONGO_DB_URI` (or `mongo_db_uri`)
- `BASKETBALL_MODEL_RESULTS_DIR` (optional)
- `BASKETBALL_MODEL_STATS_DIR` (optional)

When using master files in `backend/data`, point both directory variables to that folder.

## Known Limitations

- Run artifacts are currently in-memory only (process restart clears runs).
- Results files without `adjust_diff` are skipped.
- Rows are dropped when stats are missing or feature values are invalid.
- Confidence/probability calibration is not yet implemented in the UI.

## Recommended Next Enhancements

- Persist run artifacts/configs in Mongo.
- Add saved presets/templates per user.
- Add richer diagnostics (drop reason counts by feature or team).
- Add confidence modeling and calibration outputs.
- Add team-tendency pool infrastructure once the archetype spec is finalized.

## Related Docs

- Phase A notes: `docs/basketball-modeling-phase-a.md`
- Phase B notes: `docs/basketball-modeling-phase-b.md`
- Phase C notes: `docs/basketball-modeling-phase-c.md`
- Backend reference: `docs/basketball-modeling-backend.md`
- Frontend reference: `docs/basketball-modeling-frontend.md`
- Debugging guide: `docs/basketball-modeling-debugging.md`
