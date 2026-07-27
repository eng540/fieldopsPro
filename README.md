# FieldOps SaaS V4.0

**Status:** `Sprint-0 — Platform Foundation`  
**Constitution:** v2.0 BASELINE APPROVED  
**Architecture:** Modular Monolith + Offline-First SaaS

---

## Quick Start

```bash
# Clone and start
make dev          # Start all services (Docker Compose)
make test         # Run full test suite
make migrate      # Run database migrations
make lint         # Run linters and type checks
```

## Project Structure

```
fieldops-v4/
├── infrastructure/     # Docker, Terraform, K8s manifests
├── backend/            # FastAPI + SQLAlchemy + Alembic
│   ├── app/
│   │   ├── core/       # DB, Config, Security, Events
│   │   └── modules/    # iam, projects, execution, quality, governance, reporting
│   └── alembic/
├── frontend/           # React 18 + Vite + TypeScript + Zustand
│   ├── src/
│   │   ├── stores/     # Zustand Module Stores
│   │   ├── modules/    # Mirror backend modules
│   │   └── lib/        # Dexie, Sync Engine, Crypto
│   └── tests/
├── docs/
│   ├── openapi/        # API Contract (Source of Truth)
│   └── architecture/   # ADRs
└── .github/workflows/   # CI/CD
```

## Architecture Principles (Constitutional)

1. **Multi-Tenant Isolation:** `org_id + project_scope + role_scope`
2. **Server-Reconciled State:** Sync ≠ Truth
3. **Monotonic Progress:** Downgrade requires Rework Flag + Audit
4. **Defense in Depth:** JWT Minimalism → Server Auth → RLS → Encryption → WORM Audit
5. **Explainable Governance:** Every decision returns `{decision, matched_rule, reason, policy_version}`
6. **Exactly-Once Sync:** `operation_uuid` + `processed_operations`
7. **No Merge Without Tests:** Testing is constitutional
8. **OpenAPI-First:** Contract precedes code

## Sprint-0 Exit Criteria

- [x] Repository Structure
- [x] Docker Compose Foundation
- [x] OpenAPI v0.1 Draft
- [x] CI/CD Baseline
- [x] Testing Baseline
- [x] ADR Documentation
- [ ] Alembic Initial Migration (Pending Sprint-1)

## License

Proprietary — NRC / FieldOps Consortium
