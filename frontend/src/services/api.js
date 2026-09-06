/**
 * Optic Shield — Frontend API Service
 * 
 * Axios-free fetch wrapper with automated dual-endpoint failover.
 * Primary: Modal Cloud GPU | Backup: Hugging Face Spaces
 * Timeout: 8,000 ms per rules.md
 */

// Theme colors for reference (not used directly in API)
// Dark Slate: #090D16
// Tactical Blue: #3B82F6
// Critical Red: #EF4444

const API_CONFIG = {
  // Primary endpoint (ngrok Colab GPU backend)
  primary: {
    baseURL: import.meta.env.VITE_API_PRIMARY_URL || 'https://trailing-matriarch-marshland.ngrok-free.dev',
    name: 'Colab GPU',
  },
  // Backup endpoint (Modal Serverless GPU)
  backup: {
    baseURL: import.meta.env.VITE_API_BACKUP_URL || 'https://mgtd2104--optic-shield-backend-health.modal.run',
    name: 'Modal Serverless',
  },
  // Request timeout in milliseconds
  timeout: 8000,
  // Retry configuration
  maxRetries: 1,
  retryDelay: 500,
};

// Connection status tracking for UI
let connectionStatus = 'offline'; // 'online-colab' | 'online-modal' | 'offline'
const connectionStatusListeners = new Set();

/**
 * Get current connection status
 */
export function getConnectionStatus() {
  return connectionStatus;
}

/**
 * Subscribe to connection status changes
 */
export function onConnectionStatusChange(callback) {
  connectionStatusListeners.add(callback);
  return () => connectionStatusListeners.delete(callback);
}

/**
 * Notify listeners of connection status change
 */
function notifyConnectionStatusChange(newStatus) {
  connectionStatus = newStatus;
  connectionStatusListeners.forEach(cb => cb(newStatus));
}

// Token storage key
const AUTH_TOKEN_KEY = 'optic_shield_auth_token';
const REFRESH_TOKEN_KEY = 'optic_shield_refresh_token';

/**
 * Custom error class for API errors
 */
export class APIError extends Error {
  constructor(message, code, status, details = null) {
    super(message);
    this.name = 'APIError';
    this.code = code;
    this.status = status;
    this.details = details;
    this.timestamp = new Date().toISOString();
  }
}

/**
 * Get stored auth token
 */
export function getAuthToken() {
  return localStorage.getItem(AUTH_TOKEN_KEY);
}

/**
 * Get stored refresh token
 */
function getRefreshToken() {
  return localStorage.getItem(REFRESH_TOKEN_KEY);
}

/**
 * Set auth tokens
 */
export function setAuthTokens(accessToken, refreshToken) {
  if (accessToken) localStorage.setItem(AUTH_TOKEN_KEY, accessToken);
  if (refreshToken) localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
}

/**
 * Clear auth tokens
 */
