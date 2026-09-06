/**
 * Optic Shield — CameraGrid Component
 * 
 * Multi-camera live network stream grid for C2 dashboard.
 * Features:
 * - Grid layout displaying live video thumbnails / WebRTC stream feeds
 * - Overlays camera health badge, connection status
 * - PTZ control overlay buttons (Pan, Tilt, Zoom, Auto-Slew toggle)
 * - Grid layout: 1x1, 2x2, 3x3, 4x4
 * - Per-camera health indicator (green/amber/red)
 * - Camera selection sync with MapGIS
 * - Low-latency WebRTC fallback for on-demand streaming
 * - Dark tactical theme
 */

import React, {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  useImperativeHandle,
  forwardRef,
} from 'react';
import {
  Camera,
  Wifi,
  WifiOff,
  Maximize2,
  Minimize2,
  RotateCcw,
  ZoomIn,
  ZoomOut,
  Move,
  Target,
  Settings,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Loader2,
  Play,
  Pause,
  Volume2,
  VolumeX,
  MapPin,
  Navigation,
  ChevronLeft,
  ChevronRight,
  Grid,
  Layout,
  Fullscreen,
  Minimize,
  RefreshCw,
  Zap,
  Shield,
  Activity,
  Signal,
} from 'lucide-react';

// ============================================================
// Theme Constants
// ============================================================
const THEME = {
  darkSlate: '#090D16',
  tacticalBlue: '#3B82F6',
  criticalRed: '#EF4444',
  warningAmber: '#F59E0B',
  successGreen: '#10B981',
  mutedSlate: '#1E293B',
  borderSlate: '#334155',
  textPrimary: '#F1F5F9',
  textSecondary: '#94A3B8',
  textMuted: '#64748B',
};

const CAMERA_STATUS = {
  online: { label: 'ONLINE', color: THEME.successGreen, icon: CheckCircle },
  offline: { label: 'OFFLINE', color: '#6B7280', icon: XCircle },
  degraded: { label: 'DEGRADED', color: THEME.warningAmber, icon: AlertTriangle },
  maintenance: { label: 'MAINT', color: THEME.tacticalBlue, icon: Settings },
  tampered: { label: 'TAMPERED', color: THEME.criticalRed, icon: Shield },
};

