import { Detection } from '../types/detection';
import { useEffect, useRef, useState } from 'react';
import FootageUpload from './FootageUpload';
import '../styles/trackmodal.css';

interface TrackModalProps {
  detection: Detection | null;
  open: boolean;
  onClose: () => void;
}

export default function TrackModal({ detection, open, onClose }: TrackModalProps) {
  const [activeTab, setActiveTab] = useState<'video' | 'map' | 'metadata' | 'upload'>('video');
  const videoRef = useRef<HTMLVideoElement>(null);
  const mapRef = useRef<HTMLDivElement>(null);
  const [mapLoaded, setMapLoaded] = useState(false);

  useEffect(() => {
    if (open && detection && mapRef.current && !mapLoaded) {
      const mapContainer = mapRef.current;
      mapContainer.innerHTML = `
        <div class="map-placeholder" style="display:flex;align-items:center;justify-content:center;height:100%;color:#9ca3af;">
          Map centered at ${detection.lat.toFixed(4)}, ${detection.lng.toFixed(4)}
          <div style="margin-top:8px;font-size:12px;">Leaflet/Mapbox integration point</div>
        </div>
      `;
      setMapLoaded(true);
    }
  }, [open, detection, mapLoaded]);

  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  if (!open || !detection) return null;

  return (
    <div 
      className="track-modal-overlay" 
      onClick={onClose}
      role="dialog" 
      aria-modal="true" 
      aria-labelledby="track-modal-title"
    >
      <div className="track-modal" onClick={e => e.stopPropagation()}>
        <header className="track-modal-header">
          <h2 id="track-modal-title">Track Object</h2>
          <div className="track-modal-badges">
            <span className={`severity-badge ${detection.severity}`} aria-label={`Severity: ${detection.severity}`}>
              {detection.severity.toUpperCase()}
            </span>
            <span className="type-badge">{detection.type.toUpperCase()}</span>
          </div>
          <button 
            className="close-btn" 
            onClick={onClose} 
            aria-label="Close track details"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </header>

        <div className="track-modal-tabs" role="tablist" aria-label="Track detail views">
          <button 
            role="tab" 
            aria-selected={activeTab === 'video'} 
            aria-controls="video-panel"
            id="video-tab"
            className={activeTab === 'video' ? 'active' : ''}
            onClick={() => setActiveTab('video')}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm16-4H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H8V4h12v12z"/></svg>
            <span>Video</span>
          </button>
          <button 
            role="tab" 
            aria-selected={activeTab === 'map'} 
            aria-controls="map-panel"
            id="map-tab"
            className={activeTab === 'map' ? 'active' : ''}
            onClick={() => setActiveTab('map')}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>
            <span>Map</span>
          </button>
          <button 
            role="tab" 
            aria-selected={activeTab === 'metadata'} 
            aria-controls="metadata-panel"
            id="metadata-tab"
            className={activeTab === 'metadata' ? 'active' : ''}
            onClick={() => setActiveTab('metadata')}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 17h-2v-2h2v2zm2.07-7.75l-.9.92C13.45 12.9 13 13.5 13 15h-2v-.5c0-1.1.45-2.1 1.17-2.83l1.24-1.24c.37-.36.59-.86.59-1.41 0-1.1-.9-2-2-2s-2 .9-2 2H8c0-2.21 1.79-4 4-4s4 1.79 4 4c0 .88-.36 1.68-.93 2.25z"/></svg>
            <span>Metadata</span>
          </button>
          <button 
            role="tab" 
            aria-selected={activeTab === 'upload'} 
            aria-controls="upload-panel"
            id="upload-tab"
            className={activeTab === 'upload' ? 'active' : ''}
            onClick={() => setActiveTab('upload')}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
            <span>Upload</span>
          </button>
        </div>

        <div className="track-modal-content">
          {activeTab === 'video' && (
            <div role="tabpanel" id="video-panel" aria-labelledby="video-tab" className="tab-panel">
              <div className="video-player-wrapper">
                <video
                  ref={videoRef}
                  className="video-player"
                  controls
                  playsInline
                  crossOrigin="anonymous"
                  src={detection.videoUrl || 'https://assets.mixkit.co/videos/preview/mixkit-security-camera-footage-of-a-hallway-33348-large.mp4'}
                >
                  Your browser does not support the video tag.
                </video>
              </div>
              <div className="video-info">
                <p><strong>Source:</strong> {detection.cameraId}</p>
                <p><strong>Recorded:</strong> {new Date(detection.timestamp).toLocaleString()}</p>
                <p><strong>Confidence:</strong> {Math.round(detection.confidence * 100)}%</p>
              </div>
            </div>
          )}
          
          {activeTab === 'map' && (
            <div role="tabpanel" id="map-panel" aria-labelledby="map-tab" className="tab-panel">
              <div ref={mapRef} className="map-container" aria-label="Detection location map"></div>
              <div className="map-coords">
                <p><strong>Latitude:</strong> {detection.lat.toFixed(6)}</p>
                <p><strong>Longitude:</strong> {detection.lng.toFixed(6)}</p>
                <button className="copy-coords-btn" onClick={() => navigator.clipboard.writeText(`${detection.lat}, ${detection.lng}`)}>
                  Copy Coordinates
                </button>
              </div>
            </div>
          )}
          
          {activeTab === 'metadata' && (
            <div role="tabpanel" id="metadata-panel" aria-labelledby="metadata-tab" className="tab-panel">
              <dl className="metadata-grid">
                <div><dt>Detection ID</dt><dd>{detection.id}</dd></div>
                <div><dt>Type</dt><dd>{detection.type.toUpperCase()}</dd></div>
                <div><dt>Severity</dt><dd>{detection.severity.toUpperCase()}</dd></div>
                <div><dt>Camera ID</dt><dd>{detection.cameraId}</dd></div>
                <div><dt>Timestamp</dt><dd>{new Date(detection.timestamp).toLocaleString()}</dd></div>
                <div><dt>Confidence</dt><dd>{Math.round(detection.confidence * 100)}%</dd></div>
                <div><dt>Location</dt><dd>{detection.lat.toFixed(6)}, {detection.lng.toFixed(6)}</dd></div>
                <div><dt>Video URL</dt><dd><a href={detection.videoUrl} target="_blank" rel="noopener">View Source</a></dd></div>
              </dl>
            </div>
          )}

          {activeTab === 'upload' && (
            <div role="tabpanel" id="upload-panel" aria-labelledby="upload-tab" className="tab-panel">
              <FootageUpload
                cameraId={detection.cameraId}
                detectionId={detection.id}
                maxSizeMB={1000}
              />
            </div>
          )}
        </div>

        <footer className="track-modal-footer">
          <button className="btn-secondary" onClick={onClose}>Close</button>
          <button className="btn-primary" onClick={() => navigator.clipboard.writeText(JSON.stringify(detection, null, 2))}>
            Copy JSON
          </button>
        </footer>
      </div>
    </div>
  );
}