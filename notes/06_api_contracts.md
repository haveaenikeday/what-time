# 06 — API Contracts

## Purpose
Document the frontend/backend contract surface that exists in this repo.

## Status
- Last updated: 2026-03-21
- **Confirmed from code**: runtime contracts are Electron IPC channels, not HTTP endpoints.
- **Not found in repository**: REST/GraphQL server, RPC gateway, cloud auth API.

## Confirmed from code

### Contract type
- Renderer calls `window.api` methods exposed by preload (`electron/preload.ts`).
- Preload forwards to `ipcRenderer.invoke(...)` channels.
- Main handles channels in `electron/ipc/*.ipc.ts`.

### Schedule channels
- `schedule:getAll() -> Schedule[]`
- `schedule:get(id) -> Schedule | null`
- `schedule:create(input) -> Schedule`
- `schedule:update(id, patch) -> Schedule`
- `schedule:delete(id) -> void`
- `schedule:toggle(id, enabled) -> Schedule`
- `schedule:testSend(id) -> SendResult`
- `schedule:getNextFireTimes() -> Record<string, string | null>`

### Logs channels
- `logs:getAll(limit?) -> RunLog[]`
- `logs:bySchedule(scheduleId) -> RunLog[]`
- `logs:clear(olderThanDays?) -> void`

### Settings/system channels
- `settings:getAll() -> AppSettings`
- `settings:update(key, value) -> void`
- `system:checkAccessibility() -> AccessibilityStatus`
- `system:openAccessibilityPrefs() -> void`

### Contacts channels
- `contacts:search(query) -> Contact[]`
- `contacts:checkAccess() -> AccessibilityStatus`
- `contacts:openSettings() -> void`

### Push event contract
- Main emits `schedule:executed` event to renderer with run-log payload.
- Hooks/context subscribe and refresh schedules/logs.

### Validation and error behavior
- `schedule:create` validates phone/message/type/time shape in handler before DB write.
- `settings:update` rejects unsupported keys via whitelist in DB service.
- IPC handlers mostly throw on failure; renderer promise rejects.
- Contacts search maps permission denial to a user-facing explicit error message.

## Important details
- `shared/types.ts` is the intended contract source of truth and now matches `testSend` runtime shape.
- Contract completeness is covered by tests (`tests/ipc-contracts.test.ts`).
- Input validation logic is regression-tested (`tests/ipc-validation.test.ts`).

## Open issues / gaps
- Success/error envelopes are not standardized across all channels.
- Validation depth is strong for create, but patch/update constraints are less strict.
- Error payloads are mostly plain thrown strings, limiting typed UI diagnostics.

## Recommended next steps
1. Introduce a shared typed IPC response envelope (`{ ok, data?, error? }`) for consistency.
2. Add explicit validation for `schedule:update` edge cases and settings value ranges.
3. Add contract tests for event payload shape (`schedule:executed`) and error cases.