// ============================================================
// Camera Tile Component
// ============================================================
const CameraTile = React.memo(function CameraTile({
  camera,
  selected,
  onClick,
  onPTZCommand,
  showPTZ = true,
  streamUrl,
  compact = false,
}) {
  const [streamError, setStreamError] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [ptzOpen, setPtzOpen] = useState(false);
  const videoRef = useRef(null);
  const statusConfig = CAMERA_STATUS[camera.status] || CAMERA_STATUS.offline;
  
  // Generate mock stream URL for demo
  const src = useMemo(() => {
    if (streamUrl) return streamUrl;
    // Mock: Use a placeholder or test stream
    return camera.rtsp_url || `https://via.placeholder.com/640x360/${camera.id}?text=BOP-CAM-${camera.id.toString().padStart(3, '0')}`;
  }, [camera, streamUrl]);

  const handleVideoError = useCallback(() => {
    setStreamError(true);
    setStreaming(false);
  }, []);

  const handleVideoLoad = useCallback(() => {
    setStreamError(false);
    setStreaming(true);
  }, []);

  const handlePTZ = useCallback((command) => {
    onPTZCommand?.(camera.id, command);
  }, [camera.id, onPTZCommand]);

  if (compact) {
    return (
      <div
        className={`camera-tile-compact ${selected ? 'selected' : ''}`}
        style={getCompactTileStyle(selected)}
        onClick={() => onClick?.(camera)}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{
            width: '10px',
            height: '10px',
            borderRadius: '50%',
            background: statusConfig.color,
            boxShadow: `0 0 8px ${statusConfig.color}`,
          }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '12px', fontWeight: 600, color: THEME.textPrimary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {camera.name || `BOP-CAM-${camera.id.toString().padStart(3, '0')}`}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '10px', color: THEME.textSecondary, marginTop: '2px' }}>
              <span style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '3px',
                padding: '1px 6px',
                borderRadius: '3px',
                fontSize: '9px',
                fontWeight: 600,
                background: `rgba(${hexToRgb(statusConfig.color)}, 0.2)`,
                color: statusConfig.color,
                textTransform: 'uppercase',
              }}>
                <statusConfig.icon size={8} /> {statusConfig.label}
              </span>
              <span>Health: {camera.health_score}%</span>
            </div>
          </div>
          <div style={{ fontSize: '10px', color: THEME.textMuted, fontFamily: 'monospace' }}>
            {camera.latitude?.toFixed(4)}, {camera.longitude?.toFixed(4)}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`camera-tile ${selected ? 'selected' : ''} ${streamError ? 'error' : ''}`}
      style={getTileStyle(selected, streamError)}
      onClick={() => onClick?.(camera)}
    >
      {/* Video Stream Area */}
      <div style={videoContainerStyle}>
        {streamError ? (
          <div style={errorOverlayStyle}>
            <XCircle size={48} style={{ color: THEME.criticalRed, marginBottom: '12px' }} />
            <div style={{ fontSize: '14px', fontWeight: 600, color: THEME.textPrimary, marginBottom: '8px' }}>
              Stream Unavailable
            </div>
            <div style={{ fontSize: '12px', color: THEME.textSecondary, marginBottom: '16px' }}>
              {camera.rtsp_url ? 'RTSP stream failed to load' : 'No stream URL configured'}
            </div>
            <button
              onClick={() => { setStreamError(false); videoRef.current?.load(); }}
              className="btn-primary"
              style={{ padding: '8px 16px', fontSize: '12px' }}
            >
              <RotateCcw size={14} /> Retry Stream
            </button>
          </div>
        ) : (
          <>
            <video
              ref={videoRef}
              src={src}
              style={videoStyle}
              onError={handleVideoError}
              onLoadStart={() => setStreaming(false)}
              onLoadedData={handleVideoLoad}
              onWaiting={() => setStreaming(false)}
              onPlaying={handleVideoLoad}
              playsInline
              muted
              autoPlay
              crossOrigin="anonymous"
            />
            
            {/* Loading Overlay */}
            {!streaming && !streamError && (
              <div style={loadingOverlayStyle}>
                <Loader2 size={32} className="spinning" style={{ color: THEME.tacticalBlue, marginBottom: '12px' }} />
                <div style={{ fontSize: '13px', color: THEME.textSecondary }}>Connecting to stream...</div>
                <div style={{ fontSize: '11px', color: THEME.textMuted, marginTop: '4px' }}>
                  {camera.rtsp_url ? 'RTSP Stream' : 'Placeholder'}
                </div>
              </div>
            )}
            
            {/* Stream Status Indicator */}
            <div style={streamIndicatorStyle}>
              <div style={{
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                background: streaming ? THEME.successGreen : (streamError ? THEME.criticalRed : THEME.warningAmber),
                boxShadow: streaming ? `0 0 8px ${THEME.successGreen}` : 'none',
                animation: streaming ? 'pulse 2s ease-in-out infinite' : 'none',
              }} />
              <span style={{ fontSize: '10px', fontWeight: 600, color: THEME.textPrimary, textTransform: 'uppercase' }}>
                {streaming ? 'LIVE' : streamError ? 'ERROR' : 'CONNECTING'}
              </span>
            </div>
          </>
        )}

        {/* Camera Info Overlay */}
        <div style={infoOverlayStyle}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Camera size={16} style={{ color: THEME.tacticalBlue }} />
              <div>
                <div style={{ fontSize: '13px', fontWeight: 600, color: THEME.textPrimary }}>
                  {camera.name || `BOP-CAM-${camera.id.toString().padStart(3, '0')}`}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '2px' }}>
                  <span style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '3px',
                    padding: '2px 8px',
                    borderRadius: '4px',
                    fontSize: '9px',
                    fontWeight: 600,
                    background: `rgba(${hexToRgb(statusConfig.color)}, 0.2)`,
                    color: statusConfig.color,
                    textTransform: 'uppercase',
                  }}>
                    <statusConfig.icon size={8} /> {statusConfig.label}
                  </span>
                  <span style={{ fontSize: '11px', color: THEME.textSecondary }}>
                    Health: {camera.health_score}%
                  </span>
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '11px', color: THEME.textSecondary, fontFamily: 'monospace' }}>
                {camera.latitude?.toFixed(4)}, {camera.longitude?.toFixed(4)}
              </span>
              <span style={{ fontSize: '11px', color: THEME.textSecondary }}>
                {camera.heading ? `${camera.heading}°` : '—'}
              </span>
            </div>
          </div>
        </div>

        {/* PTZ Controls Overlay */}
        {showPTZ && (
          <div style={ptzOverlayStyle}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {/* Pan/Tilt Controls */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px' }}>
                <button onClick={() => handlePTZ('tilt_up')} className="ptz-btn" title="Tilt Up">
                  <ChevronUp size={18} />
                </button>
                <button onClick={() => handlePTZ('home')} className="ptz-btn" title="Home Position" style={{ gridColumn: '2' }}>
                  <Target size={18} />
                </button>
                <button onClick={() => handlePTZ('tilt_down')} className="ptz-btn" title="Tilt Down">
                  <ChevronDown size={18} />
                </button>
                <button onClick={() => handlePTZ('pan_left')} className="ptz-btn" title="Pan Left">
                  <ChevronLeft size={18} />
                </button>
                <button onClick={() => handlePTZ('stop')} className="ptz-btn" title="Stop" style={{ gridColumn: '2', background: 'rgba(239, 68, 68, 0.2)', borderColor: THEME.criticalRed }}>
                  <X size={18} />
                </button>
                <button onClick={() => handlePTZ('pan_right')} className="ptz-btn" title="Pan Right">
                  <ChevronRight size={18} />
                </button>
              </div>
              
              {/* Zoom Controls */}
              <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
                <button onClick={() => handlePTZ('zoom_out')} className="ptz-btn" title="Zoom Out">
                  <ZoomOut size={16} />
                </button>
                <button onClick={() => handlePTZ('zoom_in')} className="ptz-btn" title="Zoom In">
                  <ZoomIn size={16} />
                </button>
              </div>
              
              {/* Auto-Slew Toggle */}
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px', background: 'rgba(59, 130, 246, 0.1)', border: `1px solid ${THEME.tacticalBlue}40`, borderRadius: '8px', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={camera.auto_slew}
                  onChange={(e) => handlePTZ(e.target.checked ? 'auto_slew_on' : 'auto_slew_off')}
                  style={{ width: '16px', height: '16px', accentColor: THEME.tacticalBlue }}
                />
                <Navigation size={14} style={{ color: THEME.tacticalBlue }} />
                <span style={{ fontSize: '11px', fontWeight: 500, color: THEME.textPrimary }}>Auto-Slew to Kalman Track</span>
              </label>
            </div>
          </div>
        )}

        {/* Expand Button */}
        <button
          onClick={(e) => { e.stopPropagation(); onClick?.(camera, 'expand'); }}
          className="expand-btn"
          style={expandButtonStyle}
          title="Expand to Fullscreen"
        >
          <Maximize2 size={16} />
        </button>
      </div>
    </div>
  );
});

