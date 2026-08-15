# FieldOps V4 — Legacy Capability Recovery Matrix

## Purpose

This document defines how operational capabilities from `eng540/Ncrpro110`, with emphasis on `eng540-patch-8`, are recovered into FieldOps V4.

The legacy repository is a source of **user workflows, operational scenarios, business rules and field experience**. It is not a source for copying the legacy architecture, API, database model or React components.

## Canonical target

- Target repository: `eng540/fieldopsPro`
- Target branch: `fieldops-v4`
- Current baseline reviewed: `41c99edb1147efb08b4dc4c356b92d8db992f249`
- Legacy reference: `eng540/Ncrpro110`, branch `eng540-patch-8`

## Decision vocabulary

- **KEEP** — capability already exists in V4 and should remain the source of truth.
- **ENHANCE** — V4 has the capability, but the legacy workflow exposes missing operational behavior or UX.
- **RECOVER** — the operational capability is materially missing and must be implemented in V4.
- **REJECT** — legacy implementation/architecture must not be carried forward.

## P0 — Execution and field operations

| Legacy capability | Legacy user intent | V4 evidence | Decision | Target capability |
|---|---|---|---|---|
| Speed Entry Matrix | Rapidly update progress across many unit/BOQ combinations | `ExecutionProgressScreen` exists; `SpeedEntryGrid` currently delegates to it | ENHANCE | Execution Workspace / Speed Entry 2.0 |
| Bulk Update | Apply one operational change to a selected set of units | Bulk percentage exists in current execution screen | ENHANCE | Bulk Action Engine |
| Single Entry | Update one unit/BOQ item precisely | Execution screen supports row editing | KEEP | Single Execution Entry |
| Unit operational list / radar | See unit state, progress, quality and recent activity together | Projects/operations screens exist but legacy Unit 360 semantics are not fully represented | RECOVER | Unit 360 / Operational Radar |
| BOQ updater | Work directly against a BOQ item and affected units | Dictionary/Execution capabilities exist | ENHANCE | BOQ-driven Execution Workspace |
| BOQ analytics | Drill from BOQ totals into affected units | Reporting exists, but legacy drill-down behavior must be recovered | ENHANCE | BOQ Analytics Drill-down |

## P0 — Quality

| Legacy capability | Legacy user intent | V4 evidence | Decision | Target capability |
|---|---|---|---|---|
| Quality Inspector | Find failed/pending/rework items without manually searching remarks | `QualityScreen` exists | ENHANCE | Quality Control Center |
| Smart Remark templates | Record recurring defects quickly and consistently | Quality/remarks infrastructure exists | ENHANCE | Smart Finding / Template-assisted Quality |
| Before/After evidence | Prove defect and corrective action | `MediaUploadPanel` exists | ENHANCE | Evidence lifecycle |
| Severity | Prioritize quality findings | Quality module exists | KEEP/ENHANCE | Severity-aware workflow |
| Action + deadline | Convert a finding into a controlled corrective action | Quality lifecycle exists | ENHANCE | Corrective Action workflow |
| Rework loop | Rejected work returns to execution and inspection | Execution has rework reason/status support | ENHANCE | Execution → Quality Gate → Rework → Reinspection |

## P0 — Diary and reporting

| Legacy capability | Legacy user intent | V4 evidence | Decision | Target capability |
|---|---|---|---|---|
| Daily Site Diary | Record daily field conditions and activities | `FieldDiaryScreen` + backend field diary module exist | ENHANCE | Smart Daily Diary |
| Auto daily statistics | Avoid retyping operational totals already known by the system | Diary exists, operational data exists | ENHANCE | Derived Daily Operational Summary |
| Daily log history | Review previous field reports | Diary endpoint exists; dedicated legacy history behavior needs recovery | RECOVER | Diary History / Timeline |
| Matrix reporting | See Unit × BOQ operational status | Reporting module exists | RECOVER | Operational Matrix Report |
| PDF/Excel reports | Export operational information for management | Reporting and IPC export exist | ENHANCE | Unified Reporting Center |

## P0 — Governance

| Legacy capability | Legacy user intent | V4 evidence | Decision | Target capability |
|---|---|---|---|---|
| Governance dashboard | Review operational readiness and exceptions | `GovernanceScreen` + backend governance module exist | ENHANCE | Decision & Governance Center |
| System recommendation | Convert execution/quality evidence into a recommended decision | Governance exists, but legacy recommendation semantics need mapping | ENHANCE | Rules-based Decision Engine |
| Human override | Allow authorized human decision with reason | Governance/audit infrastructure exists | ENHANCE | Controlled Decision Override |
| Payment-ready progress | Separate executed quantity from accepted/eligible quantity | IPC/reporting exists | ENHANCE | Quality-gated Payment Progress |

## P1 — Mobile and resilience

| Legacy capability | Legacy user intent | V4 evidence | Decision | Target capability |
|---|---|---|---|---|
| Offline drafts | Continue field work without network | Offline DB exists | KEEP/ENHANCE | Project-scoped offline drafts |
| Offline queue | Preserve mutations until reconnect | Sync module exists | KEEP | Unified mutation queue |
| Conflict handling | Prevent silent data loss | Conflict UI exists | KEEP/ENHANCE | User-resolved conflicts |
| PWA | Install/use the field application as an app | Service worker/PWA assets exist | ENHANCE | Field Mobile experience |
| App/PIN lock | Protect field session on shared devices | Legacy has PinGate | EVALUATE, not copy | V4 device/session protection if compatible with current auth/security |

## Explicitly rejected legacy transfers

1. Legacy React components are not copied into V4.
2. Legacy API endpoints are not made the primary V4 API merely for compatibility.
3. Legacy database schema is not restored.
4. Legacy authentication/token storage is not restored.
5. Legacy IndexedDB schema/sync engine is not restored where V4 already has a newer mechanism.
6. Legacy hard-coded domain assumptions are not treated as V4 business rules without validation.

## P0 acceptance principle

A capability is not accepted because a screen exists. It is accepted only when the complete user scenario works through the V4 architecture, including permissions, event/progress flow, quality implications, offline behavior where applicable, refresh/invalidation, reporting impact and auditability.
