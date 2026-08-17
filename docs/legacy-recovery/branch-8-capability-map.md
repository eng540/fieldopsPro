# Ncrpro110 Branch 8 — Capability Map

Status: initial recovery map
Source repository: `eng540/Ncrpro110`
Source branch: `eng540-patch-8`
Source commit: `b4faf62d3e5d968686ed56197e0b5b5716a9e428`
Target: `eng540/fieldopsPro` branch `fieldops-v4`

## Recovery rule

This document maps user capabilities and business behavior. Legacy source code is not treated as the target architecture. Each capability is classified as KEEP, ADAPT, MERGE, REPLACE, or DROP after comparison with existing V4 behavior.

## Initial capability inventory

| Feature ID | Legacy Evidence | User Goal | Inputs / Data | Outputs / Behavior | Current V4 Equivalent | Initial Classification | Gap / Next Action |
|---|---|---|---|---|---|---|---|
| LEGACY-001 | README: BOQ tracking and auto-calculation | Track work at item level | Unit/latrine, BOQ code, category, description, unit, planned qty, achieved qty | Item progress and roll-up | Project → Units → BOQ + execution aggregation | MERGE | Verify one authoritative Unit-BOQ state and progress event path |
| LEGACY-002 | README: weighted progress A/B/C | Calculate meaningful overall progress | Category weights + item achievement | Weighted overall % | V4 aggregation/progress | ADAPT | Preserve configurable weights; do not hard-code project categories |
| LEGACY-003 | README: quality gate per BOQ item | Prevent progress from ignoring quality | quality_pass, inspection date, inspector | Pass/Fail/Pending quality state | V4 Quality + remarks | MERGE | Link quality gate to execution/BOQ state rather than separate dataset |
| LEGACY-004 | README: remark tracking + escalation | Record and close defects | Unit, BOQ code, type, severity, description, action, deadline, status, photo | Open/closed remark lifecycle | V4 QualityScreen / remarks | MERGE | Map legacy severity/action/deadline semantics into V4 lifecycle |
| LEGACY-005 | README: daily site diary | Record daily field activity | Date, engineer, inspected units, accepted units, remarks, weather, manpower, equipment, notes | Daily operational record | V4 FieldDiaryScreen | MERGE | Ensure diary references current project/unit/execution/quality context |
| LEGACY-006 | Frontend tree: service worker + syncEngine + sync modules | Work when connectivity is unavailable | Local writes + queue metadata | Deferred sync to server | V4 offline-db + sync hooks + service worker | ADAPT | Test real offline create → queue → reconnect → server verification |
| LEGACY-007 | README: payment-ready progress export | Turn progress into reporting/IPC output | Aggregated completion data | Report/IPC-ready percentage data | V4 LegacyReportsScreen + aggregation | ADAPT | Ensure reports read the same execution-derived source of truth |
| LEGACY-008 | Frontend tree: RemarksManager.js and remark-related backend | Manage defects in field workflow | Remark CRUD + status | Lifecycle updates | V4 QualityScreen | MERGE | Recover useful workflow rules, not the old screen implementation |
| LEGACY-009 | README: bulk seed/create workflow | Create many operational units/items quickly | Unit registry + BOQ template data | Bulk-created units/items | V4 bulk import / bulk execution | ADAPT | Apply validation, idempotency and transaction boundaries |
| LEGACY-010 | Frontend tree: local db/storage/sync | Persist field data locally | Local DB/storage | Offline cache and queue | V4 offline-db | REPLACE | V4 architecture supersedes legacy storage mechanism; recover behavior only |

## Confirmed legacy system capabilities from Branch 8

The legacy system is an NRC latrine tracker for Al-Zahra district and exposes a workflow centered on a master unit registry, BOQ progress, quality remarks, daily logs, dashboard aggregation, and reporting. The README documents automatic roll-up from item → latrine → project, weighted progress, quality gates, remark tracking, and payment-ready progress export.

The Branch 8 tree also contains dedicated frontend service-worker, local-db/storage, and synchronization modules. These are evidence of offline-first field behavior and must be analyzed as user capabilities rather than copied into V4.

## Required next analysis

1. Inspect Branch 8 frontend screens/components to identify field-entry and bulk workflows.
2. Inspect backend CRUD/business rules for exact validation, roll-up, quality, remark, and diary semantics.
3. Compare every discovered capability with V4 existing modules before creating anything new.
4. Promote only behavior that closes a real V4 operational gap.

## Acceptance principle

A recovered capability is complete only when it is implemented in V4, uses the V4 API/data model, respects org/project isolation, is testable, and feeds the same operational source of truth used by execution, progress, quality, diary, reporting, and sync.