// ============================================================
// PTZ Control Panel (Side Panel)
// ============================================================
const PTZControlPanel = ({ camera, onPTZCommand, onClose, visible }) => {
  if (!visible || !camera) return null;
  
  return (
    <div style={ptzPanelOverlayStyle} onClick={onClose}>
      <div style={ptzPanelStyle} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px', borderBottom: `1px solid ${THEME.borderSlate}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Camera size={20} style={{ color: THEME.tacticalBlue }} />
            <div>
              <div style={{ fontSize: '16px', fontWeight: 700, color: THEME.textPrimary }}>
                {camera.name || `BOP-CAM-${camera.id.toString().padStart(3, '0')}`}
              </div>
              <div style={{ fontSize: '12px', color: THEME.textSecondary }}>
                PTZ Control Panel
              </div>
            </div>
          </div>
          <button onClick={onClose} className="btn-icon" style={{ background: 'rgba(239, 68, 68, 0.15)', borderColor: THEME.criticalRed, color: THEME.criticalRed }}>
            <X size={20} />
          </button>
        </div>
        
        <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '20px', height: 'calc(100% - 60px)', overflowY: 'auto' }}>
          {/* Pan/Tilt Joystick Area */}
          <div>
            <div style={{ fontSize: '11px', color: THEME.textSecondary, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '12px' }}>Pan / Tilt</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px', maxWidth: '280px' }}>
              <button onClick={() => onPTZCommand(camera.id, 'tilt_up')} className="ptz-btn-large"> <ChevronUp size={24} /> </button>
              <button onClick={() => onPTZCommand(camera.id, 'home')} className="ptz-btn-large" style={{ gridColumn: '2' }}> <Target size={24} /> </button>
              <button onClick={() => onPTZCommand(camera.id, 'tilt_down')} className="ptz-btn-large"> <ChevronDown size={24} /> </button>
              <button onClick={() => onPTZCommand(camera.id, 'pan_left')} className="ptz-btn-large"> <ChevronLeft size={24} /> </button>
              <button onClick={() => onPTZCommand(camera.id, 'stop')} className="ptz-btn-large" style={{ gridColumn: '2', background: 'rgba(239, 68, 68, 0.2)', borderColor: THEME.criticalRed }}> <X size={24} /> </button>
              <button onClick={() => onPTZCommand(camera.id, 'pan_right')} className="ptz-btn-large"> <ChevronRight size={24} /> </button>
            </div>
          </div>
          
          {/* Zoom Controls */}
          <div>
            <div style={{ fontSize: '11px', color: THEME.textSecondary, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '12px' }}>Zoom Control</div>
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
              <button onClick={() => onPTZCommand(camera.id, 'zoom_out')} className="ptz-btn-large" style={{ flex: 1 }}>
                <ZoomOut size={24} />
                <div style={{ fontSize: '10px', marginTop: '4px' }}>Zoom Out</div>
              </button>
              <button onClick={() => onPTZCommand(camera.id, 'zoom_in')} className="ptz-btn-large" style={{ flex: 1 }}>
                <ZoomIn size={24} />
                <div style={{ fontSize: '10px', marginTop: '4px' }}>Zoom In</div>
              </button>
            </div>
          </div>
          
          {/* Presets */}
          <div>
            <div style={{ fontSize: '11px', color: THEME.textSecondary, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '12px' }}>Preset Positions</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
              {[1, 2, 3, 4, 5, 6].map(n => (
                <button
                  key={n}
                  onClick={() => onPTZCommand(camera.id, `preset_${n}`)}
                  className="preset-btn"
                >
                  Preset {n}
                </button>
              ))}
            </div>
          </div>
          
          {/* Auto-Slew */}
          <div style={{ padding: '16px', background: 'rgba(59, 130, 246, 0.1)', border: `1px solid ${THEME.tacticalBlue}40`, borderRadius: '10px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '12px', cursor: 'pointer' }}>
              <input
                type="checkbox"
                defaultChecked={false}
                style={{ width: '18px', height: '18px', accentColor: THEME.tacticalBlue }}
              />
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                  <Navigation size={18} style={{ color: THEME.tacticalBlue }} />
                  <span style={{ fontSize: '13px', fontWeight: 600, color: THEME.textPrimary }}>Auto-Slew to Kalman Track</span>
                </div>
                <div style={{ fontSize: '11px', color: THEME.textSecondary }}>
                  Automatically slew PTZ to follow Kalman-predicted target trajectory (5-10s horizon)
                </div>
              </div>
            </label>
          </div>
          
          {/* Camera Info */}
          <div style={{ paddingTop: '16px', borderTop: `1px solid ${THEME.borderSlate}` }}>
            <div style={{ fontSize: '11px', color: THEME.textSecondary, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '10px' }}>Camera Status</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', fontSize: '12px' }}>
              <div><span style={{ color: THEME.textSecondary }}>Health Score</span><br/><span style={{ fontWeight: 600, fontFamily: 'monospace' }}>{camera.health_score}%</span></div>
              <div><span style={{ color: THEME.textSecondary }}>Status</span><br/><span style={{ fontWeight: 600, color: CAMERA_STATUS[camera.status]?.color }}>{CAMERA_STATUS[camera.status]?.label}</span></div>
              <div><span style={{ color: THEME.textSecondary }}>Location</span><br/><span style={{ fontWeight: 600, fontFamily: 'monospace' }}>{camera.latitude?.toFixed(4)}, {camera.longitude?.toFixed(4)}</span></div>
              <div><span style={{ color: THEME.textSecondary }}>Heading</span><br/><span style={{ fontWeight: 600 }}>{camera.heading || '—'}°</span></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// ============================================================
// Camera Grid Component
// ============================================================
export const CameraGrid = forwardRef(function CameraGrid({
  cameras = [],
  className = '',
  style = {},
  height = '100%',
  width = '100%',
  onCameraSelect,
  onPTZCommand,
  selectedCameraId,
  gridLayout = 'auto', // 'auto' | 1 | 2 | 3 | 4
  showPTZ = true,
  compact = false,
  streamUrls = {},
  api,
}, ref) {
  // State
  const [layout, setLayout] = useState(gridLayout === 'auto' ? 'auto' : gridLayout);
  const [selectedCamera, setSelectedCamera] = useState(null);
  const [ptzPanelOpen, setPtzPanelOpen] = useState(false);
  const [fullscreenCamera, setFullscreenCamera] = useState(null);
  const [streamingCount, setStreamingCount] = useState(0);
  
  // Handle camera selection
  const handleCameraClick = useCallback((camera, action) => {
    if (action === 'expand') {
      setFullscreenCamera(camera);
    } else {
      setSelectedCamera(camera);
      onCameraSelect?.(camera);
    }
  }, [onCameraSelect]);
  
  // Handle PTZ commands
  const handlePTZ = useCallback((cameraId, command) => {
    onPTZCommand?.(cameraId, command);
  }, [onPTZCommand]);
  
  // Determine grid columns based on layout
  const columns = useMemo(() => {
    if (layout === 'auto') {
      const count = cameras.length;
      if (count <= 1) return 1;
      if (count <= 4) return 2;
      if (count <= 9) return 3;
      return 4;
    }
    return layout;
  }, [layout, cameras.length]);
  
  // Get stream URL for camera
  const getStreamUrl = useCallback((camera) => {
    return streamUrls[camera.id] || camera.rtsp_url;
  }, [streamUrls]);
  
  // Filter cameras with streams
  const camerasWithStreams = cameras.filter(c => c.rtsp_url || streamUrls[c.id]);
  
  return (
    <div className="camera-grid" style={getContainerStyles()}>
      {/* Header */}
      <div style={headerStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Camera size={20} style={{ color: THEME.tacticalBlue }} />
            <div>
              <div style={{ fontSize: '16px', fontWeight: 700, color: THEME.textPrimary, letterSpacing: '0.5px' }}>
                CAMERA NETWORK
              </div>
              <div style={{ fontSize: '11px', color: THEME.textSecondary, textTransform: 'uppercase' }}>
                {cameras.length} cameras • {cameras.filter(c => c.status === 'online').length} online
              </div>
            </div>
          </div>
          
          {/* Layout Controls */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div style={{ display: 'flex', gap: '4px', background: THEME.mutedSlate, border: `1px solid ${THEME.borderSlate}`, borderRadius: '8px', padding: '4px' }}>
              {[1, 2, 3, 4].map(n => (
                <button
                  key={n}
                  onClick={() => setLayout(n)}
                  disabled={cameras.length < n}
                  style={{
                    width: '32px',
                    height: '32px',
                    borderRadius: '6px',
                    border: 'none',
                    background: layout === n ? THEME.tacticalBlue : 'transparent',
                    color: layout === n ? '#fff' : THEME.textSecondary,
                    cursor: cameras.length < n ? 'not-allowed' : 'pointer',
                    opacity: cameras.length < n ? 0.4 : 1,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    transition: 'all 0.2s',
                  }}
                  title={`${n}x${n} Grid`}
                >
                  <Grid size={16} />
                </button>
              ))}
            </div>
            
            <button
              onClick={() => setLayout(l => l === 'auto' ? 4 : 'auto')}
              className={`btn-icon ${layout === 'auto' ? 'active' : ''}`}
              title={layout === 'auto' ? 'Manual Layout' : 'Auto Layout'}
              style={{ background: layout === 'auto' ? 'rgba(59, 130, 246, 0.2)' : 'transparent', borderColor: layout === 'auto' ? THEME.tacticalBlue : THEME.borderSlate, color: layout === 'auto' ? THEME.tacticalBlue : THEME.textSecondary }}
            >
              <Layout size={16} />
            </button>
            
            <button
              onClick={() => setSelectedCamera(null)}
              className="btn-icon"
              title="Clear Selection"
              style={{ opacity: selectedCamera ? 1 : 0.4 }}
              disabled={!selectedCamera}
            >
              <Minimize size={16} />
            </button>
          </div>
        </div>
        
        {/* Stats Bar */}
        <div style={statsBarStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <StatItem label="Total" value={cameras.length} />
            <StatItem label="Online" value={cameras.filter(c => c.status === 'online').length} color={THEME.successGreen} />
            <StatItem label="Degraded" value={cameras.filter(c => c.status === 'degraded').length} color={THEME.warningAmber} />
            <StatItem label="Offline" value={cameras.filter(c => c.status === 'offline').length} color={THEME.criticalRed} />
            <StatItem label="Streaming" value={streamingCount} color={THEME.tacticalBlue} />
          </div>
        </div>
      </div>
      
      {/* Camera Grid */}
      <div style={gridContainerStyle}>
        {cameras.length === 0 ? (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: THEME.textMuted, padding: '40px' }}>
            <Camera size={64} style={{ marginBottom: '16px', opacity: 0.3 }} />
            <div style={{ fontSize: '16px', fontWeight: 500, marginBottom: '8px' }}>No Cameras Configured</div>
            <div style={{ fontSize: '13px', textAlign: 'center', maxWidth: '300px' }}>
              Add cameras via the Camera Registry API to begin monitoring.
            </div>
          </div>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: `repeat(${columns}, 1fr)`,
              gap: compact ? '8px' : '12px',
              padding: compact ? '8px' : '12px',
              height: 'calc(100% - 120px)',
              overflow: 'auto',
            }}
          >
            {cameras.map((camera, index) => (
              <CameraTile
                key={camera.id}
                camera={camera}
                selected={selectedCamera?.id === camera.id || fullscreenCamera?.id === camera.id}
                onClick={handleCameraClick}
                onPTZCommand={handlePTZ}
                showPTZ={showPTZ && (selectedCamera?.id === camera.id || fullscreenCamera?.id === camera.id)}
                streamUrl={streamUrls[camera.id]}
                compact={compact}
              />
            ))}
          </div>
        )}
      </div>
      
      {/* Fullscreen Modal */}
      {fullscreenCamera && (
        <div style={fullscreenOverlayStyle} onClick={() => setFullscreenCamera(null)}>
          <div style={fullscreenContentStyle} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: `1px solid ${THEME.borderSlate}`, background: THEME.mutedSlate }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <Camera size={20} style={{ color: THEME.tacticalBlue }} />
                <span style={{ fontSize: '16px', fontWeight: 700 }}>{fullscreenCamera.name}</span>
                <span style={{
                  padding: '2px 8px',
                  borderRadius: '4px',
                  fontSize: '10px',
                  fontWeight: 600,
                  background: `rgba(${hexToRgb(CAMERA_STATUS[fullscreenCamera.status]?.color)}, 0.2)`,
                  color: CAMERA_STATUS[fullscreenCamera.status]?.color,
                  textTransform: 'uppercase',
                }}>
                  {CAMERA_STATUS[fullscreenCamera.status]?.label}
                </span>
              </div>
              <button onClick={() => setFullscreenCamera(null)} className="btn-icon" style={{ background: 'rgba(239, 68, 68, 0.15)', borderColor: THEME.criticalRed, color: THEME.criticalRed }}>
                <Minimize size={20} />
              </button>
            </div>
            <div style={{ flex: 1, position: 'relative', background: THEME.darkSlate }}>
              <CameraTile
                camera={fullscreenCamera}
                selected={true}
                onClick={() => {}}
                onPTZCommand={handlePTZ}
                showPTZ={true}
                streamUrl={streamUrls[fullscreenCamera.id]}
                compact={false}
              />
            </div>
          </div>
        </div>
      )}
      
      {/* PTZ Panel */}
      {ptzPanelOpen && selectedCamera && (
        <PTZControlPanel
          camera={selectedCamera}
          onPTZCommand={handlePTZ}
          onClose={() => setPtzPanelOpen(false)}
          visible={true}
        />
      )}
      
      {/* Styles - injected via useEffect to avoid styled-jsx (Next.js only) */}
      {typeof window !== 'undefined' && !document.getElementById('camera-grid-styles') && (
        <style id="camera-grid-styles" dangerouslySetInnerHTML={{ __html: globalStyles }} />
      )}
    </div>
  );
  
  function getContainerStyles() {
    return {
      height,
      width,
      background: THEME.darkSlate,
      border: `1px solid ${THEME.borderSlate}`,
      borderRadius: '12px',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      fontFamily: '"JetBrains Mono", "Fira Code", monospace',
      boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
      ...style,
    };
  }
});

