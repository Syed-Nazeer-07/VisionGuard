import pytest
from httpx import AsyncClient

@pytest.mark.asyncio
async def test_health_endpoint(client: AsyncClient):
    response = await client.get("/api/v1/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "healthy"
    assert data["service"] == "visionguard-backend"
    assert "version" in data
    assert isinstance(data["model_ready"], bool)
    assert "execution_provider" in data
    assert isinstance(data["available_providers"], list)

@pytest.mark.asyncio
async def test_root_endpoint(client: AsyncClient):
    response = await client.get("/")
    assert response.status_code == 200
    data = response.json()
    assert data["service"] == "VisionGuard AI Backend"
    assert data["health"] == "/api/v1/health"

@pytest.mark.asyncio
async def test_execution_provider_configuration(client: AsyncClient):
    response = await client.get("/api/v1/health")
    assert response.status_code == 200
    data = response.json()
    provider = data["execution_provider"]
    assert provider in ("DmlExecutionProvider", "CPUExecutionProvider")

