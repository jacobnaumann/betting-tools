# BetLab Tool Creation Process (Start to Finish)

Use this checklist for every new BetLab tool so quality and consistency stay high.

## Phase 1: Define the Tool

1. Name the tool clearly.
2. Define required inputs.
3. Define exact outputs and formulas.
4. Identify edge cases (zero, negative values, missing values, invalid odds, etc.).
5. Decide if tool is frontend-only or needs backend persistence/API.

## Phase 2: Frontend Integration

1. Create tool module in `frontend/src/tools/<ToolName>.jsx`.
2. Add route in `frontend/src/App.jsx`.
3. Register metadata in `frontend/src/data/tools.js`.
4. If shared logic is reusable, move to `frontend/src/utils`.
5. If tool writes shared state/history, use `BetLabContext`.

## Phase 3: Backend Integration (if needed)

1. Define endpoint contract first.
2. Add route module in `backend/src/routes`.
3. Mount route under `/api` in `backend/src/routes/index.js`.
4. Implement validation and clear JSON errors.
5. Add frontend API client calls only after endpoint behavior is stable.

## Phase 4: Styling and UX

1. Follow token-based styling in `frontend/src/styles.css`.
2. Ensure layout works on desktop and mobile.
3. Verify dark and light themes.
4. Keep labels clear and output language explicit.
5. For numeric fields, use `type="number"` with incremental stepping (`step="1"` by default).
6. Style numeric incrementers for dark/light themes via scoped CSS class + `color-scheme`.
7. Include "save snapshot" behavior when tool output is worth tracking.

## Phase 5: Validation

1. Frontend:
   - `npm run build` in `frontend`
   - lint check for touched files
2. Backend (if changed):
   - start server with `npm run dev` in `backend`
   - test endpoint happy path and failure path
3. Manual smoke test:
   - tool appears in sidebar + tools page
   - route loads
   - calculations are correct for sample values

## Phase 6: Documentation and Rules

1. Update process docs if conventions changed.
2. Update relevant `.cursor/rules/*.mdc` files.
3. Document any new env vars in `backend/.env.example`.
4. Record formulas and assumptions directly in tool docs or comments when non-obvious.

## Quality Gates Before Sign-Off

- No missing imports or broken routes.
- No new lint errors.
- Build passes.
- Tool is discoverable, usable, and understandable.
- Docs/rules are current.