// ============================================================
// Helper Functions
// ============================================================
function hexToRgb(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? `${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}` : '0, 0, 0';
}

const StatItem = ({ label, value, color = THEME.textSecondary }) => (
  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px', padding: '0 12px' }}>
    <span style={{ fontSize: '10px', color: THEME.textMuted, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
      {label}
    </span>
    <span style={{ fontSize: '16px', fontWeight: 700, color, fontFamily: 'monospace' }}>
      {value}
    </span>
  </div>
);

// ============================================================
// Styles
// ============================================================
function getContainerStyles() {
  return {
    height,
    width,
    background: THEME.darkSlate,
    border: `1px solid ${THEME.borderSlate}`,
    borderRadius: '12px',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    fontFamily: '"JetBrains Mono", "Fira Code", monospace',
    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
    ...style,
  };
}

const headerStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '12px 16px',
  borderBottom: `1px solid ${THEME.borderSlate}`,
  background: THEME.mutedSlate,
  flexShrink: 0,
};

const statsBarStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '8px 16px',
  borderBottom: `1px solid ${THEME.borderSlate}`,
  background: THEME.mutedSlate,
  flexShrink: 0,
};

const gridContainerStyle = {
  flex: 1,
  overflow: 'hidden',
  background: THEME.darkSlate,
};

