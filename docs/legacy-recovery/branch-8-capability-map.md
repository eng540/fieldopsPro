# Ncrpro110 Branch 8 — Capability Map

Status: execution-ready recovery map
Source repository: `eng540/Ncrpro110`
Source branch: `eng540-patch-8`
Source commit: `b4faf62d3e5d968686ed56197e0b5b5716a9e428`
Target: `eng540/fieldopsPro` branch `fieldops-v4`

## Recovery rule

This document maps user capabilities and business behavior. Legacy source code is not treated as the target architecture. Each capability is classified as **KEEP**, **ADAPT**, **MERGE**, **REPLACE**, or **DROP** after comparison with existing V4 behavior. No legacy React screen, database table, or direct BOQ-per-unit model is copied into V4.

## Capability inventory

| Feature ID | Legacy Evidence | User Goal | Inputs / Data | Outputs / Behavior | Current V4 Equivalent | Decision | Gap / Next Action | Priority |
|---|---|---|---|---|---|---|---|---|
| B8-001 | README and BOQ tracking | Track work at item level | Project, Unit, Master BOQ, planned/actual quantity | Item progress and roll-up | Project → Units → BOQ → Assignment → Execution | MERGE | Keep Master BOQ central and prove one Assignment per Unit × BOQ | P0 |
| B8-002 | Weighted progress A/B/C | Calculate meaningful overall progress | Category weights and item achievement | Weighted overall percentage | V4 aggregation/progress | ADAPT | Preserve configurable weights; do not hard-code categories or use Project.completion_pct as sole truth | P0 |
| B8-003 | Quality gate per BOQ item | Prevent progress from ignoring quality | Quality status, inspection date, inspector | Pass/Fail/Pending gate | V4 Quality and remarks | MERGE | Link Quality Case to unit/BOQ/execution where applicable | P1 |
| B8-004 | RemarksManager and escalation | Record and close defects | Unit, BOQ, type, severity, action, deadline, evidence, status | Open/closed/reopened lifecycle | V4 QualityScreen / remarks | MERGE | Add evidence, deadline, resolution, closure, and reopen semantics | P1 |
| B8-005 | Daily site diary | Record daily field activity | Date, engineer, inspected/accepted units, weather, manpower, equipment, notes | Daily operational record | V4 FieldDiaryScreen | MERGE | Define project/unit references and decide whether diary is offline or online-only | P1 |
| B8-006 | Service worker, local DB, sync engine | Work without connectivity | Local writes, queue metadata, retry/conflict data | Deferred server sync | V4 offline-db + sync service | REPLACE | Keep behavior, but route execution progress through Event Pipeline and test real reconnect | P0 |
| B8-007 | Payment-ready progress export | Turn progress into reporting/IPC output | Aggregated execution data | Report/IPC-ready percentage data | V4 reporting/aggregation | ADAPT | Prove reports read the same execution-derived source of truth | P0 |
| B8-008 | Remark backend and frontend workflow | Manage field defects | Remark CRUD, status history, photos | Lifecycle updates and audit | V4 QualityScreen / quality API | MERGE | Use V4 API and tenant isolation; do not copy legacy screen | P1 |
| B8-009 | Bulk seed/create workflow | Create many units/items quickly | Validated unit and BOQ templates | Bulk-created master data | V4 Excel import | ADAPT | Add preview, dry-run, duplicate check, idempotency, import report | P1 |
| B8-010 | Local storage and pending uploads | Preserve field evidence offline | Local media metadata and queue state | Deferred upload with status | V4 quality photos + sync | ADAPT | Define upload states, attempts, last_error, and server verification | P1 |
| B8-011 | Admin/configuration panel | Manage reference/configuration data | Dictionaries, project setup, import actions | Controlled administrative changes | V4 Project Configuration and Dictionaries | MERGE | Centralize auth/retry and block legacy BOQ writes | P1 |
| B8-012 | Dashboard and roll-up | See project status consistently | Unit/BOQ/execution/quality aggregates | Operational dashboard | V4 Dashboard and Operations | ADAPT | Use one aggregation/read model and expose loading/error/partial states | P0 |
| B8-013 | Local crypto/security guidance | Protect sensitive local data | Tokens, local records, evidence | Protected local storage | V4 auth and IndexedDB | ADAPT | Perform threat-model review before adopting encryption; do not claim security from documentation alone | P2 |

## Fast Entry decision

`SpeedEntryMatrix` is **ADAPT**, not a copy. V4 must render a cell only for an active `UnitBoQAssignment` and a valid `UnitBoQProgress` state. The cell state must be explicit:

| State | User display | Allowed action |
|---|---|---|
| Assigned + state exists | Editable value | Save through Event Pipeline |
| Assigned + state missing | `تهيئة مطلوبة` | Initialize safely or block with actionable message |
| Not assigned | `غير مطبق` | Link to Project Configuration; no hidden input |
| Offline pending | Local value + pending badge | Queue with idempotency metadata |
| Conflict | Server/local values + reason | Resolve explicitly; no blind overwrite |

## Bulk Entry decision

Bulk Entry must select Units, select only applied BOQ items, enter a value, preview, validate, apply through a transaction group, and show `succeeded`, `conflicts`, and `failed` per cell. It must not create BOQ definitions. The API must explicitly declare whether the batch is atomic or partial-success; silent partial success is prohibited.

## Excel decision

The legacy bulk-import capability is **ADAPT**. The V4 pipeline must be:

```text
Download Template
→ Upload
→ Parse/Preview
→ Validate Rows and Relationships
→ Dry Run
→ Duplicate/Idempotency Check
→ Approve
→ Import Transaction
→ Import Report
```

The report must distinguish created, updated, skipped, and failed rows and must identify row/column errors. Units, Master BOQ, and Assignments remain separate data operations.

## Offline decision

Offline behavior is retained but the legacy storage implementation is **REPLACE**. V4 queue records must include `sync_uuid`, `status`, `attempts`, `created_at`, `last_error`, and `payload`. Progress must use the same event contract online and offline. Daily Diary must either receive an explicit sync contract or be documented as online-only; it must not be silently omitted.

## Branch 8 recovery record required for every future capability

Before implementation, record Feature ID, source evidence, User Goal, User Actions, Inputs, Outputs, Business Rules, Data Required, Current V4 Equivalent, Gap, Decision, Priority, API contract, persistence evidence, runtime test, and rollback plan.

## Drop rules

Drop any behavior that repeats Master BOQ per Unit, writes progress directly without an event, uses Last Write Wins without conflict evidence, relies on demo data as a production fix, or has no clear user goal and business rule.

## Acceptance principle

A recovered capability is complete only when it is implemented in V4, uses the V4 API/data model, respects org/project isolation, is covered by contract/integration tests, survives reload and retry, and feeds the same operational source of truth used by execution, progress, quality, diary, reporting, and sync.
