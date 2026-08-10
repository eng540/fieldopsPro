# FieldOps V4.0 — Makefile
# Unified development commands

.PHONY: help dev dev-api dev-web build up down seed migrate test

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'

# ── Development ──────────────────────────────────────────
dev: ## Start all services (Docker Compose)
	docker compose up --build

dev-api: ## Start FastAPI only (requires running PostgreSQL + Redis)
	cd backend && uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload

dev-web: ## Start Next.js frontend only
	npm run dev

# ── Database ─────────────────────────────────────────────
seed: ## Seed database with demo data
	cd backend && python -m scripts.seed

migrate: ## Run Alembic migrations
	cd backend && alembic upgrade head

migrate-create: ## Create new migration (usage: make migrate-create msg="description")
	cd backend && alembic revision --autogenerate -m "$(msg)"

# ── Docker ───────────────────────────────────────────────
up: ## Start all containers
	docker compose up -d --build

down: ## Stop all containers
	docker compose down

logs: ## Follow container logs
	docker compose logs -f

# ── Build ────────────────────────────────────────────────
build: ## Build frontend for production
	npm run build

build-api: ## Build API Docker image
	docker compose build api

build-web: ## Build Web Docker image
	docker compose build web

# ── Testing ──────────────────────────────────────────────
test: ## Run all tests
	cd backend && python -m pytest tests/ -v

test-api: ## Run API tests only
	cd backend && python -m pytest tests/ -v -k "not integration"

test-integration: ## Run integration tests
	cd backend && python -m pytest tests/integration/ -v

# ── Cleanup ──────────────────────────────────────────────
clean: ## Remove build artifacts
	rm -rf .next node_modules/.cache backend/__pycache__
	find . -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true

reset-db: ## Reset database (WARNING: deletes all data)
	docker compose down -v
	docker compose up -d postgres redis
	@echo "Waiting for PostgreSQL..."
	@sleep 3
	$(MAKE) migrate
	$(MAKE) seed