const fullscreenOverlayStyle = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0, 0, 0, 0.95)',
  backdropFilter: 'blur(4px)',
  zIndex: 10000,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '20px',
};

const fullscreenContentStyle = {
  width: '100%',
  maxWidth: '1400px',
  maxHeight: '90vh',
  background: THEME.darkSlate,
  border: `1px solid ${THEME.borderSlate}`,
  borderRadius: '16px',
  boxShadow: '0 24px 64px rgba(0, 0, 0, 0.5)',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  fontFamily: '"JetBrains Mono", "Fira Code", monospace',
};

const ptzPanelOverlayStyle = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0, 0, 0, 0.85)',
  backdropFilter: 'blur(4px)',
  zIndex: 10000,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'flex-end',
};

const ptzPanelStyle = {
  width: '380px',
  maxWidth: '100vw',
  height: '100vh',
  background: THEME.darkSlate,
  borderLeft: `1px solid ${THEME.borderSlate}`,
  boxShadow: '-24px 0 64px rgba(0, 0, 0, 0.5)',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  fontFamily: '"JetBrains Mono", "Fira Code", monospace',
  animation: 'slideRight 0.3s ease-out',
};

const videoContainerStyle = {
  position: 'relative',
  width: '100%',
  aspectRatio: '16/9',
  background: THEME.darkSlate,
  borderRadius: '8px',
  overflow: 'hidden',
};

