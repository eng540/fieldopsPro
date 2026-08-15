# Project Creation Entry Point

## Decision
Project creation must be reachable from the global project context without requiring navigation to a secondary screen.

## UX flow
Project selector → `+ New Project` → authenticated project creation API → refresh project list → select created project → Project Configuration.

## Dynamic-system requirement
Creating a project must not require hard-coded BOQ, trade, unit, or work-item names. Those values are configured through project/organization dictionaries and actual BOQ inputs.

## Acceptance
- New Project action is visible wherever the project selector is available and the user has create permission.
- Creation uses the central authenticated API client.
- Successful creation refreshes the project context and selects the new project.
- Failed creation leaves the current project/context unchanged and presents the API error.
