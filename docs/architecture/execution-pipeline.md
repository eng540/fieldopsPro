# Execution Pipeline — Canonical Architecture

## Objective

FieldOps execution mutations have one authoritative path. The public API must never choose between two independent event engines.

## Runtime path

`POST /api/v1/execution/events`
→ `execution.router.submit_events`
→ `execution.service.process_event_intent`
→ idempotency lookup
→ row lock + optimistic version check
→ business-rule validation
→ append-only `execution_events`
→ materialize `unit_boq_progress`
→ cache response in `event_sync_logs`
→ commit through the request transaction/savepoint.

## Compatibility path

`POST /api/v1/execution/progress` and `/bulk-progress` translate legacy absolute progress requests into `DELTA_ADD` or `REWORK` intents. They never issue `SNAPSHOT_SET`.

## Concurrency guarantees

- `state_version` is mandatory at the event contract boundary.
- `UnitBoQProgress` is locked with `FOR UPDATE` before state calculation.
- A stale version produces a structured conflict rather than overwriting newer work.
- Each event in a batch executes inside its own nested transaction.
- `sync_uuid` provides retry idempotency and the original response is cached.

## Governance guarantees

- `SNAPSHOT_SET`: `SUPER_ADMIN` only.
- `DATA_CORRECTION`: `ORG_ADMIN` / `SUPER_ADMIN`.
- `REWORK`: `PROJECT_MANAGER` / `ORG_ADMIN` / `SUPER_ADMIN`.
- `INITIAL_STATE`: initialization/migration only; never accepted as a normal client mutation.

## Read side

Event history, current-state queries and aggregation remain read-only capabilities mounted alongside the canonical mutation router.

## Migration rule

The legacy `event_router.py` / `event_service.py` implementation remains in the repository temporarily for source compatibility, but is not mounted by the EXECUTION module. This is intentional: one API path, one business-rule engine, one transaction model.

## Acceptance gate

A release is not considered execution-ready until CI verifies:

1. the canonical `/events` route is unique;
2. BOQ events require explicit unit context and expected version;
3. stale writes produce conflicts;
4. retries are idempotent;
5. nested transactions isolate failed events;
6. legacy progress adapters preserve monotonic/rework rules;
7. migrations and the complete test suite pass.
