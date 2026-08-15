# FieldOps V4 — Full Operational Integration & Acceptance

## Scope

This acceptance stage closes the operational path without rebuilding the existing backend:

`Frontend UX → Project Context → Data Flow → Quality/Progress Roll-up → Input Modes → Offline/Sync → End-to-End Acceptance`

## Canonical branch

`fieldops-v4`

## Implemented closure in this stage

- The selected project is now reconciled against every successful project refresh instead of retaining a stale project object.
- A successful Daily Site Diary save refreshes the parent operational data context, so downstream screens receive the newest project/remarks/audit state without a manual page reload.
- The Daily Site Diary callback remains optional, preserving compatibility with existing callers.
- Authentication and API transport continue to use the existing centralized authenticated client and refresh lifecycle.
- Offline drafts remain local to the selected project and are not silently discarded when the server is unavailable.
- Sync/conflict state continues to be surfaced through the existing operational rail and mobile center.

## Acceptance sequence

### 1. Frontend UX

- Login opens the authenticated shell.
- The project selector is always visible in the operational shell.
- Changing project updates the active context.
- Refreshing data preserves the selected project when it still exists.
- Screen errors remain isolated by `ScreenErrorBoundary`.
- Loading, offline, pending-sync and conflict states remain visible.

### 2. Data Flow

`Project → Unit/BOQ → Execution Progress → Dashboard/Progress → Quality/Remarks → Reporting`

After a successful mutation, the parent data loader must be invoked where the screen already exposes `onRefresh`/`onChanged`.

### 3. Quality / Progress roll-up

- Execution progress changes are submitted through the existing execution event pipeline.
- Lowering progress requires a rework reason.
- Quality remarks remain project/unit scoped.
- Dashboard and workflow indicators consume the refreshed parent state.

### 4. Input modes

- Single-row/Speed Entry.
- Bulk percentage application.
- Excel import.
- Daily Site Diary.
- GPS capture.
- Draft/autosave for field diary.

### 5. Offline / Sync

- Offline diary input is retained as a project-scoped local draft.
- Offline execution/remark operations remain in the existing IndexedDB queue.
- Reconnection triggers the existing sync pipeline.
- 401 responses use the centralized refresh lifecycle.
- Sync conflicts are not silently overwritten; they remain available to the conflict-resolution UI.

### 6. End-to-End acceptance checklist

- [ ] Login
- [ ] Access token attached to protected API requests
- [ ] Refresh after access-token expiry
- [ ] Logout after refresh failure
- [ ] Dashboard
- [ ] Project selection
- [ ] Projects refresh without losing project context
- [ ] Speed Entry save
- [ ] Progress refresh
- [ ] Daily Site Diary save
- [ ] Diary save refreshes parent operational context
- [ ] Quality create/resolve
- [ ] Reporting reflects refreshed state
- [ ] Offline draft
- [ ] Offline queue
- [ ] Reconnect/sync
- [ ] Conflict handling
- [ ] Logout/login again

## Evidence

The backend deployment logs supplied during this stage showed authenticated `200 OK` responses for Projects, Quality, Users, Audit and Field Diary. The remaining acceptance work is therefore primarily browser-level validation of the complete user journey rather than disabling backend security or rebuilding RLS/authentication.
