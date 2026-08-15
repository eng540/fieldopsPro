# FieldOps V4 — Recovered Legacy User Workflows

## Rule

The following workflows are reconstructed from the user-facing behavior of `Ncrpro110/eng540-patch-8`. They describe what the user needs to accomplish, not how the old code accomplished it.

## 1. Rapid execution entry

### User goal
Record the same progress operation for many units quickly.

### Legacy behavior recovered

- Work in a matrix/list rather than opening every unit individually.
- Search by unit or BOQ.
- Filter operational status.
- Edit multiple rows before committing.
- Apply a common percentage to a visible selection.
- Preserve a local change buffer.
- Save through a controlled mutation path.
- Support rework when progress is reduced.

### V4 target

`Project → Execution Workspace → Speed Entry`

The V4 event pipeline remains authoritative. The UI is an optimized input surface over that pipeline.

## 2. Bulk operational action

### User goal
Apply one validated operation to a selected group of units.

### Workflow

`Select units → Select BOQ/action → Set value/status → Validate → Apply → Review changed count → Persist/sync → Refresh roll-ups`

### V4 rules

- Bulk action must be project-scoped.
- Every affected unit/BOQ pair must be validated against current state/version.
- Partial failure must be visible; no silent success.
- Offline bulk operations must enter the existing V4 queue rather than inventing a second queue.

## 3. Unit 360 operational view

### User goal
Answer "What is the current state of this unit?" without visiting several disconnected screens.

### Target view

`Unit → Progress + Execution + Quality + Remarks + Actions + Diary + Evidence + Sync + History`

### Required drill-down

- Unit → BOQ item
- BOQ item → execution state
- Execution → quality gate
- Quality → finding/action/evidence
- Finding → resolution history

## 4. Quality inspection worklist

### User goal
Find work that needs inspection, rework or closure.

### Target workflow

`Quality Control Center → filter (critical/major/pending/rework/overdue) → unit → BOQ → finding → action → evidence → inspection → close`

The legacy Quality Inspector pattern is therefore recovered as a work queue, not copied as a screen.

## 5. Smart quality finding

### User goal
Record a recurring field defect quickly and consistently.

### Target workflow

`New Finding → select/search template → adapt description → severity → action → deadline → responsible party → before evidence → submit`

Resolution workflow:

`Finding → corrective action → after evidence → inspection → resolved/closed`

## 6. Daily field diary

### User goal
Produce a daily field record without duplicating information already captured elsewhere.

### Target workflow

`Project + date → system-derived operational statistics → weather/workforce/equipment → observations → GPS/photos → save → parent refresh`

The diary must consume V4 operational data where available rather than asking the user to re-enter it.

## 7. BOQ drill-down

### User goal
Understand a BOQ item from project level down to affected units.

### Target workflow

`Project → BOQ Analytics → planned/achieved/remaining → status/quality breakdown → affected units → unit details`

## 8. Governance decision

### User goal
Turn field evidence into a controlled operational/payment decision.

### Target workflow

`Execution + Quality + Open Actions + Evidence → rule evaluation → system recommendation → authorized human review → decision/override reason → audit → reporting/payment eligibility`

System recommendation must never silently become an irreversible human decision.

## 9. Reporting

### User goal
Produce a report from the same operational truth used by the application.

### Target workflow

`Current project context → report type → filters/date range → live operational data → generate → export → audit/report metadata`

Report families:

- Executive summary
- Project progress
- BOQ report
- Unit × BOQ matrix
- Quality/findings
- Daily diary
- Governance/decision
- Payment-ready progress

## 10. Offline field scenario

### User goal
Continue work with unreliable connectivity.

### Target workflow

`Select project → network lost → create/update locally → visible pending state → reconnect → sync → server validation → conflict if necessary → user resolution → final refreshed state`

No local mutation may disappear silently.

## 11. End-to-end acceptance scenarios

### Scenario A — Progress

`Login → Project → Execution → Speed Entry → save → Progress roll-up → Dashboard → Report`

### Scenario B — Quality

`Execution → Quality Gate → Finding → Action → Before evidence → Rework → Re-execution → After evidence → Inspection → Closure`

### Scenario C — Offline

`Login → Project → Offline → Speed/Bulk/Remark/Diary mutation → queue → reconnect → sync → conflict if concurrent change → resolve → verify server state`

### Scenario D — Governance

`Updated execution + quality → governance recommendation → authorized review → decision → audit → payment/reporting output`
