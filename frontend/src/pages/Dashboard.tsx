import { useState, useCallback } from 'react';
import { LiveAlert } from '../types/detection';
import { useLiveAlerts } from '../hooks/useLiveAlerts';
import VideoPane from '../components/VideoPane';
import AlertsSidebar from '../components/AlertsSidebar';
import MapView from '../components/MapView';
import AlertDetailCard from '../components/AlertDetailCard';
import { useServerLocation } from '../hooks/useServerLocation';
import { useDeviceLocation } from '../hooks/useDeviceLocation';

export default function Dashboard() {
  const [selectedAlertId, setSelectedAlertId] = useState<string | null>(null);
  const liveWsUrl = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws/stream?monitor=primary&token=${encodeURIComponent(localStorage.getItem('ibvap_token') || '')}`;
  const { alerts, connected, error, isDemoMode, streamFrame } = useLiveAlerts({
    maxAlerts: 15,
    demoMode: false,
    wsUrl: liveWsUrl,
  });
  const { location: serverLocation, error: serverLocationError } = useServerLocation();
  const { location: deviceLocation } = useDeviceLocation();

  const handleAlertClick = useCallback((alert: LiveAlert) => {
    setSelectedAlertId(alert.id);
  }, []);

  const handleCloseDetail = useCallback(() => {
    setSelectedAlertId(null);
  }, []);

  const selectedAlert = alerts.find(a => a.id === selectedAlertId) || null;

  return (
    <main className="dashboard h-[calc(100vh-64px)] flex flex-col bg-[hsl(var(--background))]" role="main">
      {/* Top Bar */}
      <header className="flex items-center justify-between px-4 py-3 border-b border-[hsl(var(--border))] bg-[hsl(var(--muted))] flex-shrink-0">
        <div className="flex items-center gap-4">
          <h1 className="text-xl font-bold text-[hsl(var(--foreground))] tracking-tight">COMMAND DASHBOARD</h1>
          <div className="hidden md:flex items-center gap-2 px-3 py-1 rounded-lg bg-[hsl(var(--background))] border border-[hsl(var(--border))]">
            <span className={`w-2 h-2 rounded-full ${connected ? 'bg-green-500' : 'bg-amber-500 animate-pulse'}`} />
            <span className="text-xs font-mono text-[hsl(var(--muted-foreground))]">
              {connected ? 'WS CONNECTED' : isDemoMode ? 'DEMO MODE' : 'DISCONNECTED'}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {(error || serverLocationError) && (
            <span className="text-xs text-destructive flex items-center gap-1">
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              {error || 'Server location unavailable'}
            </span>
          )}
          {isDemoMode && (
            <span className="px-2 py-1 text-xs font-mono bg-amber-500/20 text-amber-500 border border-amber-500/30 rounded-full">
              DEMO MODE
            </span>
          )}
        </div>
      </header>

      {/* Main Grid */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Panel - Video Feed */}
        <section className="w-full lg:w-2/3 flex flex-col min-w-0" aria-label="Video surveillance feed">
          <VideoPane 
            cameraId="CAM-BDR-001"
            analysisFrame={streamFrame}
            className="h-full"
          />
        </section>

        {/* Right Panel - Map & Alerts */}
        <aside className="w-full lg:w-1/3 flex flex-col border-l border-[hsl(var(--border))] bg-[hsl(var(--muted))] min-w-0" aria-label="Situational awareness">
          {/* Map View */}
          <div className="h-64 lg:h-1/2 p-3 lg:p-4 flex-shrink-0">
            <MapView
              alerts={alerts}
              selectedAlertId={selectedAlertId}
              onAlertClick={handleAlertClick}
              center={[28.9845, 77.7064]}
              zoom={7}
              serverLocation={serverLocation}
              deviceLocation={deviceLocation}
            />
          </div>

          {/* Alerts Sidebar */}
          <div className="flex-1 min-h-0 lg:min-h-[300px] p-3 lg:p-4">
            <AlertsSidebar
              alerts={alerts}
              selectedAlertId={selectedAlertId}
              onAlertClick={handleAlertClick}
              error={error}
              isDemoMode={isDemoMode}
            />
          </div>
        </aside>
      </div>

      {/* Selected Alert Detail Panel (Mobile Bottom Sheet / Desktop Side Panel) */}
      {selectedAlert && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-labelledby="alert-detail-title">
          <div className="absolute inset-0 bg-black/50" onClick={handleCloseDetail} />
          <div className="absolute bottom-0 left-0 right-0 h-[85vh] max-h-[85vh] bg-[hsl(var(--card))] border-t border-[hsl(var(--border))] rounded-t-2xl shadow-2xl flex flex-col animate-in">
            <div className="p-4 border-b border-[hsl(var(--border))] flex items-center justify-between">
              <h2 id="alert-detail-title" className="font-bold text-[hsl(var(--foreground))]">ALERT DETAILS</h2>
              <button onClick={handleCloseDetail} className="p-2 rounded-lg hover:bg-[hsl(var(--muted))] transition-colors" aria-label="Close">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              <AlertDetailCard alert={selectedAlert} onClose={handleCloseDetail} />
            </div>
          </div>
        </div>
      )}
    </main>
  );
}