import { useState, useEffect, useCallback, useRef } from 'react';
import { LiveAlert, AlertType, Severity } from '../types/detection';

const ALERT_TYPES: AlertType[] = ['INTRUSION', 'ANPR', 'FRS_WATCHLIST', 'TAMPER'];
const SEVERITIES: Severity[] = ['CRITICAL', 'HIGH', 'MEDIUM'];

const LOCATIONS = [
  { lat: 28.9845, lng: 77.7064, name: 'BOP-01 Alpha - Akhnoor Sector' },
  { lat: 30.3165, lng: 78.0322, name: 'BOP-02 Bravo - Uttarkashi Sector' },
  { lat: 29.5847, lng: 79.1234, name: 'BOP-03 Charlie - Pithoragarh Sector' },
  { lat: 28.9567, lng: 77.8901, name: 'BOP-04 Alpha - Rajouri Sector' },
  { lat: 32.7266, lng: 74.8570, name: 'BOP-05 Delta - Jammu Sector' },
  { lat: 34.0837, lng: 74.7973, name: 'BOP-06 Echo - Baramulla Sector' },
  { lat: 33.7782, lng: 75.0761, name: 'BOP-07 Foxtrot - Kupwara Sector' },
  { lat: 33.2778, lng: 75.3412, name: 'BOP-08 Golf - Anantnag Sector' },
];

const CAMERAS = [
  'CAM-BDR-001', 'CAM-BDR-002', 'CAM-BDR-003', 'CAM-BDR-004',
  'CAM-PER-001', 'CAM-PER-002', 'CAM-PER-003', 'CAM-MOB-001',
];

const THUMBNAILS = [
  'https://picsum.photos/seed/intrusion1/160/120',
  'https://picsum.photos/seed/anpr1/160/120',
  'https://picsum.photos/seed/frs1/160/120',
  'https://picsum.photos/seed/tamper1/160/120',
  'https://picsum.photos/seed/intrusion2/160/120',
  'https://picsum.photos/seed/anpr2/160/120',
];

const MONITOR_LOCK_KEY = 'ibvap_live_monitor_owner';

function generateAlertId(): string {
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
  const timeStr = now.toTimeString().slice(0, 8).replace(/:/g, '');
  const random = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `ALT-${dateStr}-${timeStr}-${random}`;
}

function generateMockAlert(): LiveAlert {
  const alertType = ALERT_TYPES[Math.floor(Math.random() * ALERT_TYPES.length)];
  const severity = SEVERITIES[Math.floor(Math.random() * SEVERITIES.length)];
  const location = LOCATIONS[Math.floor(Math.random() * LOCATIONS.length)];
  const cameraID = CAMERAS[Math.floor(Math.random() * CAMERAS.length)];
  const thumbnailImg = THUMBNAILS[Math.floor(Math.random() * THUMBNAILS.length)];
  
  let confidence = 0.75 + Math.random() * 0.2;
  if (severity === 'CRITICAL') confidence = 0.9 + Math.random() * 0.1;
  else if (severity === 'HIGH') confidence = 0.8 + Math.random() * 0.15;

  return {
    id: generateAlertId(),
    timestamp: new Date().toISOString(),
    cameraID,
    location,
    alertType,
    severity,
    thumbnailImg,
    explainabilityHeatmapUrl: `https://picsum.photos/seed/heatmap-${Date.now()}/320/240`,
    confidence: Math.round(confidence * 100) / 100,
    metadata: {
      trackId: `TRK-${Math.random().toString(36).substring(2, 10).toUpperCase()}`,
      speedKmph: Math.round(5 + Math.random() * 40),
      direction: ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.floor(Math.random() * 8)],
      classification: alertType === 'INTRUSION' ? 'Human/Pedestrian' : 
                      alertType === 'ANPR' ? 'Vehicle' : 
                      alertType === 'FRS_WATCHLIST' ? 'Known Entity' : 'Camera System',
    },
  };
}

interface StreamAlertPayload {
  type: string;
  severity: string;
  message: string;
  timestamp: string;
  detection_id?: string;
}

interface StreamPayload {
  frame?: string;
  detections?: { confidence: number }[];
  alerts?: StreamAlertPayload[];
}

export interface LiveStreamFrame {
  frame: string;
  detections: { confidence: number }[];
  alerts: StreamAlertPayload[];
}

function streamAlertToLiveAlert(alert: StreamAlertPayload): LiveAlert {
  const alertType = ALERT_TYPES.includes(alert.type as AlertType) ? alert.type as AlertType : 'INTRUSION';
  const severity = SEVERITIES.includes(alert.severity.toUpperCase() as Severity) ? alert.severity.toUpperCase() as Severity : 'MEDIUM';
  return {
    id: alert.detection_id || `${alert.timestamp}-${Math.random()}`,
    timestamp: alert.timestamp,
    cameraID: 'CAM-BDR-001',
    location: LOCATIONS[0],
    alertType,
    severity,
    thumbnailImg: '',
    confidence: 1,
    metadata: { classification: alert.message },
  };
}

interface UseLiveAlertsOptions {
  maxAlerts?: number;
  demoMode?: boolean;
  demoIntervalMs?: number;
  wsUrl?: string;
}

