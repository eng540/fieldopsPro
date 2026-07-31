# FieldOps V4.0 — Offline-First Field Operations Platform

A production-ready field operations management platform for humanitarian and construction projects. Built for offline-first mobile usage with real-time synchronisation.

## Architecture

```
fieldops-v4-source/
├── backend/                    # FastAPI + SQLAlchemy + PostgreSQL
│   ├── app/
│   │   ├── core/               # Config, DB, Security, Redis
│   │   └── modules/
│   │       ├── iam/            # Identity & Access Management (9 endpoints)
│   │       ├── projects/       # Projects, Units, BOQ (7 endpoints)
│   │       ├── execution/      # Work Orders, BOQ Progress (7 endpoints)
│   │       ├── sync/           # Offline Sync Engine (2 endpoints)
│   │       ├── quality/        # QC Remarks + Photos (6 endpoints)
│   │       ├── governance/     # Rule Engine + Decisions (6 endpoints)
│   │       └── reporting/      # Analytics + IPC Export (5 endpoints)
│   └── alembic/versions/       # 5 ordered migrations
├── frontend/                   # React + TypeScript + Vite PWA
│   ├── src/
│   │   ├── components/         # 9 screens + UI components
│   │   ├── stores/             # Zustand state (auth, projects, sync, governance)
│   │   └── lib/                # client.ts, db.ts (Dexie), sync.ts, crypto.ts
│   └── tests/e2e/              # Playwright smoke tests (27 tests, 8 suites)
└── infrastructure/
    └── docker/                 # docker-compose.yml + Dockerfiles
```

## API: 42 Endpoints

| Module      | Endpoints | Key Capabilities |
|-------------|-----------|-----------------|
| `/auth`     | 9         | JWT, refresh, sessions, RBAC |
| `/projects` | 7         | Projects, Units, BOQ items |
| `/execution`| 7         | Work orders + BOQ progress (Monotonic ADR-003) |
| `/sync`     | 2         | Pull/Push with Exactly-Once + Conflict Resolution |
| `/quality`  | 6         | Remarks (UUID idempotent) + photo upload |
| `/governance`| 6        | Rule engine + explainable decisions + overrides |
| `/reporting`| 5         | Summary, project progress, WO breakdown, IPC export |

## Constitutional Principles (ADRs)

| ADR | Rule |
|-----|------|
| ADR-001 | Modular Monolith — no cross-module DB access |
| ADR-002 | Offline-First Sync — Exactly-Once via `operation_uuid` |
| ADR-003 | Monotonic Progress — `completion_pct` cannot decrease without rework |
| ADR-004 | JWT Minimalism — identity only; roles resolved server-side from DB |

## Quick Start

```bash
# 1. Copy environment variables
cp .env.example .env  # Edit as needed

# 2. Start services
docker compose -f infrastructure/docker/docker-compose.yml up -d

# 3. Run migrations (wait ~5s for DB to be ready)
docker exec fieldops-api alembic upgrade head

# 4. Access
#    API Swagger: http://localhost:8000/docs
#    Frontend:    http://localhost:3000
```

## Development

```bash
# Backend
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000

# Frontend
cd frontend
npm install
npm run dev       # http://localhost:3000
npm run build     # Production build
npm run test      # Unit tests (Vitest)
npx playwright test  # E2E tests
```

## Sprints Completed

| Sprint | Scope | Tests |
|--------|-------|-------|
| Sprint-0 | Baseline, infra, CI/CD | — |
| Sprint-1 | IAM — Auth, Sessions, RBAC | 78 tests |
| Sprint-2 | Execution CRUD + Sync Engine (CP-1 to CP-4) | 167 tests |
| Sprint-3 | Projects, Quality, Governance, Reporting | 195 tests |
| Sprint-4 | Integration fixes, Zero Tech Debt, Clean Architecture | 27 E2E tests |
