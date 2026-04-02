# Basketball Modeling Tool - Phase B

Phase B adds model training and prediction endpoints for ridge regression.

## New Endpoints

- `POST /api/tools/basketball-modeling/run`
  - Trains a ridge model from the submitted config.
  - Returns run summary, metrics, diagnostics, and top coefficients.
- `GET /api/tools/basketball-modeling/run/:runId`
  - Returns full run details, including full coefficient list.
- `POST /api/tools/basketball-modeling/predict`
  - Predicts matchup margin using a previously trained run artifact.

## Run Config Shape

```json
{
  "poolFilters": {
    "seasonStartYearMin": 2016,
    "seasonStartYearMax": 2025,
    "locations": ["H", "N"],
    "conferenceMode": "any",
    "seasonPhases": []
  },
  "featureConfig": {
    "selectedStatColumns": ["offensive_efficiency", "defensive_efficiency"],
    "statTransforms": ["diff", "avg"],
    "crossStatPairs": [
      {
        "teamStat": "offensive_efficiency",
        "opponentStat": "defensive_efficiency",
        "transforms": ["cross_diff", "cross_avg"]
      }
    ]
  },
  "modelSettings": {
    "ridgeAlpha": 0.25,
    "folds": 10,
    "splitMode": "chronological",
    "trainRatio": 0.9,
    "seed": 42
  }
}
```

## Prediction Request Shape

```json
{
  "runId": "bm-1234-abcdef",
  "seasonStartYear": 2025,
  "team1": "Duke",
  "team2": "Kansas"
}
```

## Notes

- Run artifacts are currently kept in-memory in the backend process.
- Model rows are dropped when either team is missing stats or a feature cannot be computed.
- Predictor normalization (z-score) is fitted on training rows only and reused for test/predict.
