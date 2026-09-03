export const API_BASE = import.meta.env.VITE_API_BASE || '';

// Default timeout for fetch requests (30 seconds)
const DEFAULT_TIMEOUT = 30000;

type ApiErrorBody = {
  detail?: unknown;
  error?: unknown;
};

function formatApiError(body: ApiErrorBody, fallback: string): string {
  const value = body.detail ?? body.error;
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    const messages = value.map((item) => {
      if (typeof item === 'string') return item;
      if (item && typeof item === 'object') {
        const issue = item as { loc?: unknown[]; msg?: unknown };
        const location = issue.loc?.filter(Boolean).join('.') || 'request';
        return `${location}: ${String(issue.msg || 'Invalid value')}`;
      }
      return String(item);
    });
    return messages.join('; ');
  }
  if (value && typeof value === 'object') return JSON.stringify(value);
  return fallback;
}

function getAuthHeaders(): HeadersInit {
  const token = localStorage.getItem('ibvap_token');
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function fetchWithTimeout<T>(url: string, options: RequestInit, timeout = DEFAULT_TIMEOUT): Promise<T> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  
  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    
    if (!res.ok) {
      let detail = res.statusText;
      try {
        const body = await res.json() as ApiErrorBody;
        detail = formatApiError(body, detail);
      } catch {
        // Keep the HTTP status when the server did not return JSON.
      }
      throw new Error(`API error ${res.status}: ${detail}`);
    }
    return res.json() as Promise<T>;
  } catch (err) {
    clearTimeout(timeoutId);
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('Request timeout');
    }
    throw err;
  }
}

export async function apiGet<T>(path: string): Promise<T> {
  return fetchWithTimeout(`${API_BASE}${path}`, {
    headers: getAuthHeaders(),
  });
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  return fetchWithTimeout(`${API_BASE}${path}`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(body),
  });
}

export async function apiUpload<T>(
  path: string,
  file: File,
  onProgress?: (progress: number) => void,
  metadata?: Record<string, string>,
  onXhrCreated?: (xhr: XMLHttpRequest) => void
): Promise<T> {
  const token = localStorage.getItem('ibvap_token');
  const formData = new FormData();
  formData.append('file', file);
  if (metadata) {
    Object.entries(metadata).forEach(([key, value]) => {
      formData.append(key, value);
    });
  }

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_BASE}${path}`);
    
    if (token) {
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    }

    // Allow caller to capture XHR for cancellation
    if (onXhrCreated) {
      onXhrCreated(xhr);
    }

    xhr.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable && onProgress) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    });

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText) as T);
        } catch {
          resolve(xhr.responseText as T);
        }
      } else if (xhr.status === 401) {
        // Token expired - could trigger auth redirect
        reject(new Error('Session expired. Please log in again.'));
      } else {
        let detail = xhr.statusText;
        try {
          const body = JSON.parse(xhr.responseText) as ApiErrorBody;
          detail = formatApiError(body, detail);
        } catch {
          // Keep the HTTP status when the server did not return JSON.
        }
        reject(new Error(`Upload failed: ${xhr.status} ${detail}`));
      }
    });

    xhr.addEventListener('error', () => reject(new Error('Upload failed: backend unavailable or network error')));
    xhr.addEventListener('abort', () => reject(new Error('Upload aborted')));

    xhr.send(formData);
  });
}

export function createUploadCanceller() {
  let xhr: XMLHttpRequest | null = null;
  return {
    setXhr: (x: XMLHttpRequest) => { xhr = x; },
    cancel: () => { if (xhr) xhr.abort(); },
  };
}