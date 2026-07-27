"""Health Check Integration Test -- FieldOps V4.0

Minimal integration test to verify app assembly works.
"""
import pytest


@pytest.mark.integration
class TestHealthEndpoint:
    def test_health_returns_ok(self, client):
        response = client.get("/health")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "healthy"
        assert "version" in data
        assert "environment" in data

    def test_root_returns_app_info(self, client):
        response = client.get("/")
        assert response.status_code == 200
        data = response.json()
        assert data["name"] == "FieldOps SaaS V4.0"
        assert data["constitution"] == "v2.0-baseline-approved"
