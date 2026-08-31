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
  const demoTimerRef = useRef<number | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const addAlert = useCallback((alert: LiveAlert) => {
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
      const alert = generateMockAlert();
      addAlert(alert);
    };

    // Initial alerts for demo
    const initialCount = Math.min(5, maxAlerts);
    for (let i = 0; i < initialCount; i++) {
      setTimeout(() => injectAlert(), i * 300);
    }

    demoTimerRef.current = window.setInterval(injectAlert, demoIntervalMs);
    
    return () => {
      if (demoTimerRef.current) {
        clearInterval(demoTimerRef.current);
        demoTimerRef.current = null;
      }
    };
  }, [demoMode, demoIntervalMs, maxAlerts, addAlert]);

  // WebSocket connection (placeholder for real backend)
  useEffect(() => {
    if (!wsUrl) return;

    const connect = () => {
      try {
        wsRef.current = new WebSocket(wsUrl);
        
        wsRef.current.onopen = () => {
          setConnected(true);
          setError(null);
        };

        wsRef.current.onmessage = (event) => {
          try {
            const alert = JSON.parse(event.data) as LiveAlert;
            addAlert(alert);
          } catch {
            console.warn('Failed to parse alert from WebSocket');
          }
        };

        wsRef.current.onclose = () => {
          setConnected(false);
          // Reconnect after 5 seconds
          setTimeout(connect, 5000);
        };

        wsRef.current.onerror = () => {
          setError('WebSocket connection error');
          setConnected(false);
        };
      } catch {
        setError('Failed to establish WebSocket connection');
      }
    };

    connect();

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [wsUrl, addAlert]);

  // Keyboard shortcut to inject test alert (D key)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'd' || e.key === 'D') {
        if ((e.metaKey || e.ctrlKey) && !e.shiftKey) return; // Allow browser shortcuts
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
  };
}