import { useState, useCallback } from 'react';
import { LiveAlert } from '../types/detection';
import { useLiveAlerts } from '../hooks/useLiveAlerts';
import VideoPane from '../components/VideoPane';
import MapView from '../components/MapView';

const SAMPLE_ALERT: LiveAlert = {
  id: 'ALT-20260831-143022-ABC1',
  timestamp: new Date().toISOString(),
  cameraID: 'CAM-BDR-001',
  location: { lat: 28.9845, lng: 77.7064, name: 'BOP-01 Alpha - Akhnoor Sector' },
  alertType: 'INTRUSION',
  severity: 'HIGH',
  thumbnailImg: 'https://picsum.photos/seed/intrusion1/320/240',
  explainabilityHeatmapUrl: 'https://picsum.photos/seed/heatmap1/320/240',
  confidence: 0.94,
  metadata: { trackId: 'TRK-X7K9', speedKmph: 12, direction: 'NE', classification: 'Human/Pedestrian' },
};

export default function TrackPage() {
  const [selectedAlert, setSelectedAlert] = useState<LiveAlert | null>(SAMPLE_ALERT);
  const { alerts, connected, isDemoMode } = useLiveAlerts({ maxAlerts: 15, demoMode: true, demoIntervalMs: 8000 });

  const handleAlertClick = useCallback((alert: LiveAlert) => {
    setSelectedAlert(alert);
  }, []);

  return (
    <main className="h-[calc(100vh-64px)] flex flex-col bg-[hsl(var(--background))]" role="main">
      <header className="flex items-center justify-between px-4 py-3 border-b border-[hsl(var(--border))] bg-[hsl(var(--muted))] flex-shrink-0">
        <div className="flex items-center gap-4">
          <h1 className="text-xl font-bold text-[hsl(var(--foreground))] tracking-tight">TRACK OBJECT</h1>
          <div className="hidden md:flex items-center gap-2 px-3 py-1 rounded-lg bg-[hsl(var(--background))] border border-[hsl(var(--border))]">
            <span className={`w-2 h-2 rounded-full ${connected ? 'bg-green-500' : 'bg-amber-500 animate-pulse'}`} />
            <span className="text-xs font-mono text-[hsl(var(--muted-foreground))]">
              {connected ? 'WS CONNECTED' : isDemoMode ? 'DEMO MODE' : 'DISCONNECTED'}
            </span>
          </div>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        <section className="w-full lg:w-2/3 flex flex-col min-w-0" aria-label="Video feed">
          <VideoPane cameraId="CAM-BDR-001" className="h-full" />
        </section>

        <aside className="w-full lg:w-1/3 flex flex-col border-l border-[hsl(var(--border))] bg-[hsl(var(--muted))] min-w-0" aria-label="Track details">
          <div className="h-64 lg:h-1/2 p-3 lg:p-4 flex-shrink-0">
            <MapView
              alerts={alerts}
              selectedAlertId={selectedAlert?.id || null}
              onAlertClick={handleAlertClick}
              center={[28.9845, 77.7064]}
              zoom={7}
            />
          </div>

          <div className="flex-1 min-h-0 p-3 lg:p-4 overflow-y-auto">
            {selectedAlert ? (
              <TrackDetailCard alert={selectedAlert} onClose={() => setSelectedAlert(null)} />
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-[hsl(var(--muted-foreground))]">
                <svg className="w-16 h-16 mb-4 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                <p className="text-center">Select an alert to view track details</p>
              </div>
            )}
          </div>
        </aside>
      </div>
    </main>
  );
}

function TrackDetailCard({ alert, onClose }: { alert: LiveAlert; onClose: () => void }) {
  const severityConfig = {
    CRITICAL: { color: '#ef4444', bg: '#ef444420' },
    HIGH: { color: '#f97316', bg: '#f9731620' },
    MEDIUM: { color: '#eab308', bg: '#eab30820' },
  }[alert.severity];

  const typeConfig = {
    INTRUSION: { icon: '🚨', label: 'INTRUSION' },
    ANPR: { icon: '🚗', label: 'ANPR' },
    FRS_WATCHLIST: { icon: '👤', label: 'FRS WATCHLIST' },
    TAMPER: { icon: '🔧', label: 'TAMPER' },
  }[alert.alertType];

  return (
    <div className="space-y-4 h-full overflow-y-auto">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 p-3 rounded-lg border" style={{ borderColor: severityConfig.color, backgroundColor: severityConfig.bg }}>
          <div className="w-12 h-12 rounded-lg flex items-center justify-center text-2xl" style={{ backgroundColor: severityConfig.color + '30' }}>
            {typeConfig.icon}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-[hsl(var(--foreground))]">{typeConfig.label}</span>
              <span className="px-2 py-0.5 text-xs font-medium rounded text-white" style={{ backgroundColor: severityConfig.color }}>
                {alert.severity}
              </span>
            </div>
            <p className="text-sm text-[hsl(var(--muted-foreground))]">{alert.location.name}</p>
          </div>
        </div>
        <button onClick={onClose} className="p-2 rounded-lg hover:bg-[hsl(var(--muted))] transition-colors" aria-label="Close">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="aspect-video rounded-lg overflow-hidden border border-[hsl(var(--border))] bg-[hsl(var(--muted))]">
        <img src={alert.thumbnailImg} alt={`Track thumbnail`} className="w-full h-full object-cover" />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <DetailItem label="Track ID" value={alert.metadata?.trackId || '—'} />
        <DetailItem label="Type" value={typeConfig.label} />
        <DetailItem label="Camera" value={alert.cameraID} />
        <DetailItem label="Severity" value={alert.severity} />
        <DetailItem label="Time" value={new Date(alert.timestamp).toLocaleString()} />
        <DetailItem label="Confidence" value={`${Math.round(alert.confidence * 100)}%`} />
        <DetailItem label="Speed" value={`${alert.metadata?.speedKmph || 0} km/h`} />
        <DetailItem label="Direction" value={alert.metadata?.direction || '—'} />
        <DetailItem label="Coordinates" value={`${alert.location.lat.toFixed(4)}, ${alert.location.lng.toFixed(4)}`} />
        <DetailItem label="Classification" value={alert.metadata?.classification || '—'} />
      </div>

      <div className="pt-2 border-t border-[hsl(var(--border))]">
        <p className="text-xs font-medium text-[hsl(var(--muted-foreground))] mb-2">EXPLAINABILITY HEATMAP</p>
        <div className="aspect-video rounded-lg overflow-hidden border border-[hsl(var(--border))] bg-[hsl(var(--muted))]">
          <img src={alert.explainabilityHeatmapUrl || alert.thumbnailImg} alt="Explainability heatmap" className="w-full h-full object-cover opacity-80" />
        </div>
      </div>
    </div>
  );
}

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="p-3 bg-[hsl(var(--muted))] border border-[hsl(var(--border))] rounded-lg">
      <p className="text-xs font-medium text-[hsl(var(--muted-foreground))] uppercase tracking-wider">{label}</p>
      <p className="text-sm font-mono text-[hsl(var(--foreground))] truncate">{value}</p>
    </div>
  );
}