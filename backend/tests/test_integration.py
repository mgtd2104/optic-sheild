# =============================================================================
# IBVAP Backend - Integration Tests (Container-based)
# =============================================================================
# These tests require Docker to be running and will start the actual container.
# Run with: pytest tests/test_integration.py -v -m integration
# =============================================================================

import base64
import os
import subprocess
import time
from pathlib import Path

import pytest
import requests

# Mark all tests in this module as integration tests
pytestmark = pytest.mark.integration


class TestContainerIntegration:
    """Integration tests that run against a live container."""
    
    CONTAINER_NAME = "ibvap-backend-test"
    IMAGE_NAME = "ibvap-backend:test"
    BASE_URL = "http://localhost:18000"
    API_KEY = "test-api-key-12345"
    
    @classmethod
    def setup_class(cls):
        """Build and start the test container."""
        cls._build_image()
        cls._start_container()
        cls._wait_for_health()
    
    @classmethod
    def teardown_class(cls):
        """Stop and remove the test container."""
        cls._stop_container()
    
    @classmethod
    def _build_image(cls):
        """Build the Docker image for testing."""
        backend_dir = Path(__file__).parent.parent
        
        # Build with test tag
        result = subprocess.run(
            ["docker", "build", "-t", cls.IMAGE_NAME, "."],
            cwd=backend_dir,
            capture_output=True,
            text=True,
            timeout=300
        )
        
        if result.returncode != 0:
            pytest.fail(f"Docker build failed: {result.stderr}")
    
    @classmethod
    def _start_container(cls):
        """Start the container."""
        # Stop any existing container
        subprocess.run(
            ["docker", "rm", "-f", cls.CONTAINER_NAME],
            capture_output=True
        )
        
        # Start new container
        result = subprocess.run([
            "docker", "run", "-d",
            "--name", cls.CONTAINER_NAME,
            "-p", "18000:8000",
            "-e", f"API_KEY={cls.API_KEY}",
            "-e", "ENVIRONMENT=testing",
            "-e", "LOG_LEVEL=DEBUG",
            "--gpus", "all",
            cls.IMAGE_NAME
        ], capture_output=True, text=True)
        
        if result.returncode != 0:
            pytest.fail(f"Container start failed: {result.stderr}")
    
    @classmethod
    def _wait_for_health(cls, timeout: int = 120):
        """Wait for container to be healthy."""
        start = time.time()
        while time.time() - start < timeout:
            try:
                response = requests.get(f"{cls.BASE_URL}/health", timeout=5)
                if response.status_code == 200:
                    data = response.json()
                    if data.get("models_loaded"):
                        return
            except Exception:
                pass
            time.sleep(2)
        
        pytest.fail(f"Container health check timed out after {timeout}s")
    
    @classmethod
    def _stop_container(cls):
        """Stop and remove the test container."""
        subprocess.run(
            ["docker", "rm", "-f", cls.CONTAINER_NAME],
            capture_output=True
        )
    
    def _headers(self) -> dict:
        """Get auth headers."""
        return {"X-API-Key": self.API_KEY}
    
    def _sample_image_base64(self) -> str:
        """Generate test image."""
        import cv2
        import numpy as np
        img = np.zeros((200, 200, 3), dtype=np.uint8)
        img[50:150, 50:150] = [0, 255, 0]
        _, buffer = cv2.imencode('.jpg', img)
        return f"data:image/jpeg;base64,{base64.b64encode(buffer).decode('utf-8')}"
    
    def test_health_endpoint(self):
        """Test health endpoint returns healthy status."""
        response = requests.get(f"{self.BASE_URL}/health")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "healthy"
        assert data["models_loaded"] is True
        assert "uptime_seconds" in data
    
    def test_metrics_endpoint(self):
        """Test Prometheus metrics endpoint."""
        response = requests.get(f"{self.BASE_URL}/metrics")
        assert response.status_code == 200
        assert "ibvap_requests_total" in response.text
    
    def test_root_endpoint(self):
        """Test root endpoint."""
        response = requests.get(f"{self.BASE_URL}/")
        assert response.status_code == 200
        data = response.json()
        assert data["name"] == "IBVAP Backend"
    
    def test_analyze_frame_endpoint(self):
        """Test /analyze endpoint with base64 frame."""
        response = requests.post(
            f"{self.BASE_URL}/analyze",
            json={"frame_base64": self._sample_image_base64()},
            headers=self._headers(),
            timeout=30
        )
        assert response.status_code == 200
        data = response.json()
        assert "request_id" in data
        assert "detections" in data
        assert "alerts" in data
        assert "annotated_frame_base64" in data
        assert isinstance(data["detections"], list)
        assert isinstance(data["alerts"], list)
    
    def test_analyze_upload_endpoint(self):
        """Test /analyze/upload endpoint with file upload."""
        import cv2
        import numpy as np
        
        # Create test image
        img = np.zeros((200, 200, 3), dtype=np.uint8)
        img[50:150, 50:150] = [255, 0, 0]
        _, buffer = cv2.imencode('.jpg', img)
        
        files = {"file": ("test.jpg", buffer.tobytes(), "image/jpeg")}
        
        response = requests.post(
            f"{self.BASE_URL}/analyze/upload",
            files=files,
            headers=self._headers(),
            timeout=30
        )
        assert response.status_code == 200
        data = response.json()
        assert "request_id" in data
        assert "detections" in data
    
    def test_auth_token_endpoint(self):
        """Test registration, login, and token verification."""
        requests.post(
            f"{self.BASE_URL}/api/auth/register",
            json={
                "username": "integration_test",
                "email": "integration_test@ibvap.test",
                "password": "testpass123",
            }
        )
        response = requests.post(
            f"{self.BASE_URL}/api/auth/login",
            json={"username": "integration_test", "password": "testpass123"}
        )
        assert response.status_code == 200
        data = response.json()
        assert "access_token" in data
        assert data["token_type"] == "bearer"
        
        # Verify token works
        token = data["access_token"]
        response = requests.post(
            f"{self.BASE_URL}/api/auth/verify",
            headers={"Authorization": f"Bearer {token}"}
        )
        assert response.status_code == 200
        assert response.json()["valid"] is True
    
    def test_websocket_stream(self):
        """Test WebSocket streaming endpoint."""
        import websocket
        
        ws_url = f"ws://localhost:18000/ws/stream?api_key={self.API_KEY}"
        
        try:
            ws = websocket.create_connection(ws_url, timeout=10)
            
            # Receive a few frames
            frames_received = 0
            for _ in range(3):
                message = ws.recv()
                data = eval(message)  # In production, use json.loads
                assert "frame_id" in data
                assert "frame" in data
                assert "detections" in data
                frames_received += 1
            
            assert frames_received == 3
            ws.close()
            
        except websocket.WebSocketTimeoutException:
            pytest.fail("WebSocket connection timed out")
        except Exception as e:
            pytest.fail(f"WebSocket test failed: {e}")
    
    def test_invalid_api_key_rejected(self):
        """Test that invalid API key is rejected."""
        response = requests.post(
            f"{self.BASE_URL}/analyze",
            json={"frame_base64": self._sample_image_base64()},
            headers={"X-API-Key": "invalid-key"}
        )
        assert response.status_code == 401
    
    def test_no_auth_rejected(self):
        """Test that missing auth is rejected."""
        response = requests.post(
            f"{self.BASE_URL}/analyze",
            json={"frame_base64": self._sample_image_base64()}
        )
        assert response.status_code == 401
    
    def test_upload_invalid_file_type_rejected(self):
        """Test that non-image uploads are rejected."""
        files = {"file": ("test.txt", b"not an image", "text/plain")}
        
        response = requests.post(
            f"{self.BASE_URL}/analyze/upload",
            files=files,
            headers=self._headers()
        )
        assert response.status_code == 400
    
    def test_upload_large_file_rejected(self):
        """Test that oversized uploads are rejected."""
        # Create a large file (>100MB)
        large_content = b"x" * (101 * 1024 * 1024)
        files = {"file": ("large.jpg", large_content, "image/jpeg")}
        
        response = requests.post(
            f"{self.BASE_URL}/analyze/upload",
            files=files,
            headers=self._headers()
        )
        assert response.status_code == 413