export function clearAuthTokens() {
  localStorage.removeItem(AUTH_TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
}

/**
 * Check if user is authenticated
 */
export function isAuthenticated() {
  return !!getAuthToken();
}

/**
 * Build request headers with conditional ngrok header
 * @param {Object} customHeaders - Additional headers
 * @param {boolean} isPrimary - Whether request is for primary endpoint
 * @param {boolean} isFormData - Whether request body is FormData (skip Content-Type)
 */
function buildHeaders(customHeaders = {}, isPrimary = false, isFormData = false) {
  const headers = {
    ...customHeaders,
  };

  // Only add default Content-Type for non-FormData requests
  // For FormData, browser automatically sets Content-Type with boundary
  if (!isFormData) {
    headers['Content-Type'] = 'application/json';
  }

  // Only add ngrok-skip-browser-warning for primary (ngrok) endpoint
  if (isPrimary) {
    headers['ngrok-skip-browser-warning'] = 'true';
  }

  const token = getAuthToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  return headers;
}

/**
 * Parse response with standard schema validation
 */
async function parseResponse(response) {
  const contentType = response.headers.get('content-type');
  const isJSON = contentType && contentType.includes('application/json');

  let data;
  let rawText = '';
  try {
    if (isJSON) {
      data = await response.json();
    } else {
      rawText = await response.text();
      data = rawText;
    }
  } catch (parseErr) {
    // If JSON parsing fails, store raw text
    rawText = await response.text().catch(() => '');
    data = rawText;
  }

  // Debug logging
  console.log('[API] parseResponse:', {
    status: response.status,
    statusText: response.statusText,
    ok: response.ok,
    contentType,
    isJSON,
    dataType: typeof data,
    dataKeys: data && typeof data === 'object' ? Object.keys(data) : 'N/A',
    rawTextPreview: rawText?.substring(0, 200),
  });

  // Standard success response schema
  if (response.ok) {
    if (data && typeof data === 'object' && 'success' in data) {
      if (data.success === true) {
        return data.data;
      } else {
        throw new APIError(
          data.error?.message || 'API request failed',
          data.error?.code || 'API_ERROR',
          response.status,
          data.error?.details || null
        );
      }
    }
    return data;
  }

  // Standard error response schema
  let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
  let errorCode = 'HTTP_ERROR';
  let errorDetails = null;

  if (isJSON && data && typeof data === 'object') {
    if (data.success === false && data.error) {
      errorMessage = data.error.message || errorMessage;
      errorCode = data.error.code || errorCode;
      errorDetails = data.error.details || null;
    } else if (data.message) {
      errorMessage = data.message;
    } else if (data.detail) {
      // FastAPI/Pydantic validation errors often use 'detail'
      errorMessage = Array.isArray(data.detail) 
        ? data.detail.map(d => d.msg || JSON.stringify(d)).join(', ')
        : JSON.stringify(data.detail);
      errorCode = 'VALIDATION_ERROR';
      errorDetails = data.detail;
    } else if (data.errors) {
      // Some APIs use 'errors' array
      errorMessage = JSON.stringify(data.errors);
      errorCode = 'VALIDATION_ERROR';
      errorDetails = data.errors;
    } else {
      // For 422 with unexpected JSON structure, include the whole response
      errorDetails = data;
      errorMessage = JSON.stringify(data);
    }
  } else if (rawText) {
    // Non-JSON response (HTML error page, plain text, etc.)
    errorDetails = rawText;
    errorMessage = rawText.substring(0, 500);
  } else {
    // Fallback - no data at all
    errorDetails = { status: response.status, statusText: response.statusText };
    errorMessage = `HTTP ${response.status}: ${response.statusText} (no response body)`;
  }

  throw new APIError(errorMessage, errorCode, response.status, errorDetails);
}

/**
 * Execute fetch with timeout
 */
function fetchWithTimeout(url, options, timeout = API_CONFIG.timeout) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);

  return fetch(url, {
    ...options,
    signal: controller.signal,
  }).finally(() => clearTimeout(id));
}

/**
 * Execute request with failover logic
 * Tries primary endpoint first, falls back to backup on timeout or 5xx errors
 */
async function fetchWithFailover(endpoint, options = {}, timeout = API_CONFIG.timeout) {
  const endpoints = [API_CONFIG.primary, API_CONFIG.backup];
  let lastError = null;

  for (let i = 0; i < endpoints.length; i++) {
    const ep = endpoints[i];
    const isPrimary = i === 0;
    const url = `${ep.baseURL}${endpoint}`;

    // Build headers with conditional ngrok header for primary, merging with custom headers
    // IMPORTANT: Don't add default Content-Type for FormData (browser sets it with boundary)
    const isFormData = options.body instanceof FormData;
    const baseHeaders = buildHeaders(options.headers, isPrimary, isFormData);
    const requestOptions = {
      ...options,
      headers: {
        ...baseHeaders,
        ...options.headers, // Allow custom headers to override
      },
    };

    try {
      const response = await fetchWithTimeout(url, requestOptions, timeout);
      const data = await parseResponse(response);
      
      // Update connection status on success
      if (isPrimary) {
        notifyConnectionStatusChange('online-colab');
      } else {
        notifyConnectionStatusChange('online-modal');
      }
      
      return data;
    } catch (error) {
      lastError = error;

      // Don't retry on client errors (4xx) except 401 which might be token expiry
      if (error instanceof APIError && error.status >= 400 && error.status < 500 && error.status !== 401) {
        throw error;
      }

      // Don't retry on the last endpoint
      if (i === endpoints.length - 1) {
        notifyConnectionStatusChange('offline');
        throw error;
      }

      // Log failover with required message
      // console.warn('Primary Colab backend offline. Re-routing to Modal Serverless GPU.');

      // Small delay before retry
      await new Promise(resolve => setTimeout(resolve, API_CONFIG.retryDelay));
    }
  }

  throw lastError;
}

