# Docker Entrypoint Initialization Scripts

This directory contains SQL scripts that PostgreSQL executes on first container startup.

Files here are mounted to `/docker-entrypoint-initdb.d/` in the PostgreSQL container.

## Usage

Place `.sql`, `.sql.gz`, or `.sh` files here to:
- Create initial databases
- Set up RLS policies
- Seed reference data
- Configure extensions

## Naming Convention

Scripts execute in alphabetical order. Use numeric prefixes:
- `01-init-extensions.sql`
- `02-create-rls-policies.sql`
- `03-seed-reference-data.sql`

## Security Note

DO NOT place sensitive data here. Use environment variables or Docker secrets.
