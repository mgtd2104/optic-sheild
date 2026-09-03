import { useState, useCallback } from 'react';
import { LiveAlert } from '../types/detection';
import { useLiveAlerts } from '../hooks/useLiveAlerts';
import VideoPane from '../components/VideoPane';
import MapView from '../components/MapView';
import AlertDetailCard from '../components/AlertDetailCard';
import FootageUpload, { UploadedFootage } from '../components/FootageUpload';
import { API_BASE } from '../api/client';
import { useServerLocation } from '../hooks/useServerLocation';
import { useDeviceLocation } from '../hooks/useDeviceLocation';

export default function TrackPage() {
  const [selectedAlert, setSelectedAlert] = useState<LiveAlert | null>(null);
  const [showUpload, setShowUpload] = useState(false);
  const [uploadedVideoUrl, setUploadedVideoUrl] = useState<string | null>(null);
  const [uploadedFootageId, setUploadedFootageId] = useState<string | null>(null);
  const liveWsUrl = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws/stream?monitor=primary&token=${encodeURIComponent(localStorage.getItem('ibvap_token') || '')}`;
  const { alerts, connected, isDemoMode, streamFrame } = useLiveAlerts({ maxAlerts: 15, demoMode: false, wsUrl: liveWsUrl });
  const { location: serverLocation } = useServerLocation();
  const { location: deviceLocation } = useDeviceLocation();

  const handleAlertClick = useCallback((alert: LiveAlert) => {
    setSelectedAlert(alert);
  }, []);

  const handleUploadComplete = useCallback((footage: UploadedFootage) => {
    setUploadedVideoUrl(`${API_BASE}${footage.url}`);
    setUploadedFootageId(footage.id);
    setShowUpload(false);
  }, []);

  const analysisWsUrl = uploadedFootageId
    ? `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws/footage/${uploadedFootageId}?monitor=primary&token=${encodeURIComponent(localStorage.getItem('ibvap_token') || '')}`
    : undefined;

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
        <button
          type="button"
          onClick={() => setShowUpload(value => !value)}
          className="inline-flex items-center gap-2 rounded-lg bg-[hsl(var(--primary))] px-3 py-2 text-sm font-medium text-white transition-colors hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))] focus:ring-offset-2"
          aria-expanded={showUpload}
          aria-controls="track-upload-panel"
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M12 3v12m0 0 4-4m-4 4-4-4M5 21h14a2 2 0 0 0 2-2v-4M3 15v4a2 2 0 0 0 2 2" />
          </svg>
          {showUpload ? 'Close uploader' : 'Upload video'}
        </button>
      </header>

      {showUpload && (
        <section id="track-upload-panel" className="max-h-[min(360px,45vh)] overflow-y-auto border-b border-[hsl(var(--border))] bg-[hsl(var(--background))] p-4" aria-label="Upload video footage">
          <FootageUpload cameraId="CAM-BDR-001" onUploadComplete={handleUploadComplete} maxSizeMB={100} />
        </section>
      )}

      <div className="flex-1 flex overflow-hidden">
        <section className="w-full lg:w-2/3 flex flex-col min-w-0" aria-label="Video feed">
          <VideoPane cameraId={uploadedVideoUrl ? 'AI ANALYZED FOOTAGE' : 'CAM-BDR-001'} streamUrl={uploadedVideoUrl || undefined} analysisWsUrl={analysisWsUrl} analysisFrame={uploadedFootageId ? null : streamFrame} className="h-full" />
        </section>

        <aside className="w-full lg:w-1/3 flex flex-col border-l border-[hsl(var(--border))] bg-[hsl(var(--muted))] min-w-0" aria-label="Track details">
          <div className="h-64 lg:h-1/2 p-3 lg:p-4 flex-shrink-0">
            <MapView
              alerts={alerts}
              selectedAlertId={selectedAlert?.id || null}
              onAlertClick={handleAlertClick}
              center={[28.9845, 77.7064]}
              zoom={7}
              serverLocation={serverLocation}
              deviceLocation={deviceLocation}
            />
          </div>

          <div className="flex-1 min-h-0 p-3 lg:p-4 overflow-y-auto">
            {selectedAlert ? (
              <AlertDetailCard alert={selectedAlert} onClose={() => setSelectedAlert(null)} showExplainability showTrackInfo />
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