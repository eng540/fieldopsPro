# FieldOps V4 — Recovered Legacy Business Rules

## Scope

These rules are extracted as operational intent from Ncrpro110 Patch 8 and must be re-expressed using FieldOps V4 services, event pipeline, RLS, audit and sync architecture.

## Execution rules

1. A progress update is scoped to a project/unit/BOQ context.
2. Progress cannot exceed the valid operational boundary for the item.
3. Reducing recorded progress is a controlled rework operation and requires an explicit reason.
4. Bulk updates are equivalent to a set of individually valid operations; bulk UI must not bypass validation.
5. A successful mutation invalidates/refetches the parent operational context where downstream screens depend on it.
6. Offline mutations must retain enough context for deterministic server validation after reconnect.
7. Concurrent changes must use version/conflict protection rather than last-write-wins without visibility.

## Quality rules

1. Completion and quality acceptance are different concepts.
2. Work that is complete but awaiting inspection remains pending quality acceptance.
3. Rejected work can return to execution as rework.
4. A quality finding may have severity, action, deadline, responsible party and evidence.
5. Resolution requires evidence where the project/workflow requires it.
6. Before/after evidence represents a corrective-action lifecycle, not two unrelated photos.
7. Closing a finding must not erase its historical state.

## Diary rules

1. Diary entries are project-scoped.
2. Operational statistics should be derived from current project data whenever the system already knows them.
3. Manual observations remain distinct from derived statistics.
4. Saving a diary entry must refresh dependent operational views.
5. Offline diary drafts must remain associated with their selected project.

## Governance rules

1. System recommendation and human decision are separate states.
2. A human override requires authorization and an explicit reason.
3. Decisions affecting payment eligibility must be traceable to the execution/quality evidence available at decision time.
4. Governance decisions are auditable and should not mutate history invisibly.
5. A hold/rework/stop recommendation should be explainable from observable operational conditions.

## Reporting rules

1. Reports consume operational truth from V4 services rather than a parallel manually maintained dataset.
2. Progress reports distinguish executed, accepted and payment-eligible quantities where those concepts differ.
3. Matrix reports preserve the Unit × BOQ relationship.
4. Report filters must respect project/org authorization.

## Offline/sync rules

1. Local data is not silently discarded because the network is unavailable.
2. Queued operations are visible through sync state.
3. A failed refresh token flow must not expose protected data or silently retry indefinitely.
4. Conflicts are surfaced to the user when automatic reconciliation is unsafe.
5. Conflict resolution creates a traceable outcome.

## Architecture boundary

These are business rules only. Do not implement them by importing Ncrpro110 modules, endpoints, database tables, token handling or IndexedDB schema. V4 implementation must use:

- current authentication/API client;
- current RLS and authorization;
- current execution event pipeline;
- current quality lifecycle;
- current project context;
- current offline queue/sync/conflict services;
- current reporting/governance modules.
