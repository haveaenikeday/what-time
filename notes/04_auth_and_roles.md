# 04 — Auth and Roles

## Purpose
Clarify authentication and role behavior so future contributors do not assume SaaS-style auth exists.

## Status
- Last updated: 2026-03-21
- **Confirmed from code**: no auth, no user accounts, no role/permission system in app runtime.

## Confirmed from code
- No login/signup UI in renderer pages.
- No token/session handling in preload or IPC handlers.
- No user tables/ownership fields in SQLite schema.
- All features run under the single local macOS user account launching the app.

## Current model
- Trust boundary is the local machine user session.
- Access control is effectively OS-level (who can open/use the app on that Mac).
- Sensitive operations rely on macOS permissions (Accessibility/Contacts), not app-defined roles.

## Non-goals (current scope)
- Multi-user accounts
- Team/admin roles
- Backend authorization policies
- Remote identity provider integration

## Open issues / gaps
- No app PIN/passcode lock for shared-machine scenarios.
- No encryption at rest for local SQLite data.

## Recommended next steps
1. Keep this file explicit unless product direction changes toward multi-user.
2. If local privacy hardening is needed, consider optional app lock + encrypted DB.
