export const API_BASE = import.meta.env.VITE_API_BASE || '';

function getAuthHeaders(): HeadersInit {
  const token = localStorage.getItem('ibvap_token');
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: getAuthHeaders(),
  });
  if (!res.ok) {
    throw new Error(`API error ${res.status}: ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(error.detail || `API error ${res.status}: ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

export async function apiUpload<T>(
  path: string,
  file: File,
  onProgress?: (progress: number) => void,
  metadata?: Record<string, string>
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
      } else {
        reject(new Error(`Upload failed: ${xhr.status} ${xhr.statusText}`));
      }
    });

    xhr.addEventListener('error', () => reject(new Error('Upload failed: Network error')));
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