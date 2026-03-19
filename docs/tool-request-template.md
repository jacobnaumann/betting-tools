# BetLab Tool Request Template

Copy/paste one of these into chat when you want a new tool built.

## Full Version (Recommended)

```text
Create a new BetLab tool.

Before coding:
1) Read and follow:
- @docs/tool-creation-process.md
- @docs/frontend-process.md
- @docs/backend-process.md (only if backend is needed)
- @.cursor/rules/betlab-tool-creation-process.mdc
- @.cursor/rules/betlab-frontend.mdc
- @.cursor/rules/betlab-backend.mdc (only if backend is needed)

Tool name:
- <Tool Name>

Goal:
- <What problem this tool solves>

Inputs:
- <Input 1: type, validation, example>
- <Input 2: type, validation, example>

Outputs:
- <Output 1 + exact formula>
- <Output 2 + exact formula>

Behavior / UX:
- <How it should look/work>
- <Should results save to history? yes/no>
- <Any mobile/theme requirements>

Edge cases:
- <blank, zero, negative, invalid format, divide-by-zero, etc.>

Backend needed?
- Yes/No
- If yes:
  - Endpoints:
    - <METHOD /api/...>
  - Request shape:
    - <json example>
  - Response shape:
    - <json example>
  - Persistence:
    - <Mongo collection notes>

After implementation:
- Run frontend build (and backend checks if changed)
- Update docs/rules if conventions changed
- Tell me exactly which files were modified
```

## Short Version (Quick Prompt)

```text
Add a new BetLab tool called "<Tool Name>".
Follow @docs/tool-creation-process.md and @docs/frontend-process.md first.

Goal: <one sentence>
Inputs: <list>
Outputs/formulas: <list>
Edge cases: <list>
Backend: yes/no (if yes, include endpoint + request/response shape)

After coding, run checks and list modified files.
```
