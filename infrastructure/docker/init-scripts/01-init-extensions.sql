-- PostgreSQL Initialization -- FieldOps V4.0
-- This script runs on first container startup

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Note: Actual RLS policies are managed by Alembic migrations
-- This file is a placeholder for any pre-migration setup
