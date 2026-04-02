# Basketball Modeling Tool - Phase A

This document describes the initial backend foundation for the BetLab basketball modeling tool.

## Endpoints

- `GET /api/tools/basketball-modeling/meta`
  - Returns available stat columns and source counts.
- `POST /api/tools/basketball-modeling/preview-pool`
  - Applies results pool filters and returns sample rows + breakdowns.
- `POST /api/tools/basketball-modeling/validate-config`
  - Validates pre-run model configuration and returns warnings/errors.

## Preview Pool Request

```json
{
  "poolFilters": {
    "seasonStartYearMin": 2019,
    "seasonStartYearMax": 2025,
    "dateFrom": "2024-11-01",
    "dateTo": "2025-03-31",
    "locations": ["H", "N"],
    "seasonPhases": ["early", "late"],
    "conferenceMode": "any"
  }
}
```

## Validate Config Request

```json
{
  "poolFilters": {
    "seasonStartYearMin": 2019,
    "seasonStartYearMax": 2025,
    "conferenceMode": "conference"
  },
  "featureConfig": {
    "selectedStatColumns": ["offensive_efficiency", "defensive_efficiency"],
    "statTransforms": ["diff", "avg"]
  },
  "modelSettings": {
    "ridgeAlpha": 0.25,
    "folds": 10,
    "splitMode": "chronological",
    "trainRatio": 0.9
  }
}
```

## Notes

- The data loader scans:
  - `NCAA Results/Raw results/ncaa-*-adjusted-diff.csv`
  - `multi-season-team-stats/normalized-names-results/NCAA_D1_Team_Stats_*-results-names.csv`
- Use optional backend env vars to override locations:
  - `BASKETBALL_MODEL_RESULTS_DIR`
  - `BASKETBALL_MODEL_STATS_DIR`
- `season_phase` and `is_conference` filters are supported and will become fully useful once these columns are present in the adjusted-diff files.
