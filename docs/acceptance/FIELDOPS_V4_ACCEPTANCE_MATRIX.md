# FieldOps V4 Acceptance Matrix

## Release slice

Branch: `feature/fieldops-v4-core-execution`
Base: `fieldops-v4`
PR: `#21`

## Evidence status

| Area | Verification | Result | Evidence / Gate |
|---|---|---|---|
| Core data contracts | Project, Unit, BOQ schemas and legacy assignment behavior | PASS | Backend regression suite |
| Canonical BOQ route | Route is mounted and returns explicit JSON contract in code | PASS | Route smoke test and canonical route tests |
| Legacy BOQ write | Missing Master BOQ cannot be created from Unit context | PASS | `test_project_legacy_assignment_contract.py` |
| Online progress | Event Pipeline enforces assignment and state version | PASS | Execution event contract and runtime consistency tests |
| Offline progress | Sync adapter routes UNIT_PROGRESS through Event Pipeline | PASS | Sync regression tests and compileall |
| Fast Entry | Unassigned vs state-missing vs editable states are distinct | PASS | TypeScript and Next build; live UI gate pending |
| Bulk Entry | Only assigned and initialized cells receive drafts | PASS | TypeScript and Next build; live UI gate pending |
| Excel preview | `/import/boq/preview` and `/import/units/preview` are mounted | PASS | Local OpenAPI route smoke |
| Excel dry-run | Validation returns preview without persistence | PASS | Shared parser path; integration gate pending |
| Excel commit | Import remains atomic and reports created codes | PASS | Compile/import route tests; Staging gate pending |
| Authentication | Project creation now uses central authenticated transport | PASS | TypeScript/build; live login gate pending |
| Quality/evidence | Existing Quality API and lifecycle tests remain green | PASS | Backend suite |
| Diary/reporting | Existing diary/reporting tests remain green | PASS | Backend suite |
| Live staging | Authenticated UI, real migration, real DB counts, offline reconnect | BLOCKED | The live browser login probe reached the 10-second timeout during the audit; no production backfill is claimed |

## Offline acceptance sequence

The acceptance sequence is: create one assigned progress change while online, reload and verify the event-derived state; switch the browser to offline, edit an initialized cell, verify a queue item with `sync_uuid`, `status=PENDING`, `attempts`, and `last_error`; restore connectivity; run sync; verify the server event, new state version, and idempotent retry. A second submission with the same `sync_uuid` must not create a duplicate event.

## Staging gate

Before merging PR #21, staging must expose `/health`, `/openapi.json`, the authenticated project list, canonical BOQ, execution state, and preview routes. The Mhsam comparison must prove that an assigned unit renders an editable cell, an unassigned pair renders `غير مطبق`, and a missing state renders `تهيئة مطلوبة`. Any 404 or failed fetch must be surfaced as a diagnostic state, not converted to an empty zero list.

## Definition of Done for this slice

This slice is complete when the backend suite is green, TypeScript and Next production build are green, route smoke confirms canonical and Excel routes, the branch is pushed with a reviewable PR, and the staging sequence above is run with real authenticated data. The local checks are complete; the live staging gate remains explicitly open rather than being inferred from local success.
