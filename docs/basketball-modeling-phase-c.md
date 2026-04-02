# Basketball Modeling Tool - Phase C

Phase C adds the frontend tool UI and connects it to the Phase A/B backend endpoints.

## Frontend Route and Registration

- Tool component: `frontend/src/tools/BasketballModelingTool.jsx`
- Route: `/tools/basketball-modeling`
- Tool registry entry: `frontend/src/data/tools.js`

## Implemented UI Sections

- Pool filters:
  - season range
  - date range
  - locations
  - conference mode
  - season phases
- Feature builder:
  - stat search + selection
  - base transforms
  - cross-stat pairs with per-pair transforms
- Ridge settings:
  - alpha, folds, split mode, train ratio, seed
- Actions:
  - preview pool
  - validate config
  - run model

## Results and Prediction UI

- Run summary cards with key test metrics.
- Top coefficients table.
- Optional full coefficient table loaded by run ID.
- Matchup predictor using run ID + season + team names.
- Save run snapshot to BetLab history.