const videoStyle = {
  width: '100%',
  height: '100%',
  objectFit: 'cover',
  background: THEME.darkSlate,
};

const loadingOverlayStyle = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'rgba(9, 13, 22, 0.95)',
  color: THEME.textSecondary,
  zIndex: 10,
};

const errorOverlayStyle = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'rgba(9, 13, 22, 0.98)',
  color: THEME.textPrimary,
  zIndex: 10,
  padding: '20px',
  textAlign: 'center',
};

const streamIndicatorStyle = {
  position: 'absolute',
  top: '10px',
  left: '10px',
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
  padding: '4px 10px',
  background: 'rgba(9, 13, 22, 0.9)',
  backdropFilter: 'blur(8px)',
  borderRadius: '9999px',
  border: `1px solid ${THEME.borderSlate}`,
  zIndex: 5,
};

const infoOverlayStyle = {
  position: 'absolute',
  bottom: '10px',
  left: '10px',
  right: '10px',
  padding: '10px 12px',
  background: 'rgba(9, 13, 22, 0.9)',
  backdropFilter: 'blur(8px)',
  borderRadius: '8px',
  border: `1px solid ${THEME.borderSlate}`,
  zIndex: 5,
};

const ptzOverlayStyle = {
  position: 'absolute',
  bottom: '10px',
  right: '10px',
  zIndex: 5,
};