export function useLiveAlerts({
  maxAlerts = 15,
  demoMode = true,
  demoIntervalMs = 6000,
  wsUrl,
}: UseLiveAlertsOptions = {}) {
  const [alerts, setAlerts] = useState<LiveAlert[]>([]);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [streamFrame, setStreamFrame] = useState<LiveStreamFrame | null>(null);
  const demoTimerRef = useRef<number | null>(null);
  const initialTimeoutRefs = useRef<number[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const reconnectAttemptRef = useRef(0);
  const monitorOwnerRef = useRef(`${Date.now()}-${Math.random()}`);
  const isMountedRef = useRef(true);

  const addAlert = useCallback((alert: LiveAlert) => {
    if (!isMountedRef.current) return;
    setAlerts(prev => {
      const updated = [alert, ...prev].slice(0, maxAlerts);
      return updated;
    });
  }, [maxAlerts]);

  const removeAlert = useCallback((id: string) => {
    setAlerts(prev => prev.filter(a => a.id !== id));
  }, []);

  const clearAlerts = useCallback(() => {
    setAlerts([]);
  }, []);

  // Demo mode generator
  useEffect(() => {
    if (!demoMode) return;

    const injectAlert = () => {
      if (!isMountedRef.current) return;
      const alert = generateMockAlert();
      addAlert(alert);
    };

    // Initial alerts for demo - track timeouts for cleanup
    const initialCount = Math.min(5, maxAlerts);
    for (let i = 0; i < initialCount; i++) {
      const timeoutId = window.setTimeout(() => injectAlert(), i * 300);
      initialTimeoutRefs.current.push(timeoutId);
    }

    demoTimerRef.current = window.setInterval(injectAlert, demoIntervalMs);
    
    return () => {
      if (demoTimerRef.current) {
        clearInterval(demoTimerRef.current);
        demoTimerRef.current = null;
      }
      // Clear all initial alert timeouts
      initialTimeoutRefs.current.forEach(id => clearTimeout(id));
      initialTimeoutRefs.current = [];
    };
  }, [demoMode, demoIntervalMs, maxAlerts, addAlert]);

  // WebSocket connection (placeholder for real backend)
  useEffect(() => {
    if (!wsUrl) return;

    const ownerId = monitorOwnerRef.current;
    const existingLock = localStorage.getItem(MONITOR_LOCK_KEY);
    if (existingLock) {
      try {
        const lock = JSON.parse(existingLock) as { owner: string; updatedAt: number };
        if (lock.owner !== ownerId && Date.now() - lock.updatedAt < 15000) {
          setError('Live monitoring is active in another browser tab.');
          return;
        }
      } catch {
        localStorage.removeItem(MONITOR_LOCK_KEY);
      }
    }

    const updateLock = () => localStorage.setItem(MONITOR_LOCK_KEY, JSON.stringify({ owner: ownerId, updatedAt: Date.now() }));
    updateLock();
    const lockTimer = window.setInterval(updateLock, 5000);

    isMountedRef.current = true;

    const connect = () => {
      if (!isMountedRef.current) return;
      try {
        // Close existing connection if any
        if (wsRef.current) {
          wsRef.current.close();
        }
        
        wsRef.current = new WebSocket(wsUrl);
        
        wsRef.current.onopen = () => {
          if (!isMountedRef.current) return;
          setConnected(true);
          setError(null);
          reconnectAttemptRef.current = 0;
        };

        wsRef.current.onmessage = (event) => {
          if (!isMountedRef.current) return;
          try {
            const payload = JSON.parse(event.data) as StreamPayload;
            if (payload.frame) {
              setStreamFrame({
                frame: payload.frame,
                detections: payload.detections || [],
                alerts: payload.alerts || [],
              });
            }
            payload.alerts?.forEach(alert => addAlert(streamAlertToLiveAlert(alert)));
          } catch {
            // Silently ignore parse errors in production
          }
        };

        wsRef.current.onclose = () => {
          if (!isMountedRef.current) return;
          setConnected(false);
          if (wsRef.current?.readyState === WebSocket.CLOSED && reconnectAttemptRef.current >= 5) {
            setError('Live monitoring capacity reached. Close other monitoring tabs and retry.');
            return;
          }
          // Back off to avoid flooding a busy CPU-only backend.
          if (reconnectTimerRef.current) {
            clearTimeout(reconnectTimerRef.current);
          }
          reconnectAttemptRef.current += 1;
          const delay = Math.min(60000, 5000 * 2 ** Math.min(reconnectAttemptRef.current - 1, 4));
          reconnectTimerRef.current = window.setTimeout(connect, delay);
        };

        wsRef.current.onerror = () => {
          if (!isMountedRef.current) return;
          setError('WebSocket connection error');
          setConnected(false);
        };
      } catch {
        if (!isMountedRef.current) return;
        setError('Failed to establish WebSocket connection');
      }
    };

    connect();

    return () => {
      isMountedRef.current = false;
      window.clearInterval(lockTimer);
      const currentLock = localStorage.getItem(MONITOR_LOCK_KEY);
      if (currentLock?.includes(ownerId)) localStorage.removeItem(MONITOR_LOCK_KEY);
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      reconnectAttemptRef.current = 0;
    };
  }, [wsUrl, addAlert]);

  // Keyboard shortcut to inject test alert (D key)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'd' || e.key === 'D') {
        if ((e.metaKey || e.ctrlKey) && !e.shiftKey) return; // Allow browser shortcuts
        const target = e.target as HTMLElement | null;
        const isEditable =
          target &&
          (target.tagName === 'INPUT' ||
            target.tagName === 'TEXTAREA' ||
            target.tagName === 'SELECT' ||
            target.isContentEditable);
        if (isEditable) return; // Don't hijack typing in search boxes/forms
        addAlert(generateMockAlert());
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [addAlert]);

  return {
    alerts,
    connected,
    error,
    addAlert,
    removeAlert,
    clearAlerts,
    isDemoMode: demoMode && !wsUrl,
    streamFrame,
  };
}