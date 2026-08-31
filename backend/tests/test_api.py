# =============================================================================
# IBVAP Backend - Unit Tests for API Routes
# =============================================================================

import pytest
from fastapi.testclient import TestClient


class TestHealthEndpoints:
    """Tests for health check and system endpoints."""
    
    def test_root_endpoint(self, test_client: TestClient):
        """Test root endpoint returns API info."""
        response = test_client.get("/")
        assert response.status_code == 200
        data = response.json()
        assert data["name"] == "IBVAP Backend"
        assert "version" in data
        assert "endpoints" in data
    
    def test_health_check(self, test_client: TestClient):
        """Test health check endpoint."""
        response = test_client.get("/health")
        assert response.status_code == 200
        data = response.json()
        assert "status" in data
        assert "version" in data
        assert "device" in data
        assert "models_loaded" in data
        assert "uptime_seconds" in data
        assert "gpu_available" in data
    
    def test_metrics_endpoint(self, test_client: TestClient):
        """Test Prometheus metrics endpoint."""
        response = test_client.get("/metrics")
        assert response.status_code == 200
        assert "text/plain" in response.headers["content-type"]
        # Check for expected metrics
        content = response.text
        assert "ibvap_requests_total" in content
        assert "ibvap_request_duration_seconds" in content


class TestAuthentication:
    """Tests for authentication endpoints."""
    
    def test_create_token(self, test_client: TestClient):
        """Test JWT token creation."""
        response = test_client.post(
            "/auth/token",
            json={"username": "testuser", "password": "testpass"}
        )
        assert response.status_code == 200
        data = response.json()
        assert "access_token" in data
        assert data["token_type"] == "bearer"
        assert "expires_in" in data
    
    def test_verify_token_with_valid_jwt(self, test_client: TestClient):
        """Test token verification with valid JWT."""
        from tests.conftest import create_jwt_token
        token = create_jwt_token("testuser")
        
        response = test_client.post(
            "/auth/verify",
            headers={"Authorization": f"Bearer {token}"}
        )
        assert response.status_code == 200
        data = response.json()
        assert data["valid"] is True
        assert data["user"]["auth_type"] == "jwt"
    
    def test_verify_token_with_valid_api_key(self, test_client: TestClient, valid_api_key: str):
        """Test token verification with valid API key."""
        response = test_client.post(
            "/auth/verify",
            headers={"X-API-Key": valid_api_key}
        )
        assert response.status_code == 200
        data = response.json()
        assert data["valid"] is True
        assert data["user"]["auth_type"] == "api_key"
    
    def test_verify_token_invalid_jwt(self, test_client: TestClient):
        """Test token verification with invalid JWT."""
        response = test_client.post(
            "/auth/verify",
            headers={"Authorization": "Bearer invalid-token"}
        )
        assert response.status_code == 401
    
    def test_verify_token_invalid_api_key(self, test_client: TestClient, invalid_api_key: str):
        """Test token verification with invalid API key."""
        response = test_client.post(
            "/auth/verify",
            headers={"X-API-Key": invalid_api_key}
        )
        assert response.status_code == 401
    
    def test_verify_token_no_auth(self, test_client: TestClient):
        """Test token verification without authentication."""
        response = test_client.post("/auth/verify")
        assert response.status_code == 401


