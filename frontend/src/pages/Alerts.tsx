import { useState, useCallback } from 'react';
import { LiveAlert } from '../types/detection';
import { useLiveAlerts } from '../hooks/useLiveAlerts';
import AlertsSidebar from '../components/AlertsSidebar';

export default function AlertsPage() {
  const [selectedAlertId, setSelectedAlertId] = useState<string | null>(null);
  const { alerts, connected, error, isDemoMode } = useLiveAlerts({
    maxAlerts: 50,
    demoMode: true,
    demoIntervalMs: 6000,
  });

  const handleAlertClick = useCallback((alert: LiveAlert) => {
    setSelectedAlertId(alert.id);
  }, []);

  const handleCloseDetail = useCallback(() => {
    setSelectedAlertId(null);
  }, []);

  const selectedAlert = alerts.find(a => a.id === selectedAlertId) || null;

  return (
    <main className="h-[calc(100vh-64px)] flex flex-col bg-[hsl(var(--background))]" role="main">
      <header className="flex items-center justify-between px-4 py-3 border-b border-[hsl(var(--border))] bg-[hsl(var(--muted))] flex-shrink-0">
        <div className="flex items-center gap-4">
          <h1 className="text-xl font-bold text-[hsl(var(--foreground))] tracking-tight">ALL ALERTS</h1>
          <div className="hidden md:flex items-center gap-2 px-3 py-1 rounded-lg bg-[hsl(var(--background))] border border-[hsl(var(--border))]">
            <span className={`w-2 h-2 rounded-full ${connected ? 'bg-green-500' : 'bg-amber-500 animate-pulse'}`} />
            <span className="text-xs font-mono text-[hsl(var(--muted-foreground))]">
              {connected ? 'WS CONNECTED' : isDemoMode ? 'DEMO MODE' : 'DISCONNECTED'}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {error && (
            <span className="text-xs text-destructive flex items-center gap-1">
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              {error}
            </span>
          )}
          {isDemoMode && (
            <span className="px-2 py-1 text-xs font-mono bg-amber-500/20 text-amber-500 border border-amber-500/30 rounded-full">
              DEMO MODE
            </span>
          )}
        </div>
      </header>

      <div className="flex-1 overflow-hidden">
        <AlertsSidebar
          alerts={alerts}
          selectedAlertId={selectedAlertId}
          onAlertClick={setSelectedAlertId}
          error={error}
          isDemoMode={isDemoMode}
        />
      </div>

      {selectedAlert && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-labelledby="alert-detail-title">
          <div className="absolute inset-0 bg-black/50" onClick={() => setSelectedAlertId(null)} />
          <div className="absolute bottom-0 left-0 right-0 h-[85vh] max-h-[85vh] bg-[hsl(var(--card))] border-t border-[hsl(var(--border))] rounded-t-2xl shadow-2xl flex flex-col animate-in">
            <div className="p-4 border-b border-[hsl(var(--border))] flex items-center justify-between">
              <h2 id="alert-detail-title" className="font-bold text-[hsl(var(--foreground))]">ALERT DETAILS</h2>
              <button onClick={() => setSelectedAlertId(null)} className="p-2 rounded-lg hover:bg-[hsl(var(--muted))] transition-colors" aria-label="Close">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              <AlertDetailCard alert={alerts.find(a => a.id === selectedAlertId)!} onClose={() => setSelectedAlertId(null)} />
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function AlertDetailCard({ alert, onClose }: { alert: LiveAlert; onClose: () => void }) {
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
    <div className="space-y-4">
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

      <div className="aspect-video rounded-lg overflow-hidden border border-[hsl(var(--border))] bg-[hsl(var(--muted))]">
        <img src={alert.thumbnailImg} alt={`Alert thumbnail for ${alert.alertType}`} className="w-full h-full object-cover" />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <DetailItem label="Alert ID" value={alert.id} />
        <DetailItem label="Camera" value={alert.cameraID} />
        <DetailItem label="Timestamp" value={new Date(alert.timestamp).toLocaleString()} />
        <DetailItem label="Confidence" value={`${Math.round(alert.confidence * 100)}%`} />
        <DetailItem label="Coordinates" value={`${alert.location.lat.toFixed(4)}, ${alert.location.lng.toFixed(4)}`} />
        <DetailItem label="Direction" value={alert.metadata?.direction || '—'} />
        <DetailItem label="Speed" value={`${alert.metadata?.speedKmph || 0} km/h`} />
        <DetailItem label="Track ID" value={alert.metadata?.trackId || '—'} />
      </div>

      <div className="flex gap-2 pt-2">
        <button onClick={onClose} className="flex-1 py-2.5 px-4 bg-[hsl(var(--secondary))] text-[hsl(var(--secondary-foreground))] font-medium rounded-lg border border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))] transition-colors">
          Close
        </button>
        <button onClick={() => navigator.clipboard.writeText(JSON.stringify(alert, null, 2))} className="flex-1 py-2.5 px-4 bg-primary text-primary-foreground font-medium rounded-lg hover:opacity-90 transition-opacity">
          Copy JSON
        </button>
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