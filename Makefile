# FieldOps V4.0 — Platform Engineering Makefile
.PHONY: dev test migrate lint format clean install backend-install frontend-install

# ─────────────────────────────────────────
# DEVELOPMENT
# ─────────────────────────────────────────

dev:
	@echo "🚀 Starting FieldOps V4.0 Development Environment..."
	docker compose -f infrastructure/docker/docker-compose.yml up --build

dev-detached:
	docker compose -f infrastructure/docker/docker-compose.yml up --build -d

dev-down:
	docker compose -f infrastructure/docker/docker-compose.yml down -v

# ─────────────────────────────────────────
# INSTALLATION
# ─────────────────────────────────────────

install: backend-install frontend-install

backend-install:
	cd backend && poetry install --no-root

frontend-install:
	cd frontend && npm install

# ─────────────────────────────────────────
# TESTING
# ─────────────────────────────────────────

test: test-backend test-frontend test-e2e

test-backend:
	cd backend && poetry run pytest -xvs --cov=app --cov-report=term-missing

test-frontend:
	cd frontend && npm run test -- --run

test-e2e:
	cd frontend && npx playwright test --project=chromium

# ─────────────────────────────────────────
# DATABASE
# ─────────────────────────────────────────

migrate:
	cd backend && poetry run alembic upgrade head

migrate-make:
	@read -p "Migration name: " name; 	cd backend && poetry run alembic revision --autogenerate -m "$$name"

# ─────────────────────────────────────────
# CODE QUALITY
# ─────────────────────────────────────────

lint: lint-backend lint-frontend

lint-backend:
	cd backend && poetry run ruff check app tests
	cd backend && poetry run mypy app --strict

lint-frontend:
	cd frontend && npm run lint
	cd frontend && npx tsc --noEmit

format:
	cd backend && poetry run ruff format app tests
	cd frontend && npm run format

# ─────────────────────────────────────────
# OPENAPI
# ─────────────────────────────────────────

validate-api:
	@echo "🔍 Validating OpenAPI Contract..."
	npx @redocly/cli lint docs/openapi/openapi.yaml

gen-api-docs:
	npx @redocly/cli build-docs docs/openapi/openapi.yaml -o docs/api/index.html

# ─────────────────────────────────────────
# CLEANUP
# ─────────────────────────────────────────

clean:
	find . -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true
	find . -type d -name .pytest_cache -exec rm -rf {} + 2>/dev/null || true
	find . -type d -name node_modules -exec rm -rf {} + 2>/dev/null || true
	find . -type d -name dist -exec rm -rf {} + 2>/dev/null || true
	find . -type d -name build -exec rm -rf {} + 2>/dev/null || true
	docker system prune -f

# ─────────────────────────────────────────
# UTILITIES
# ─────────────────────────────────────────

logs-api:
	docker compose -f infrastructure/docker/docker-compose.yml logs -f api

logs-db:
	docker compose -f infrastructure/docker/docker-compose.yml logs -f postgres

shell-api:
	docker compose -f infrastructure/docker/docker-compose.yml exec api bash

shell-db:
	docker compose -f infrastructure/docker/docker-compose.yml exec postgres psql -U fieldops -d fieldops
