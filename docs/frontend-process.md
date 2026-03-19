# BetLab Frontend Process

This document defines how BetLab frontend work should be planned, built, reviewed, and documented.

## Stack and Scope

- Framework: Vite + React + JavaScript (`.jsx` / `.js`)
- Router: `react-router-dom`
- Styling: global CSS tokens in `frontend/src/styles.css`
- Shared state: `frontend/src/state/BetLabContext.jsx`
- Tool modules: `frontend/src/tools`

## Frontend Architecture

- `frontend/src/App.jsx`: top-level routes
- `frontend/src/components`: reusable layout and presentational components
- `frontend/src/pages`: non-tool pages (`Dashboard`, `Tools`, `History`, etc.)
- `frontend/src/tools`: independent tool modules (one file per tool initially)
- `frontend/src/utils`: reusable logic (formatters, math, storage helpers)
- `frontend/src/hooks`: reusable hooks shared by tools/pages
- `frontend/src/data/tools.js`: source of truth for tool metadata

## Style Guide

## Visual System

- Use CSS variables (design tokens) for all colors.
- Do not hardcode one-off hex values inside component-level classes.
- Add or modify theme tokens in `:root` and `:root[data-theme='light']`.
- Keep spacing/border radius consistent with existing panel/card styles.

## Component Rules

- Keep components focused on one concern.
- If a component exceeds roughly 150 lines and has mixed responsibilities, split it.
- Keep tool-specific UI inside the tool file unless shared by 2+ tools.
- Favor clear names like `OverlayCalculatorTool` over vague names like `ToolCard2`.

## State Rules

- Cross-tool app state belongs in `BetLabContext`.
- Tool-local form values remain in component state.
- Persist user preferences with `useLocalStorage` when useful (`theme`, `favorites`, `history`, `notes`).

## Theme Rules (Dark / Light)

- Theme is controlled via `betlab.theme` in localStorage.
- Allowed values: `dark`, `light`.
- The provider sets `document.documentElement` with `data-theme`.
- New UI work must be checked in both themes before merging.

## Accessibility and UX

- Inputs must have labels.
- Numeric inputs should use `type="number"` when possible.
- Numeric inputs should support native incremental stepping (`step="1"` unless a different unit is required).
- Numeric incrementers must be styled for both themes (use `color-scheme` + scoped class in `frontend/src/styles.css`).
- Buttons should use meaningful text (`Save to History`, not `Submit`).
- Use readable contrast in both themes.
- Avoid layout breakage below tablet width; verify around `980px`.

## Development Workflow

1. Clarify the tool/page outcome and inputs/outputs.
2. Implement UI + logic with reusable helpers where possible.
3. Register routes and tool metadata when adding a new tool.
4. Validate:
   - `npm run build` in `frontend`
   - lints in changed files
   - manual smoke test in dark and light themes
5. Update docs/rules when conventions change.

## Definition of Done (Frontend)

- Feature works end-to-end from route to visible output.
- No unresolved Vite import errors.
- Build succeeds.
- No new lint errors.
- Docs and rules reflect new behavior.