/**
 * Public API methods
 */

// Authentication
export async function login(username, password) {
  const data = await fetchWithFailover('/api/v1/auth/login', {
    method: 'POST',
    headers: buildHeaders(),
    body: JSON.stringify({ username, password }),
  }, 15000); // 15s timeout for login to allow Ngrok tunnels to settle

  if (data.access_token) {
    setAuthTokens(data.access_token, data.refresh_token);
  }

  return data;
}

export async function refreshAccessToken() {
  const refreshToken = getRefreshToken();
  if (!refreshToken) throw new APIError('No refresh token available', 'NO_REFRESH_TOKEN', 401);

  const data = await fetchWithFailover('/api/v1/auth/refresh', {
    method: 'POST',
    headers: buildHeaders(),
    body: JSON.stringify({ refresh_token: refreshToken }),
  });

  if (data.access_token) {
    setAuthTokens(data.access_token, data.refresh_token);
  }

  return data;
}

export async function logout() {
  try {
    await fetchWithFailover('/api/v1/auth/logout', {
      method: 'POST',
      headers: buildHeaders(),
    });
  } finally {
    clearAuthTokens();
  }
}

export async function getCurrentUser() {
  return fetchWithFailover('/api/v1/auth/me', {
    method: 'GET',
    headers: buildHeaders(),
  });
}

// Cameras
export async function getCameras(params = {}) {
  const queryString = new URLSearchParams(params).toString();
  const endpoint = `/api/v1/cameras${queryString ? `?${queryString}` : ''}`;
  try {
    const data = await fetchWithFailover(endpoint, {
      method: 'GET',
      headers: buildHeaders(),
    });
    // Normalize response to always return array
    if (Array.isArray(data)) return data;
    if (data && Array.isArray(data.cameras)) return data.cameras;
    if (data && Array.isArray(data.data)) return data.data;
    return [];
  } catch (error) {
    if (error instanceof APIError && error.status === 404) {
     // console.warn('[API] /api/v1/cameras not found (404), returning empty');
      return [];
    }
    throw error;
  }
}

export async function getCamera(cameraId) {
  return fetchWithFailover(`/api/v1/cameras/${cameraId}`, {
    method: 'GET',
    headers: buildHeaders(),
  });
}

export async function createCamera(cameraData) {
  return fetchWithFailover('/api/v1/cameras', {
    method: 'POST',
    headers: buildHeaders(),
    body: JSON.stringify(cameraData),
  });
}

export async function updateCamera(cameraId, cameraData) {
  return fetchWithFailover(`/api/v1/cameras/${cameraId}`, {
    method: 'PATCH',
    headers: buildHeaders(),
    body: JSON.stringify(cameraData),
  });
}

export async function deleteCamera(cameraId) {
  return fetchWithFailover(`/api/v1/cameras/${cameraId}`, {
    method: 'DELETE',
    headers: buildHeaders(),
  });
}

export async function getCameraHealth(cameraId) {
  return fetchWithFailover(`/api/v1/cameras/${cameraId}/health`, {
    method: 'GET',
    headers: buildHeaders(),
  });
}

// Alerts
export async function getAlerts(params = {}) {
  const queryString = new URLSearchParams(params).toString();
  const endpoint = `/api/v1/alerts${queryString ? `?${queryString}` : ''}`;
  try {
    const data = await fetchWithFailover(endpoint, {
      method: 'GET',
      headers: buildHeaders(),
    });
    // Normalize response to always return array
    if (Array.isArray(data)) return data;
    if (data && Array.isArray(data.alerts)) return data.alerts;
    if (data && Array.isArray(data.data)) return data.data;
    return [];
  } catch (error) {
    if (error instanceof APIError && error.status === 404) {
      console.warn('[API] /api/v1/alerts not found (404), returning empty');
      return [];
    }
    throw error;
  }
}