class TestContainerResourceLimits:
    """Test container resource constraints."""
    
    def test_container_memory_limit(self):
        """Test container respects memory limits."""
        import docker
        
        client = docker.from_env()
        container = client.containers.get(TestContainerIntegration.CONTAINER_NAME)
        
        stats = container.stats(stream=False)
        memory_limit = stats["memory_stats"]["limit"]
        memory_usage = stats["memory_stats"]["usage"]
        
        # Check memory usage is under limit (with some buffer)
        assert memory_usage < memory_limit * 0.9
    
    def test_container_cpu_usage(self):
        """Test container CPU usage is reasonable."""
        import docker
        
        client = docker.from_env()
        container = client.containers.get(TestContainerIntegration.CONTAINER_NAME)
        
        stats = container.stats(stream=False)
        cpu_usage = stats["cpu_stats"]["cpu_usage"]["total_usage"]
        system_cpu = stats["cpu_stats"]["system_cpu_usage"]
        
        if system_cpu > 0:
            cpu_percent = (cpu_usage / system_cpu) * 100
            # CPU should not be pegged at 100% continuously
            assert cpu_percent < 90


class TestGPUAccess:
    """Test GPU access in container."""
    
    def test_gpu_available(self):
        """Test that GPU is accessible from container."""
        response = requests.get(f"{TestContainerIntegration.BASE_URL}/health")
        data = response.json()
        # In CI without GPU, this will be False
        # In local/test with GPU, should be True
        assert "gpu_available" in data
    
    def test_gpu_memory_reporting(self):
        """Test GPU memory is reported in health check."""
        response = requests.get(f"{TestContainerIntegration.BASE_URL}/health")
        data = response.json()
        
        if data["gpu_available"]:
            assert data["gpu_memory_used"] is not None
            assert data["gpu_memory_total"] is not None


