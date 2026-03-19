# BetLab Backend Process

This document defines the standard backend workflow for BetLab APIs.

## Stack and Runtime

- Runtime: Node.js (CommonJS)
- Framework: Express
- Entrypoint: `backend/src/server.js`
- App setup: `backend/src/app.js`

## Backend Structure

- `backend/src/config.js`: environment and runtime config
- `backend/src/routes`: API route modules
- `backend/src/middleware`: cross-cutting middleware
- `backend/.env.example`: required environment variables

## API Conventions

- Mount API routes under `/api`.
- Return JSON for both success and errors.
- Success format:
  - `{ ok: true, ...data }`
- Error format:
  - `{ ok: false, error: "message" }`
- Keep `/api/health` stable for service checks.

## Environment and Startup

- Create `.env` from `.env.example` when needed.
- Current variables:
  - `PORT`
  - `CORS_ORIGIN`
- Start commands:
  - Dev: `npm run dev`
  - Prod-like: `npm run start`

## Routing and Middleware Rules

- Use route files grouped by domain (`tools`, `contests`, `notes`, etc.).
- Keep not-found and error handling centralized in middleware.
- Validate request payloads early in route handlers.
- Keep route handlers concise; move reusable logic to helper/service modules.

## Logging and Observability

- Log unexpected server errors in `errorHandler`.
- Add contextual logging for new complex endpoints (route, key IDs, timing).
- Never log sensitive credentials or secrets.

## Development Workflow

1. Define endpoint contract (method, path, request, response, errors).
2. Add/extend route file and mount in `routes/index.js`.
3. Add validation and error handling.
4. Verify with local requests.
5. Update docs/rules when contracts or conventions change.

## Definition of Done (Backend)

- Server starts without runtime errors.
- Endpoint behaves correctly for valid and invalid requests.
- Error responses follow JSON convention.
- Health endpoint still works.
- Docs and rules are updated.