export async function getAlert(alertId) {
  return fetchWithFailover(`/api/v1/alerts/${alertId}`, {
    method: 'GET',
    headers: buildHeaders(),
  });
}

export async function updateAlert(alertId, updates) {
  return fetchWithFailover(`/api/v1/alerts/${alertId}`, {
    method: 'PATCH',
    headers: buildHeaders(),
    body: JSON.stringify(updates),
  });
}

export async function getAlertStats(params = {}) {
  const queryString = new URLSearchParams(params).toString();
  const endpoint = `/api/v1/alerts/stats${queryString ? `?${queryString}` : ''}`;
  return fetchWithFailover(endpoint, {
    method: 'GET',
    headers: buildHeaders(),
  });
}

export async function acknowledgeAlert(alertId, userId) {
  return fetchWithFailover(`/api/v1/alerts/${alertId}`, {
    method: 'PATCH',
    headers: buildHeaders(),
    body: JSON.stringify({
      status: 'ACKNOWLEDGED',
      acknowledged_by: userId,
    }),
  });
}

export async function resolveAlert(alertId, userId) {
  return fetchWithFailover(`/api/v1/alerts/${alertId}`, {
    method: 'PATCH',
    headers: buildHeaders(),
    body: JSON.stringify({
      status: 'RESOLVED',
      resolved_by: userId,
    }),
  });
}

export async function escalateAlert(alertId, userId) {
  return fetchWithFailover(`/api/v1/alerts/${alertId}`, {
    method: 'PATCH',
    headers: buildHeaders(),
    body: JSON.stringify({
      status: 'ESCALATED',
      acknowledged_by: userId,
    }),
  });
}

// Audit Ledger
export async function getAuditChain(params = {}) {
  const queryString = new URLSearchParams(params).toString();
  const endpoint = `/api/v1/audit/chain${queryString ? `?${queryString}` : ''}`;
  try {
    return await fetchWithFailover(endpoint, {
      method: 'GET',
      headers: buildHeaders(),
    });
  } catch (error) {
    // Gracefully handle 404 - endpoint may not exist on fallback backend
    if (error instanceof APIError && error.status === 404) {
      console.warn('[API] /api/v1/audit/chain not found (404), returning empty');
      return { data: [], total_blocks: 0 };
    }
    throw error;
  }
}

export async function verifyAuditChain(params = {}) {
  const queryString = new URLSearchParams(params).toString();
  const endpoint = `/api/v1/audit/verify${queryString ? `?${queryString}` : ''}`;
  return fetchWithFailover(endpoint, {
    method: 'GET',
    headers: buildHeaders(),
  });
}

export async function getAuditBlock(blockIndex) {
  return fetchWithFailover(`/api/v1/audit/block/${blockIndex}`, {
    method: 'GET',
    headers: buildHeaders(),
  });
}

export async function exportAuditLedger(exportParams) {
  return fetchWithFailover('/api/v1/audit/export', {
    method: 'POST',
    headers: buildHeaders(),
    body: JSON.stringify(exportParams),
  });
}

export async function getAuditStats() {
  try {
    return await fetchWithFailover('/api/v1/audit/stats', {
      method: 'GET',
      headers: buildHeaders(),
    });
  } catch (error) {
    if (error instanceof APIError && error.status === 404) {
      console.warn('[API] /api/v1/audit/stats not found (404), returning empty');
      return { total_blocks: 0, total_alerts: 0, verified_count: 0 };
    }
    throw error;
  }
}

export async function getMerkleRoot(params = {}) {
  const queryString = new URLSearchParams(params).toString();
  const endpoint = `/api/v1/audit/merkle-root${queryString ? `?${queryString}` : ''}`;
  try {
    return await fetchWithFailover(endpoint, {
      method: 'GET',
      headers: buildHeaders(),
    });
  } catch (error) {
    if (error instanceof APIError && error.status === 404) {
      console.warn('[API] /api/v1/audit/merkle-root not found (404), returning empty');
      return { merkle_root: null };
    }
    throw error;
  }
}

