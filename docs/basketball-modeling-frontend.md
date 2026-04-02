# Basketball Modeling Frontend Reference

## Tool Entry Point

- Component: `frontend/src/tools/BasketballModelingTool.jsx`
- Route: `/tools/basketball-modeling`
- Tool registry: `frontend/src/data/tools.js`

## UI Sections

- Pool Filters
  - season range
  - date range
  - location chips
  - conference mode
  - season phase chips
- Feature Builder
  - stat search and add list
  - selected stat rule cards
  - per-stat transform chips (`diff`, `avg`, `ratio`, `interaction`)
  - optional per-stat cross-pair toggle + paired-stat dropdown
- Ridge Settings
  - alpha, folds, train ratio, seed, split mode
- Advanced Modeling Options (collapsible)
  - symmetric augmentation toggle
  - target cap toggle with min/max
  - predictor normalization mode
  - target normalization mode
- Run Actions
  - preview, validate, run model
- Results
  - summary metrics cards
  - top coefficients table
  - full coefficients table
- Prediction
  - run ID + season + team1/team2 input

## API Calls Used by the UI

- `GET /api/tools/basketball-modeling/meta`
- `POST /api/tools/basketball-modeling/preview-pool`
- `POST /api/tools/basketball-modeling/validate-config`
- `POST /api/tools/basketball-modeling/run`
- `GET /api/tools/basketball-modeling/run/:runId`
- `POST /api/tools/basketball-modeling/predict`

## State Model (Current)

- Local component state is used for:
  - form config
  - preview payload
  - validation payload
  - latest run summary/details
  - prediction form/result
  - UI loading/error flags
- History snapshots are saved via `BetLabContext`.

## Frontend Safety Notes

- Available stats are deduplicated before rendering selection controls.
- Select option keys include index suffixes to avoid React duplicate-key warnings.
- Numeric fields use `type="number"` with incremental stepping.
- Added stats are disabled in the source stat list (still available in cross-pair dropdowns).

## Suggested Future Frontend Enhancements

- Add saved config templates in localStorage.
- Add import/export JSON for model configs.
- Add run comparison view.
- Add sortable/filterable full coefficients table with search.
