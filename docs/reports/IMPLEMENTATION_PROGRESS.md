# FieldOps V4 — Implementation Progress

## Scope delivered in this slice

This execution slice applies the approved recovery direction to the `fieldops-v4` architecture. It closes the legacy unit-context BOQ creation path, routes offline unit progress through the same Event Pipeline used online, makes Fast Entry distinguish assignment and execution-state conditions, mounts Excel routes that were not previously composed into the projects router, adds preview and dry-run behavior for Units and Master BOQ imports, and centralizes project creation authentication through `apiRequest`.

The authentication lifecycle now gives login a bounded 30-second warm-up window and refresh a bounded 20-second window. Ordinary API requests remain on the 10-second timeout. This change is based on the observed Railway cold-start probe that reached the previous 10-second limit.

## Evidence

| Check | Result |
|---|---|
| Backend suite | `33 passed, 2 skipped` |
| Compileall | Passed |
| TypeScript | Passed |
| Next production build | Passed |
| Project route smoke | Canonical BOQ and Excel preview/import routes mounted |
| Git diff check | Passed |
| Branch | `feature/fieldops-v4-core-execution` |
| Pull Request | `https://github.com/eng540/fieldopsPro/pull/21` |
| Latest commit | `27ac3eb3e731b96272ab6d5c6308f1a3254c9888` |

## Explicit limits

The runtime acceptance gate is not marked complete. The live browser login probe reached the old 10-second timeout before the auth timeout change was deployed, and no production migration or backfill has been claimed from local evidence. Staging must be deployed from the PR branch, then Mhsam and QA Demo must be checked for real assignment counts, state counts, editable Fast Entry cells, Excel preview, offline queue/reconnect, and reload persistence.

No capability is considered complete merely because a route exists. The acceptance requirement is persistence evidence, reload evidence, idempotent retry, conflict handling, and org/project isolation.
