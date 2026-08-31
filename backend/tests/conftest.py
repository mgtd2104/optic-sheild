# =============================================================================
# IBVAP Backend - Pytest Configuration & Fixtures
# =============================================================================

import asyncio
import base64
import os
import sys
from pathlib import Path
from typing import AsyncGenerator, Generator

import pytest
import pytest_asyncio
from fastapi.testclient import TestClient
from httpx import AsyncClient, ASGITransport

# Add backend to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from main import app, settings

# =============================================================================
# Test Configuration
# =============================================================================

# Set test environment
os.environ["ENVIRONMENT"] = "testing"
os.environ["API_KEY"] = "test-api-key-12345"
os.environ["JWT_SECRET"] = "test-jwt-secret"
os.environ["LOG_LEVEL"] = "DEBUG"

# Override settings for testing
settings.API_KEY = "test-api-key-12345"
settings.JWT_SECRET = "test-jwt-secret"
settings.ENVIRONMENT = "testing"


# =============================================================================
# Fixtures
# =============================================================================

@pytest.fixture(scope="session")
def event_loop() -> Generator[asyncio.AbstractEventLoop, None, None]:
    """Create event loop for async tests."""
    loop = asyncio.get_event_loop_policy().new_event_loop()
    yield loop
    loop.close()


@pytest.fixture(scope="function")
def test_client() -> TestClient:
    """Create synchronous test client."""
    return TestClient(app)


@pytest.fixture(scope="function")
async def async_client() -> AsyncGenerator[AsyncClient, None]:
    """Create asynchronous test client."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        yield client


@pytest.fixture
def valid_api_key() -> str:
    """Valid API key for testing."""
    return "test-api-key-12345"


@pytest.fixture
def invalid_api_key() -> str:
    """Invalid API key for testing."""
    return "invalid-key"


@pytest.fixture
def sample_image_base64() -> str:
    """Generate a simple test image as base64."""
    import cv2
    import numpy as np
    
    # Create a simple test image (100x100 RGB)
    img = np.zeros((100, 100, 3), dtype=np.uint8)
    img[25:75, 25:75] = [255, 0, 0]  # Red square in center
    
    _, buffer = cv2.imencode('.jpg', img)
    return f"data:image/jpeg;base64,{base64.b64encode(buffer).decode('utf-8')}"


@pytest.fixture
def sample_image_bytes() -> bytes:
    """Generate test image bytes."""
    import cv2
    import numpy as np
    
    img = np.zeros((100, 100, 3), dtype=np.uint8)
    img[25:75, 25:75] = [255, 0, 0]
    
    _, buffer = cv2.imencode('.jpg', img)
    return buffer.tobytes()


# =============================================================================
# Test Helpers
# =============================================================================

def create_jwt_token(username: str = "testuser", secret: str = "test-jwt-secret") -> str:
    """Create a valid JWT token for testing."""
    from jose import jwt
    from datetime import datetime, timedelta
    
    expire = datetime.utcnow() + timedelta(minutes=60)
    payload = {
        "sub": username,
        "exp": expire,
        "iat": datetime.utcnow(),
        "scopes": ["read", "write"]
    }
    return jwt.encode(payload, secret, algorithm="HS256")


def auth_headers(api_key: str = None, jwt_token: str = None) -> dict:
    """Create authentication headers."""
    headers = {}
    if api_key:
        headers["X-API-Key"] = api_key
    if jwt_token:
        headers["Authorization"] = f"Bearer {jwt_token}"
    return headers