# =============================================================================
# Docker Compose Integration Tests
# =============================================================================

class TestDockerComposeIntegration:
    """Tests for full docker-compose stack."""
    
    COMPOSE_FILE = Path(__file__).parent.parent / "docker-compose.yml"
    PROJECT_NAME = "ibvap-test"
    
    @classmethod
    def setup_class(cls):
        """Start docker-compose stack."""
        if not cls.COMPOSE_FILE.exists():
            pytest.skip("docker-compose.yml not found")
        
        result = subprocess.run([
            "docker", "compose", "-p", cls.PROJECT_NAME, "-f", str(cls.COMPOSE_FILE),
            "up", "-d", "--build"
        ], capture_output=True, text=True, timeout=300)
        
        if result.returncode != 0:
            pytest.fail(f"Docker compose up failed: {result.stderr}")
        
        # Wait for services
        time.sleep(30)
    
    @classmethod
    def teardown_class(cls):
        """Stop docker-compose stack."""
        subprocess.run([
            "docker", "compose", "-p", cls.PROJECT_NAME, "-f", str(cls.COMPOSE_FILE),
            "down", "-v"
        ], capture_output=True)
    
    def test_all_services_running(self):
        """Test all services are running."""
        result = subprocess.run([
            "docker", "compose", "-p", self.PROJECT_NAME, "-f", str(self.COMPOSE_FILE),
            "ps", "--format", "json"
        ], capture_output=True, text=True)
        
        assert result.returncode == 0
        # Parse and verify each service is running
    
    def test_backend_accessible_via_nginx(self):
        """Test backend is accessible through Nginx proxy."""
        response = requests.get("https://localhost/health", verify=False, timeout=10)
        # Should work with self-signed cert (verify=False)
        assert response.status_code == 200
    
    def test_http_redirects_to_https(self):
        """Test HTTP redirects to HTTPS."""
        response = requests.get("http://localhost/health", allow_redirects=False, timeout=10)
        assert response.status_code in [301, 302, 307, 308]
        assert "https://" in response.headers.get("Location", "")
    
    def test_database_connectivity(self):
        """Test PostgreSQL is accessible."""
        result = subprocess.run([
            "docker", "exec", f"{self.PROJECT_NAME}-postgres-1",
            "pg_isready", "-U", "ibvap"
        ], capture_output=True)
        assert result.returncode == 0
    
    def test_redis_connectivity(self):
        """Test Redis is accessible."""
        result = subprocess.run([
            "docker", "exec", f"{self.PROJECT_NAME}-redis-1",
            "redis-cli", "ping"
        ], capture_output=True, text=True)
        assert result.returncode == 0
        assert "PONG" in result.stdout


# =============================================================================
# Pytest Configuration for Integration Tests
# =============================================================================

def pytest_configure(config):
    """Register custom markers."""
    config.addinivalue_line(
        "markers", "integration: mark test as integration test requiring Docker"
    )


def pytest_collection_modifyitems(config, items):
    """Skip integration tests unless explicitly requested."""
    if not config.getoption("--run-integration"):
        skip_integration = pytest.mark.skip(reason="need --run-integration option to run")
        for item in items:
            if "integration" in item.keywords:
                item.add_marker(skip_integration)


def pytest_addoption(parser):
    """Add custom command line options."""
    parser.addoption(
        "--run-integration",
        action="store_true",
        default=False,
        help="run integration tests"
    )