class TestAnalysisEndpoints:
    """Tests for frame analysis endpoints."""
    
    def test_analyze_frame_with_api_key(
        self, 
        test_client: TestClient, 
        valid_api_key: str,
        sample_image_base64: str
    ):
        """Test frame analysis with valid API key."""
        response = test_client.post(
            "/analyze",
            json={"frame_base64": sample_image_base64},
            headers={"X-API-Key": valid_api_key}
        )
        assert response.status_code == 200
        data = response.json()
        assert "request_id" in data
        assert "timestamp" in data
        assert "processing_time_ms" in data
        assert "detections" in data
        assert "alerts" in data
        assert "annotated_frame_base64" in data
    
    def test_analyze_frame_with_jwt(
        self, 
        test_client: TestClient,
        sample_image_base64: str
    ):
        """Test frame analysis with valid JWT."""
        from tests.conftest import create_jwt_token
        token = create_jwt_token("testuser")
        
        response = test_client.post(
            "/analyze",
            json={"frame_base64": sample_image_base64},
            headers={"Authorization": f"Bearer {token}"}
        )
        assert response.status_code == 200
    
    def test_analyze_frame_no_auth(
        self, 
        test_client: TestClient,
        sample_image_base64: str
    ):
        """Test frame analysis without authentication."""
        response = test_client.post(
            "/analyze",
            json={"frame_base64": sample_image_base64}
        )
        assert response.status_code == 401
    
    def test_analyze_frame_invalid_api_key(
        self, 
        test_client: TestClient,
        invalid_api_key: str,
        sample_image_base64: str
    ):
        """Test frame analysis with invalid API key."""
        response = test_client.post(
            "/analyze",
            json={"frame_base64": sample_image_base64},
            headers={"X-API-Key": invalid_api_key}
        )
        assert response.status_code == 401
    
    def test_analyze_frame_invalid_base64(
        self, 
        test_client: TestClient,
        valid_api_key: str
    ):
        """Test frame analysis with invalid base64 data."""
        response = test_client.post(
            "/analyze",
            json={"frame_base64": "invalid-base64-data"},
            headers={"X-API-Key": valid_api_key}
        )
        assert response.status_code == 400
    
    def test_analyze_upload_with_api_key(
        self, 
        test_client: TestClient,
        valid_api_key: str,
        sample_image_bytes: bytes
    ):
        """Test image upload analysis with valid API key."""
        response = test_client.post(
            "/analyze/upload",
            files={"file": ("test.jpg", sample_image_bytes, "image/jpeg")},
            headers={"X-API-Key": valid_api_key}
        )
        assert response.status_code == 200
        data = response.json()
        assert "request_id" in data
        assert "detections" in data
        assert "alerts" in data
    
    def test_analyze_upload_invalid_file_type(
        self, 
        test_client: TestClient,
        valid_api_key: str
    ):
        """Test upload with invalid file type."""
        response = test_client.post(
            "/analyze/upload",
            files={"file": ("test.txt", b"not an image", "text/plain")},
            headers={"X-API-Key": valid_api_key}
        )
        assert response.status_code == 400


class TestWebSocketEndpoint:
    """Tests for WebSocket endpoint."""
    
    def test_websocket_connection_with_valid_key(self, test_client: TestClient, valid_api_key: str):
        """Test WebSocket connection with valid API key."""
        with test_client.websocket_connect(f"/ws/stream?api_key={valid_api_key}") as ws:
            # Should receive at least one frame
            data = ws.receive_json()
            assert "frame_id" in data
            assert "timestamp" in data
            assert "frame" in data
            assert "detections" in data
            assert "alerts" in data
            assert "processing_time_ms" in data
    
    def test_websocket_connection_invalid_key(self, test_client: TestClient, invalid_api_key: str):
        """Test WebSocket connection with invalid API key."""
        with pytest.raises(Exception):
            with test_client.websocket_connect(f"/ws/stream?api_key={invalid_api_key}") as ws:
                pass
    
    def test_websocket_connection_no_key(self, test_client: TestClient):
        """Test WebSocket connection without API key."""
        with pytest.raises(Exception):
            with test_client.websocket_connect("/ws/stream") as ws:
                pass


class TestRateLimiting:
    """Tests for rate limiting (if implemented)."""
    
    def test_multiple_requests_succeed(self, test_client: TestClient, valid_api_key: str, sample_image_base64: str):
        """Test multiple sequential requests succeed."""
        for _ in range(5):
            response = test_client.post(
                "/analyze",
                json={"frame_base64": sample_image_base64},
                headers={"X-API-Key": valid_api_key}
            )
            assert response.status_code == 200


class TestCORS:
    """Tests for CORS configuration."""
    
    def test_cors_headers_development(self, test_client: TestClient):
        """Test CORS headers in development mode."""
        response = test_client.options(
            "/analyze",
            headers={
                "Origin": "http://localhost:3000",
                "Access-Control-Request-Method": "POST"
            }
        )
        # In development, CORS should be permissive
        assert response.status_code in [200, 204]


class TestErrorHandling:
    """Tests for error handling."""
    
    def test_404_endpoint(self, test_client: TestClient):
        """Test 404 for non-existent endpoint."""
        response = test_client.get("/nonexistent")
        assert response.status_code == 404
    
    def test_method_not_allowed(self, test_client: TestClient):
        """Test 405 for unsupported method."""
        response = test_client.put("/health")
        assert response.status_code == 405


# =============================================================================
# Performance Tests (Optional)
# =============================================================================

class TestPerformance:
    """Basic performance tests."""
    
    def test_health_check_response_time(self, test_client: TestClient):
        """Test health check responds quickly."""
        import time
        start = time.time()
        response = test_client.get("/health")
        elapsed = time.time() - start
        assert response.status_code == 200
        assert elapsed < 1.0  # Should respond in under 1 second
    
    def test_analyze_frame_response_time(self, test_client: TestClient, valid_api_key: str, sample_image_base64: str):
        """Test frame analysis response time."""
        import time
        start = time.time()
        response = test_client.post(
            "/analyze",
            json={"frame_base64": sample_image_base64},
            headers={"X-API-Key": valid_api_key}
        )
        elapsed = time.time() - start
        assert response.status_code == 200
        assert elapsed < 5.0  # Should process in under 5 seconds