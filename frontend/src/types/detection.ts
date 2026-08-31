export type AlertType = 'INTRUSION' | 'ANPR' | 'FRS_WATCHLIST' | 'TAMPER';
export type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM';

export interface LiveAlert {
  id: string;
  timestamp: string; // ISO 8601
  cameraID: string;
  location: {
    lat: number;
    lng: number;
    name: string; // e.g., "BOP-04 Alpha - Sector 7"
  };
  alertType: AlertType;
  severity: Severity;
  thumbnailImg: string; // Base64 or URL
  explainabilityHeatmapUrl?: string; // URL to heatmap overlay
  confidence: number; // 0-1
  metadata?: {
    trackId?: string;
    speedKmph?: number;
    direction?: string;
    classification?: string;
  };
}

export interface User {
  name: string;
  role: string;
  bopLocation: string;
}

export interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  hydrated: boolean;
  login: (credentials: { username: string; password: string }) => Promise<void>;
  register: (data: { username: string; email: string; password: string; full_name?: string }) => Promise<void>;
  logout: () => void;
}