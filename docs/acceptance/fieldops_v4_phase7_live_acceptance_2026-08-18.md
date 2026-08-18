# FieldOps V4 — Live Acceptance Report

**Date:** 2026-08-18  
**Environment:** `https://satisfied-cat-production-d448.up.railway.app/`  
**API base displayed by the deployed frontend:** `https://fieldopspro-production.up.railway.app/api/v1`  
**Candidate branch:** `feature/fieldops-v4-completion`  
**Candidate PR:** [#22](https://github.com/eng540/fieldopsPro/pull/22)

## Scope and evidence rule

This report records only observations made against the currently deployed site. The deployed site is not the unmerged completion branch, so a live failure in the deployed build is treated as a release blocker and as evidence about the deployed artifact, not as proof that the local branch has the same behavior. Local branch claims are supported separately by Git commits and automated test output.

## Acceptance matrix

| Area | Live result | Evidence | Gate status |
|---|---|---|---|
| Login | The supplied `admin@fieldops.dev` credentials authenticated successfully twice. | Browser session reached the authenticated dashboard and recorded login activity. | Passed |
| Project selection | `QA Demo Residential Compound 2026` / `QA-DEMO-2026` loaded. | Dashboard and workflow rail displayed the selected project. | Passed |
| Fast Entry | The matrix rendered 6 units × 8 BOQ items, but cells showed `تهيئة مطلوبة`; the deployed page did not expose the new `تهيئة الحالات` action. | Fast Entry browser capture and page text. | Blocked by deployed artifact mismatch |
| PWA empty sync | Queue showed 0; pressing sync produced `جاري المزامنة...` followed by `تمت المزامنة بنجاح`. | Field Mobile Center browser capture. | Passed for empty queue only |
| Excel upload | The file input accepted the fixture transport, then the screen entered `تعذر تحميل هذه الشاشة` and no preview/import/summary appeared. | Browser upload result and error boundary. | Failed; release blocker |
| Excel duplicate/idempotency | Not reached because the deployed screen crashed after upload. | No preview or commit response available. | Blocked |
| Offline non-empty queue | Not exercised with a live queued record. | No non-empty server-backed fixture was present. | Not proven |
| Quality gate | Dashboard showed one open major remark and `بوابة الجودة: BLOCKED`. | Dashboard page text. | Correctly blocked |

## Excel crash diagnosis and branch repair

The local `BulkImportScreen` contained a Radix Select option with an empty `SelectItem` value for the column-mapping skip option. Radix Select requires a non-empty item value, making this a credible direct cause of the deployed error boundary immediately after a valid `.xlsx` file was parsed. The completion branch replaces the empty option with the `__skip__` sentinel and normalizes it back to an empty mapping internally. The repair is committed as `5ec687a` and passed TypeScript, Next production build, backend tests, and compileall.

## Local evidence for the candidate branch

The candidate branch currently passes `39 passed, 2 skipped` in the backend suite, Python compileall, TypeScript `--noEmit`, and Next production build. The latest commits are `d085a61` for Excel/sync observability, `6bdb4ee` for Quality/Diary offline workflows, `08d4e49` for retry-safe queued operations, `5ec687a` for the Excel mapping crash repair, and `0b736c5` for cleanup-safe acceptance fixtures.

## Release decision

The system is **not Production Ready**. The PR must not be merged solely on the local green checks because live Excel acceptance failed in the deployed artifact, Fast Entry is still running an older artifact without the new initialization action, and non-empty Offline/Reconnect/Retry has not been proven against a deployed candidate. The next valid gate is deployment of the PR candidate to a real staging target, followed by rerunning this matrix with the two cleanup-safe fixtures and a non-empty offline queue.