const expandButtonStyle = {
  position: 'absolute',
  top: '10px',
  right: '10px',
  zIndex: 5,
  width: '32px',
  height: '32px',
  borderRadius: '8px',
  border: `1px solid ${THEME.borderSlate}`,
  background: 'rgba(9, 13, 22, 0.9)',
  backdropFilter: 'blur(8px)',
  color: THEME.textSecondary,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
  transition: 'all 0.2s',
};

const ptzBtnStyle = {
  padding: '10px',
  borderRadius: '8px',
  border: `1px solid ${THEME.borderSlate}`,
  background: 'rgba(59, 130, 246, 0.1)',
  color: THEME.tacticalBlue,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
  transition: 'all 0.2s',
};

const ptzBtnLargeStyle = {
  ...ptzBtnStyle,
  padding: '16px',
  borderRadius: '10px',
};

const presetBtnStyle = {
  padding: '10px 16px',
  borderRadius: '8px',
  border: `1px solid ${THEME.borderSlate}`,
  background: THEME.mutedSlate,
  color: THEME.textSecondary,
  fontSize: '11px',
  fontWeight: 500,
  cursor: 'pointer',
  transition: 'all 0.2s',
};

// Global Styles
const globalStyles = `
  @keyframes slideRight {
    from { opacity: 0; transform: translateX(100%); }
    to { opacity: 1; transform: translateX(0); }
  }
  
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
  }
  
  .spinning {
    animation: spin 1s linear infinite;
  }
  
  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
  
  .camera-tile {
    position: relative;
    background: ${THEME.darkSlate};
    border: 1px solid ${THEME.borderSlate};
    border-radius: 10px;
    overflow: hidden;
    transition: all 0.2s;
    display: flex;
    flex-direction: column;
  }
  
  .camera-tile:hover {
    border-color: ${THEME.tacticalBlue};
    box-shadow: 0 4px 20px rgba(59, 130, 246, 0.15);
  }
  
  .camera-tile.selected {
    border-color: ${THEME.tacticalBlue};
    box-shadow: 0 0 0 2px ${THEME.tacticalBlue}, 0 8px 32px rgba(59, 130, 246, 0.2);
  }
  
  .camera-tile.error {
    border-color: ${THEME.criticalRed};
  }
  
  .camera-tile-compact {
    display: flex;
    align-items: center;
    padding: 10px 12px;
    background: ${THEME.darkSlate};
    border: 1px solid ${THEME.borderSlate};
    border-radius: 8px;
    transition: all 0.2s;
    cursor: pointer;
  }
  
  .camera-tile-compact:hover {
    background: ${THEME.mutedSlate};
    border-color: ${THEME.tacticalBlue};
  }
  
  .camera-tile-compact.selected {
    border-color: ${THEME.tacticalBlue};
    background: ${THEME.mutedSlate};
  }
  
  .ptz-btn {
    padding: 8px;
    border-radius: 8px;
    border: 1px solid ${THEME.borderSlate};
    background: rgba(59, 130, 246, 0.1);
    color: ${THEME.tacticalBlue};
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: all 0.2s;
  }
  
  .ptz-btn:hover {
    background: ${THEME.tacticalBlue};
    border-color: ${THEME.tacticalBlue};
    color: #fff;
    transform: scale(1.05);
  }
  
  .ptz-btn-large {
    padding: 16px;
    border-radius: 12px;
    border: 1px solid ${THEME.borderSlate};
    background: rgba(59, 130, 246, 0.1);
    color: ${THEME.tacticalBlue};
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
    cursor: pointer;
    transition: all 0.2s;
  }
  
  .ptz-btn-large:hover {
    background: ${THEME.tacticalBlue};
    color: #fff;
    transform: scale(1.05);
  }
  
  .preset-btn {
    padding: 10px 16px;
    border-radius: 8px;
    border: 1px solid ${THEME.borderSlate};
    background: ${THEME.mutedSlate};
    color: ${THEME.textSecondary};
    fontSize: 11px;
    fontWeight: 500;
    cursor: pointer;
    transition: all 0.2s;
  }
  
  .preset-btn:hover {
    background: ${THEME.tacticalBlue};
    border-color: ${THEME.tacticalBlue};
    color: #fff;
  }
  
  .expand-btn {
    width: 32px;
    height: 32px;
    border-radius: 8px;
    border: 1px solid ${THEME.borderSlate};
    background: rgba(9, 13, 22, 0.9);
    backdrop-filter: blur(8px);
    color: ${THEME.textSecondary};
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: all 0.2s;
  }
  
  .expand-btn:hover {
    background: ${THEME.tacticalBlue};
    border-color: ${THEME.tacticalBlue};
    color: #fff;
    transform: scale(1.1);
  }
  
  .btn-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    borderRadius: 6px;
    border: 1px solid ${THEME.borderSlate};
    background: transparent;
    color: ${THEME.textSecondary};
    cursor: pointer;
    transition: all 0.2s;
    flex-shrink: 0;
  }
  
  .btn-icon:hover:not(:disabled) {
    background: ${THEME.tacticalBlue}20;
    border-color: ${THEME.tacticalBlue};
    color: ${THEME.tacticalBlue};
  }
  
  .btn-icon.active {
    background: ${THEME.successGreen}20;
    border-color: ${THEME.successGreen};
    color: ${THEME.successGreen};
  }
  
  .btn-icon:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  
  .btn-primary {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 10px 16px;
    borderRadius: 8px;
    border: none;
    color: #fff;
    fontSize: 12px;
    fontWeight: 600;
    fontFamily: inherit;
    textTransform: uppercase;
    letterSpacing: 0.5px;
    cursor: pointer;
    transition: all 0.2s;
  }
  
  .btn-primary:hover:not(:disabled) {
    filter: brightness(1.1);
    transform: translateY(-1px);
  }
  
  .btn-primary:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
  
  /* Video element styling */
  .camera-tile video {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  
  /* Responsive */
  @media (max-width: 768px) {
    .camera-grid {
      border-radius: 0;
    }
  }
`;

export default CameraGrid;