// Geofences
export async function getGeofences(params = {}) {
  const queryString = new URLSearchParams(params).toString();
  const endpoint = `/api/v1/geofences${queryString ? `?${queryString}` : ''}`;
  try {
    const data = await fetchWithFailover(endpoint, {
      method: 'GET',
      headers: buildHeaders(),
    });
    // Normalize response to always return array
    if (Array.isArray(data)) return data;
    if (data && Array.isArray(data.geofences)) return data.geofences;
    if (data && Array.isArray(data.data)) return data.data;
    return [];
  } catch (error) {
    if (error instanceof APIError && error.status === 404) {
      console.warn('[API] /api/v1/geofences not found (404), returning empty');
      return [];
    }
    throw error;
  }
}

export async function getGeofence(geofenceId) {
  return fetchWithFailover(`/api/v1/geofences/${geofenceId}`, {
    method: 'GET',
    headers: buildHeaders(),
  });
}

export async function createGeofence(geofenceData) {
  return fetchWithFailover('/api/v1/geofences', {
    method: 'POST',
    headers: buildHeaders(),
    body: JSON.stringify(geofenceData),
  });
}

export async function updateGeofence(geofenceId, geofenceData) {
  return fetchWithFailover(`/api/v1/geofences/${geofenceId}`, {
    method: 'PATCH',
    headers: buildHeaders(),
    body: JSON.stringify(geofenceData),
  });
}

export async function deleteGeofence(geofenceId) {
  return fetchWithFailover(`/api/v1/geofences/${geofenceId}`, {
    method: 'DELETE',
    headers: buildHeaders(),
  });
}

// Watchlist
export async function getWatchlist(params = {}) {
  const queryString = new URLSearchParams(params).toString();
  const endpoint = `/api/v1/watchlist${queryString ? `?${queryString}` : ''}`;
  return fetchWithFailover(endpoint, {
    method: 'GET',
    headers: buildHeaders(),
  });
}

export async function addToWatchlist(watchlistData) {
  return fetchWithFailover('/api/v1/watchlist', {
    method: 'POST',
    headers: buildHeaders(),
    body: JSON.stringify(watchlistData),
  });
}

export async function removeFromWatchlist(watchlistId) {
  return fetchWithFailover(`/api/v1/watchlist/${watchlistId}`, {
    method: 'DELETE',
    headers: buildHeaders(),
  });
}

// Health Dashboard
export async function getHealthDashboard(params = {}) {
  const queryString = new URLSearchParams(params).toString();
  const endpoint = `/api/v1/health${queryString ? `?${queryString}` : ''}`;
  try {
    return await fetchWithFailover(endpoint, {
      method: 'GET',
      headers: buildHeaders(),
    });
  } catch (error) {
    if (error instanceof APIError && error.status === 404) {
      console.warn('[API] /api/v1/health not found (404), returning empty');
      return { cameras: [], geofences: [], alerts: [], system: {} };
    }
    throw error;
  }
}

// Frame Analysis - Real-time frame analysis (multipart/form-data)
export async function analyzeFrame(imageFile, options = {}) {
  const formData = new FormData();
  formData.append('file', imageFile);
  
  if (options.camera_id) formData.append('camera_id', options.camera_id);
  if (options.geofence_id) formData.append('geofence_id', options.geofence_id);
  if (options.track_id) formData.append('track_id', options.track_id);
  if (options.return_annotated) formData.append('return_annotated', 'true');
  
  // For FormData, we MUST NOT set Content-Type header - browser sets it with boundary
  // We only add Authorization header
  const headers = {};
  
  const token = getAuthToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  // Debug: log what we're sending
  console.log('[API] analyzeFrame request:', {
    fileName: imageFile.name,
    fileSize: imageFile.size,
    fileType: imageFile.type,
    camera_id: options.camera_id,
    return_annotated: options.return_annotated,
  });

  try {
    const result = await fetchWithFailover('/api/v1/analyze-frame', {
      method: 'POST',
      headers,
      body: formData,
    }, 30000); // 30s timeout for frame analysis
    console.log('[API] analyzeFrame success:', result);
    return result;
  } catch (err) {
    console.error('[API] analyzeFrame failed:', {
      message: err.message,
      code: err.code,
      status: err.status,
      details: err.details,
    });
    throw err;
  }
}
// Health Check - verifies backend connectivity
export async function checkBackendHealth() {
  try {
    const data = await fetchWithFailover('/api/v1/health', {
      method: 'GET',
      headers: buildHeaders(),
    });
    console.log('[API] Backend health check:', data);
    return { 
      healthy: true, 
      data,
      connectionStatus: getConnectionStatus()
    };
  } catch (error) {
    console.error('[API] Backend health check failed:', error);
    return { 
      healthy: false, 
      error: error.message,
      connectionStatus: getConnectionStatus()
    };
  }
}

// Audit Blocks - Lightweight block fetching with 404 fallback
export async function getAuditBlocks() {
  try {
    const data = await fetchWithFailover('/api/v1/audit/blocks', {
      method: 'GET',
      headers: buildHeaders(),
    });
    return data?.blocks || data || [];
  } catch (error) {
    // Gracefully handle 404 - return empty array instead of throwing
    if (error instanceof APIError && error.status === 404) {
      console.warn('[API] /api/v1/audit/blocks not found (404), returning empty array');
      return [];
    }
    // For other errors, log but return empty array to prevent UI crashes
    console.error('[API] Failed to fetch audit blocks:', error);
    return [];
  }
}

// WebSocket connection helper - DISABLED: Using REST polling instead
// export function createWebSocketConnection(onMessage, onError, onClose, onOpen) {
//   ...
// }

// Utility: Format timestamp for display
export function formatTimestamp(timestamp) {
  const date = new Date(timestamp);
  return date.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

// Utility: Format relative time
export function formatRelativeTime(timestamp) {
  const now = new Date();
  const date = new Date(timestamp);
  const diffMs = now - date;
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSecs < 60) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return formatTimestamp(timestamp);
}

// Utility: Get severity color
export function getSeverityColor(severity) {
  const colors = {
    1: '#3B82F6', // INFO - Tactical Blue
    2: '#F59E0B', // WARNING - Amber
    3: '#EF4444', // CRITICAL - Critical Red
  };
  return colors[severity] || '#6B7280';
}

// Utility: Get severity label
export function getSeverityLabel(severity) {
  const labels = {
    1: 'INFO',
    2: 'WARNING',
    3: 'CRITICAL',
  };
  return labels[severity] || 'UNKNOWN';
}

// Utility: Get camera status color
export function getCameraStatusColor(status) {
  const colors = {
    'online': '#10B981',      // Green
    'offline': '#6B7280',     // Gray
    'degraded': '#F59E0B',    // Amber
    'maintenance': '#3B82F6', // Blue
    'tampered': '#EF4444',    // Critical Red
  };
  return colors[status] || '#6B7280';
}

// Export all as default object for convenience
const api = {
  // Auth
  login,
  refreshAccessToken,
  logout,
  getCurrentUser,
  isAuthenticated,
  setAuthTokens,
  clearAuthTokens,
  getAuthToken,
  getRefreshToken,

  // Cameras
  getCameras,
  getCamera,
  createCamera,
  updateCamera,
  deleteCamera,
  getCameraHealth,

  // Alerts
  getAlerts,
  getAlert,
  updateAlert,
  getAlertStats,
  acknowledgeAlert,
  resolveAlert,
  escalateAlert,

  // Audit
  getAuditChain,
  verifyAuditChain,
  getAuditBlock,
  exportAuditLedger,
  getAuditStats,
  getMerkleRoot,

  // Geofences
  getGeofences,
  getGeofence,
  createGeofence,
  updateGeofence,
  deleteGeofence,

  // Watchlist
  getWatchlist,
  addToWatchlist,
  removeFromWatchlist,

  // Health
  getHealthDashboard,
  analyzeFrame,
  checkBackendHealth,

  

  // Utilities
  formatTimestamp,
  formatRelativeTime,
  getSeverityColor,
  getSeverityLabel,
  getCameraStatusColor,
  getAuditBlocks,

  // Error class
  APIError,
};

export default api;