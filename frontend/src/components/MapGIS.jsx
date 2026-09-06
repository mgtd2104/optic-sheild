/**
 * Optic Shield — MapGIS Component
 * 
 * Tactical Leaflet GIS map for C2 situational awareness.
 * Features:
 * - Real-time camera positions with health status indicators
 * - Geofence polygon/line rendering with intrusion highlighting
 * - Alert markers with pulsating severity halos
 * - Predicted target trajectory vectors (5-10s Kalman projections)
 * - Base layer switching (satellite, terrain, OSM)
 * - Dark tactical theme (Dark Slate #090D16)
 */

import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  Circle,
  Polyline,
  Polygon,
  LayerGroup,
  useMap,
  useMapEvents,
} from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Lucide icons
import {
  Camera,
  AlertTriangle,
  MapPin,
  Navigation,
  Satellite,
  Layers,
  Maximize,
  Minimize,
  RefreshCw,
  Target,
  Zap,
} from 'lucide-react';

// Fix Leaflet default icon issue
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

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
};

// Severity colors
const SEVERITY_COLORS = {
  1: THEME.tacticalBlue,     // INFO
  2: THEME.warningAmber,     // WARNING
  3: THEME.criticalRed,      // CRITICAL
};

// Camera status colors
const CAMERA_STATUS_COLORS = {
  online: THEME.successGreen,
  offline: '#6B7280',
  degraded: THEME.warningAmber,
  maintenance: THEME.tacticalBlue,
  tampered: THEME.criticalRed,
};

// Default map center (India border region)
const DEFAULT_CENTER = [28.6139, 77.2090];
const DEFAULT_ZOOM = 6;

// Base layers reference (moved before MapControls to fix ReferenceError)
const baseLayers = {
  osm: {
    name: 'OpenStreetMap',
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '© OpenStreetMap contributors',
  },
  satellite: {
    name: 'Satellite',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: '© Esri',
  },
  terrain: {
    name: 'Terrain',
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    attribution: '© OpenTopoMap',
  },
  dark: {
    name: 'Dark Matter',
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    attribution: '© CARTO',
  },
};

// ============================================================
// Custom Leaflet Components
// ============================================================

/**
 * Pulsating circle marker for alerts
 */
const PulsatingAlert = ({ position, severity, alert, onClick }) => {
  const map = useMap();
  const [radius, setRadius] = useState(15);
  const [opacity, setOpacity] = useState(0.6);

  useEffect(() => {
    const color = SEVERITY_COLORS[severity] || THEME.criticalRed;
    
    // Pulsation animation
    let growing = true;
    const interval = setInterval(() => {
      if (growing) {
        setRadius(r => r + 1);
        setOpacity(o => Math.max(0.2, o - 0.05));
        if (radius >= 30) growing = false;
      } else {
        setRadius(r => r - 1);
        setOpacity(o => Math.min(0.6, o + 0.05));
        if (radius <= 15) growing = true;
      }
    }, 100);

    return () => clearInterval(interval);
  }, [severity]);

  const color = SEVERITY_COLORS[severity] || THEME.criticalRed;

  return (
    <>
      {/* Outer pulsating halo */}
      <Circle
        center={position}
        radius={radius * 10} // Convert to meters (approximate)
        pathOptions={{
          color,
          fillColor: color,
          fillOpacity: opacity,
          weight: 0,
          className: 'alert-pulse-halo',
        }}
      />
      {/* Inner solid marker */}
      <Circle
        center={position}
        radius={80}
        pathOptions={{
          color,
          fillColor: color,
          fillOpacity: 0.9,
          weight: 2,
          className: 'alert-marker-core',
        }}
      />
      {/* Clickable area */}
      <Circle
        center={position}
        radius={150}
        pathOptions={{
          color: 'transparent',
          fillColor: 'transparent',
          fillOpacity: 0,
          weight: 0,
          interactive: true,
          className: 'alert-click-area',
        }}
        onClick={() => onClick?.(alert)}
      />
    </>
  );
};

/**
 * Camera marker with status indicator
 */
const CameraMarker = ({ 
  position, 
  camera, 
  onClick, 
  isSelected,
  showLabel = true 
}) => {
  const [showPopup, setShowPopup] = useState(false);
  const statusColor = CAMERA_STATUS_COLORS[camera.status] || THEME.textSecondary;

  const statusIcon = useMemo(() => {
    const icons = {
      online: '●',
      offline: '○',
      degraded: '◑',
      maintenance: '◐',
      tampered: '⚠',
    };
    return icons[camera.status] || '?';
  }, [camera.status]);

  return (
    <>
      <Marker
        position={position}
        icon={L.divIcon({
          className: `camera-marker ${isSelected ? 'selected' : ''}`,
          html: `
            <div class="camera-marker-inner" style="--status-color: ${statusColor};">
              <span class="camera-icon">📷</span>
              <span class="status-dot" style="background: ${statusColor};"></span>
            </div>
          `,
          iconSize: [40, 40],
          iconAnchor: [20, 20],
        })}
        onClick={(e) => {
          e.originalEvent.stopPropagation();
          onClick?.(camera, e);
          setShowPopup(!showPopup);
        }}
      />
      
      {showLabel && (
        <Marker
          position={[position[0] + 0.002, position[1]]}
          icon={L.divIcon({
            className: 'camera-label',
            html: `
              <div class="camera-label-text">
                <span class="camera-name">${camera.name}</span>
                <span class="camera-status ${camera.status}">${statusIcon} ${camera.status}</span>
              </div>
            `,
            iconSize: [120, 20],
            iconAnchor: [0, 10],
          })}
        />
      )}

      {showPopup && (
        <Popup
          position={position}
          onClose={() => setShowPopup(false)}
          className="camera-popup"
        >
          <div className="popup-content" style={{ minWidth: 250 }}>
            <div className="popup-header" style={{ 
              background: statusColor, 
              color: '#fff',
              borderRadius: '8px 8px 0 0',
              padding: '8px 12px',
              margin: '-8px -8px 8px -8px',
            }}>
              <strong>{camera.name}</strong>
              <span className="status-badge">{camera.status.toUpperCase()}</span>
            </div>
            <div className="popup-body" style={{ padding: '8px', fontSize: '12px', lineHeight: '1.6' }}>
              <div><strong>ID:</strong> {camera.id}</div>
              <div><strong>Health:</strong> {camera.health_score}%</div>
              <div><strong>Location:</strong> {camera.latitude?.toFixed(4)}, {camera.longitude?.toFixed(4)}</div>
              <div><strong>Heading:</strong> {camera.heading || 'N/A'}°</div>
              <div><strong>Last Seen:</strong> {camera.last_heartbeat ? new Date(camera.last_heartbeat).toLocaleTimeString() : 'Never'}</div>
            </div>
          </div>
        </Popup>
      )}
    </>
  );
};

/**
 * Geofence polygon with intrusion highlighting
 */
const GeofencePolygon = ({ 
  coordinates, 
  geofence, 
  intrusions = [],
  onClick 
}) => {
  const isIntruded = intrusions.some(i => i.geofence_id === geofence.id);
  const hasWarning = intrusions.some(i => i.geofence_id === geofence.id && i.severity === 2);
  const hasCritical = intrusions.some(i => i.geofence_id === geofence.id && i.severity === 3);

  const fillColor = isIntruded 
    ? (hasCritical ? THEME.criticalRed : hasWarning ? THEME.warningAmber : THEME.tacticalBlue)
    : 'transparent';
  
  const borderColor = isIntruded 
    ? (hasCritical ? THEME.criticalRed : hasWarning ? THEME.warningAmber : THEME.tacticalBlue)
    : (geofence.type === 'line' ? THEME.tacticalBlue : THEME.successGreen);

  return (
    <Polygon
      positions={coordinates.map(c => [c[1], c[0]])} // [lat, lng]
      pathOptions={{
        color: borderColor,
        fillColor,
        fillOpacity: isIntruded ? 0.25 : 0.05,
        weight: geofence.type === 'line' ? 3 : 2,
        dashArray: geofence.type === 'line' ? '10, 5' : undefined,
        className: `geofence-polygon ${isIntruded ? 'intruded' : ''}`,
      }}
      onClick={(e) => onClick?.(geofence, e)}
    >
      {isIntruded && (
        <Popup position={coordinates[0].map((_, i) => coordinates.reduce((acc, c) => acc + c[i], 0) / coordinates.length).reverse()}>
          <div className="popup-content">
            <strong>{geofence.name || geofence.id}</strong>
            <div>Type: {geofence.type}</div>
            <div style={{ color: hasCritical ? THEME.criticalRed : THEME.warningAmber }}>
              ⚠ {intrusions.filter(i => i.geofence_id === geofence.id).length} intrusion(s)
            </div>
          </div>
        </Popup>
      )}
    </Polygon>
  );
};

/**
 * Trajectory vector line (Kalman prediction)
 */
const TrajectoryVector = ({ 
  trajectory, 
  color = THEME.tacticalBlue,
  dashArray = '8, 4',
  showArrow = true,
  onClick 
}) => {
  if (!trajectory || trajectory.length < 2) return null;

  // Convert to [lat, lng] format
  const positions = trajectory.map(p => [p[1], p[0]]);

  return (
    <Polyline
      positions={positions}
      pathOptions={{
        color,
        weight: 2,
        dashArray,
        opacity: 0.8,
        className: 'trajectory-vector',
      }}
      onClick={(e) => onClick?.(trajectory, e)}
    />
  );
};

/**
 * Arrow head for trajectory direction
 */
const TrajectoryArrow = ({ from, to, color = THEME.tacticalBlue, size = 10 }) => {
  // Calculate angle
  const angle = Math.atan2(to[0] - from[0], to[1] - from[1]) * 180 / Math.PI;
  
  return (
    <Marker
      position={[to[1], to[0]]}
      icon={L.divIcon({
        className: 'trajectory-arrow',
        html: `
          <div class="arrow-head" style="
            width: 0; height: 0;
            border-left: ${size}px solid transparent;
            border-right: ${size}px solid transparent;
            border-bottom: ${size * 1.5}px solid ${color};
            transform: rotate(${angle}deg);
          "></div>
        `,
        iconSize: [size * 2, size * 2],
        iconAnchor: [size, size * 1.5],
      })}
    />
  );
};

// ============================================================
// Map Controls
// ============================================================

const MapControls = ({ 
  cameras, 
  geofences, 
  alerts, 
  trajectories,
  onCameraClick,
  onGeofenceClick,
  onAlertClick,
  selectedCamera,
  setSelectedCamera,
  mapRef,
  className = '',
  baseLayer,
  setBaseLayer,
  showCameras,
  setShowCameras,
  showGeofences,
  setShowGeofences,
  showAlerts,
  setShowAlerts,
  showTrajectories,
  setShowTrajectories,
  showLabels,
  setShowLabels,
}) => {
  const [fullscreen, setFullscreen] = useState(false);

  return (
    <div className={`map-controls ${className} ${fullscreen ? 'fullscreen' : ''}`}>
      {/* Base Layer Selector */}
      <div className="control-group">
        <label className="control-label">Base Layer</label>
        <select
          value={baseLayer}
          onChange={(e) => setBaseLayer(e.target.value)}
          className="control-select"
        >
          {Object.entries(baseLayers).map(([key, layer]) => (
            <option key={key} value={key}>{layer.name}</option>
          ))}
        </select>
      </div>

      {/* Layer Toggles */}
      <div className="control-group">
        <label className="control-label">Overlays</label>
        <div className="toggle-grid">
          <label className="toggle-item">
            <input
              type="checkbox"
              checked={showCameras}
              onChange={(e) => setShowCameras(e.target.checked)}
            />
            <span className="toggle-icon">
              <Camera size={14} />
            </span>
            <span>Cameras ({cameras?.length || 0})</span>
          </label>

          <label className="toggle-item">
            <input
              type="checkbox"
              checked={showGeofences}
              onChange={(e) => setShowGeofences(e.target.checked)}
            />
            <span className="toggle-icon">
              <MapPin size={14} />
            </span>
            <span>Geofences ({geofences?.length || 0})</span>
          </label>

          <label className="toggle-item">
            <input
              type="checkbox"
              checked={showAlerts}
              onChange={(e) => setShowAlerts(e.target.checked)}
            />
            <span className="toggle-icon">
              <AlertTriangle size={14} />
            </span>
            <span>Alerts ({alerts?.length || 0})</span>
          </label>

          <label className="toggle-item">
            <input
              type="checkbox"
              checked={showTrajectories}
              onChange={(e) => setShowTrajectories(e.target.checked)}
            />
            <span className="toggle-icon">
              <Navigation size={14} />
            </span>
            <span>Trajectories ({trajectories?.length || 0})</span>
          </label>

          <label className="toggle-item">
            <input
              type="checkbox"
              checked={showLabels}
              onChange={(e) => setShowLabels(e.target.checked)}
            />
            <span className="toggle-icon">
              <Layers size={14} />
            </span>
            <span>Labels</span>
          </label>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="control-group">
        <div className="action-buttons">
          <button
            className="action-btn"
            onClick={() => {
              if (mapRef.current?.leafletElement) {
                mapRef.current.leafletElement.invalidateSize();
              }
            }}
            title="Refresh Map"
          >
            <RefreshCw size={16} />
          </button>
          <button
            className="action-btn"
            onClick={() => setFullscreen(!fullscreen)}
            title={fullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
          >
            {fullscreen ? <Minimize size={16} /> : <Maximize size={16} />}
          </button>
          <button
            className="action-btn"
            onClick={() => {
              if (mapRef.current?.leafletElement && cameras?.length) {
                const group = L.featureGroup(cameras.map(c => 
                  L.marker([c.latitude, c.longitude])
                ));
                mapRef.current.leafletElement.fitBounds(group.getBounds().pad(0.1));
              }
            }}
            title="Fit All Cameras"
          >
            <Target size={16} />
          </button>
        </div>
      </div>

      {/* Legend */}
      <div className="control-group legend">
        <div className="legend-item">
          <span className="legend-color" style={{ background: THEME.successGreen }}></span>
          <span>Camera Online</span>
        </div>
        <div className="legend-item">
          <span className="legend-color" style={{ background: THEME.warningAmber }}></span>
          <span>Camera Degraded</span>
        </div>
        <div className="legend-item">
          <span className="legend-color" style={{ background: THEME.criticalRed }}></span>
          <span>Camera Tampered</span>
        </div>
        <div className="legend-item">
          <span className="legend-color" style={{ background: THEME.tacticalBlue, border: '2px dashed' }}></span>
          <span>Geofence (Normal)</span>
        </div>
        <div className="legend-item">
          <span className="legend-color" style={{ background: THEME.warningAmber, border: '2px solid' }}></span>
          <span>Geofence (Warning)</span>
        </div>
        <div className="legend-item">
          <span className="legend-color" style={{ background: THEME.criticalRed, border: '2px solid' }}></span>
          <span>Geofence (Critical)</span>
        </div>
      </div>
    </div>
  );
};

// ============================================================
// Main MapGIS Component
// ============================================================

const MapGIS = ({
  cameras = [],
  geofences = [],
  alerts = [],
  trajectories = [],
  center = DEFAULT_CENTER,
  zoom = DEFAULT_ZOOM,
  onCameraClick,
  onGeofenceClick,
  onAlertClick,
  selectedCameraId,
  className = '',
  style = {},
  height = '100%',
  width = '100%',
}) => {
  const mapRef = useRef(null);
  const [selectedCamera, setSelectedCamera] = useState(null);
  const [baseLayer, setBaseLayer] = useState('osm');
  const [showCameras, setShowCameras] = useState(true);
  const [showGeofences, setShowGeofences] = useState(true);
  const [showAlerts, setShowAlerts] = useState(true);
  const [showTrajectories, setShowTrajectories] = useState(true);
  const [showLabels, setShowLabels] = useState(true);

  // Handle camera click
  const handleCameraClick = useCallback((camera) => {
    setSelectedCamera(camera);
    onCameraClick?.(camera);
  }, [onCameraClick]);

  // Handle geofence click
  const handleGeofenceClick = useCallback((geofence) => {
    onGeofenceClick?.(geofence);
  }, [onGeofenceClick]);

  // Handle alert click
  const handleAlertClick = useCallback((alert) => {
    onAlertClick?.(alert);
  }, [onAlertClick]);

  return (
    <div 
      className={`mapgis-container ${className}`}
      style={{
        height,
        width,
        background: THEME.darkSlate,
        borderRadius: '8px',
        overflow: 'hidden',
        position: 'relative',
        ...style,
      }}
    >
      <MapContainer
        ref={mapRef}
        center={center}
        zoom={zoom}
        zoomControl={false}
        scrollWheelZoom={true}
        doubleClickZoom={true}
        boxZoom={true}
        keyboard={true}
        style={{ height: '100%', width: '100%' }}
        className="mapgis-map"
      >
        {/* Base Layer */}
        <TileLayer
          url={baseLayers[baseLayer]?.url || baseLayers.osm.url}
          attribution={baseLayers[baseLayer]?.attribution || baseLayers.osm.attribution}
          maxZoom={19}
          minZoom={3}
        />

        {/* Cameras Layer */}
        {showCameras && cameras.map((camera) => (
          camera.latitude && camera.longitude && (
            <CameraMarker
              key={camera.id}
              position={[camera.latitude, camera.longitude]}
              camera={camera}
              onClick={handleCameraClick}
              isSelected={selectedCameraId === camera.id}
              showLabel={showLabels}
            />
          )
        ))}

        {/* Geofences Layer */}
        {showGeofences && geofences.map((geofence) => (
          geofence.coordinates && geofence.coordinates.length >= 3 && (
            <GeofencePolygon
              key={geofence.id}
              coordinates={geofence.coordinates}
              geofence={geofence}
              intrusions={alerts.filter(a => a.alert_type === 'GEOFENCE_INTRUSION')}
              onClick={handleGeofenceClick}
            />
          )
        ))}

        {/* Alerts Layer */}
        {showAlerts && alerts.map((alert) => (
          alert.intersection_point && (
            <PulsatingAlert
              key={alert.id}
              position={[alert.intersection_point[1], alert.intersection_point[0]]}
              severity={alert.severity}
              alert={alert}
              onClick={handleAlertClick}
            />
          )
        ))}

        {/* Trajectories Layer */}
        {showTrajectories && trajectories.map((traj, idx) => (
          traj.predicted_trajectory && traj.predicted_trajectory.length >= 2 && (
            <TrajectoryVector
              key={traj.id || idx}
              trajectory={traj.predicted_trajectory}
              color={SEVERITY_COLORS[traj.severity] || THEME.tacticalBlue}
              dashArray='8, 4'
              showArrow={true}
            />
          )
        ))}

        {/* Map Controls */}
        <MapControls
          cameras={cameras}
          geofences={geofences}
          alerts={alerts}
          trajectories={trajectories}
          onCameraClick={handleCameraClick}
          onGeofenceClick={handleGeofenceClick}
          onAlertClick={handleAlertClick}
          selectedCamera={selectedCamera}
          setSelectedCamera={setSelectedCamera}
          mapRef={mapRef}
          baseLayer={baseLayer}
          setBaseLayer={setBaseLayer}
          showCameras={showCameras}
          setShowCameras={setShowCameras}
          showGeofences={showGeofences}
          setShowGeofences={setShowGeofences}
          showAlerts={showAlerts}
          setShowAlerts={setShowAlerts}
          showTrajectories={showTrajectories}
          setShowTrajectories={setShowTrajectories}
          showLabels={showLabels}
          setShowLabels={setShowLabels}
        />
      </MapContainer>

      {/* Sidebar for selected camera */}
      {selectedCamera && (
        <div className="camera-sidebar">
          <div className="sidebar-header">
            <h3>{selectedCamera.name}</h3>
            <button 
              className="sidebar-close"
              onClick={() => setSelectedCamera(null)}
            >
              ×
            </button>
          </div>
          <div className="sidebar-content">
            <div className="info-row">
              <span className="info-label">Status</span>
              <span className="info-value" style={{ color: CAMERA_STATUS_COLORS[selectedCamera.status] }}>
                {selectedCamera.status.toUpperCase()}
              </span>
            </div>
            <div className="info-row">
              <span className="info-label">Health Score</span>
              <span className="info-value">{selectedCamera.health_score}%</span>
            </div>
            <div className="info-row">
              <span className="info-label">Location</span>
              <span className="info-value">
                {selectedCamera.latitude?.toFixed(4)}, {selectedCamera.longitude?.toFixed(4)}
              </span>
            </div>
            <div className="info-row">
              <span className="info-label">Heading</span>
              <span className="info-value">{selectedCamera.heading || 'N/A'}°</span>
            </div>
            <div className="info-row">
              <span className="info-label">Last Heartbeat</span>
              <span className="info-value">
                {selectedCamera.last_heartbeat ? new Date(selectedCamera.last_heartbeat).toLocaleString() : 'Never'}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default React.memo(MapGIS);

// ============================================================
// CSS Styles (injected via style tag for self-contained component)
// ============================================================
const styleSheet = `
/* MapGIS Container */
.mapgis-container {
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  color: ${THEME.textPrimary};
  border: 1px solid ${THEME.borderSlate};
}

/* Ensure baseLayers is available for TileLayer */

.mapgis-map {
  z-index: 1;
}

/* Map Controls */
.map-controls {
  position: absolute;
  top: 12px;
  left: 12px;
  z-index: 1000;
  background: rgba(9, 13, 22, 0.95);
  backdrop-filter: blur(8px);
  border: 1px solid ${THEME.borderSlate};
  border-radius: 8px;
  padding: 12px;
  min-width: 220px;
  max-width: 280px;
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.4);
}

.map-controls.fullscreen {
  position: fixed;
  top: 20px;
  left: 20px;
}

.control-group {
  margin-bottom: 12px;
  padding-bottom: 12px;
  border-bottom: 1px solid ${THEME.borderSlate};
}

.control-group:last-child {
  border-bottom: none;
  margin-bottom: 0;
  padding-bottom: 0;
}

.control-label {
  display: block;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: ${THEME.textSecondary};
  margin-bottom: 6px;
}

.control-select {
  width: 100%;
  background: ${THEME.mutedSlate};
  border: 1px solid ${THEME.borderSlate};
  border-radius: 4px;
  color: ${THEME.textPrimary};
  padding: 6px 8px;
  font-size: 12px;
  font-family: inherit;
}

.control-select:focus {
  outline: none;
  border-color: ${THEME.tacticalBlue};
}

.toggle-grid {
  display: grid;
  gap: 6px;
}

.toggle-item {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  font-size: 12px;
  color: ${THEME.textPrimary};
}

.toggle-item input[type="checkbox"] {
  width: 14px;
  height: 14px;
  accent-color: ${THEME.tacticalBlue};
  cursor: pointer;
}

.toggle-icon {
  display: flex;
  color: ${THEME.tacticalBlue};
}

.action-buttons {
  display: flex;
  gap: 6px;
}

.action-btn {
  flex: 1;
  background: ${THEME.mutedSlate};
  border: 1px solid ${THEME.borderSlate};
  border-radius: 4px;
  color: ${THEME.textPrimary};
  padding: 8px;
  cursor: pointer;
  transition: all 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
}

.action-btn:hover {
  background: ${THEME.tacticalBlue};
  border-color: ${THEME.tacticalBlue};
}

/* Legend */
.legend {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  color: ${THEME.textSecondary};
}

.legend-color {
  width: 16px;
  height: 16px;
  border-radius: 3px;
  border: 1px solid ${THEME.borderSlate};
}

/* Camera Markers */
.camera-marker {
  transition: transform 0.2s;
}

.camera-marker.selected .camera-marker-inner {
  transform: scale(1.2);
  box-shadow: 0 0 0 3px ${THEME.tacticalBlue};
}

.camera-marker-inner {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  background: rgba(9, 13, 22, 0.95);
  border: 2px solid var(--status-color);
  border-radius: 50%;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  transition: all 0.2s;
}

.camera-icon {
  font-size: 16px;
  line-height: 1;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  margin-top: 2px;
  box-shadow: 0 0 6px currentColor;
}

.camera-label {
  pointer-events: none;
}

.camera-label-text {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  background: rgba(9, 13, 22, 0.9);
  padding: 2px 6px;
  border-radius: 4px;
  border: 1px solid ${THEME.borderSlate};
  font-size: 10px;
  white-space: nowrap;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
}

.camera-name {
  font-weight: 600;
  color: ${THEME.textPrimary};
}

.camera-status {
  font-size: 9px;
  opacity: 0.8;
}

.camera-status.online { color: ${THEME.successGreen}; }
.camera-status.degraded { color: ${THEME.warningAmber}; }
.camera-status.tampered { color: ${THEME.criticalRed}; }
.camera-status.offline { color: #6B7280; }
.camera-status.maintenance { color: ${THEME.tacticalBlue}; }

/* Camera Popup */
.camera-popup .leaflet-popup-content-wrapper {
  background: ${THEME.mutedSlate};
  border: 1px solid ${THEME.borderSlate};
  border-radius: 8px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
}

.camera-popup .leaflet-popup-content {
  margin: 0;
  color: ${THEME.textPrimary};
}

.camera-popup .leaflet-popup-tip {
  background: ${THEME.mutedSlate};
  border: 1px solid ${THEME.borderSlate};
}

.popup-content {
  font-size: 12px;
}

.popup-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.status-badge {
  background: rgba(255, 255, 255, 0.2);
  padding: 2px 6px;
  border-radius: 12px;
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
}

.popup-body div {
  margin: 4px 0;
}

/* Camera Sidebar */
.camera-sidebar {
  position: absolute;
  top: 12px;
  right: 12px;
  bottom: 12px;
  width: 280px;
  z-index: 100;
  background: rgba(9, 13, 22, 0.98);
  backdrop-filter: blur(8px);
  border: 1px solid ${THEME.borderSlate};
  border-radius: 8px;
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.4);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.sidebar-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid ${THEME.borderSlate};
  background: ${THEME.mutedSlate};
}

.sidebar-header h3 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: ${THEME.textPrimary};
}

.sidebar-close {
  background: none;
  border: none;
  color: ${THEME.textSecondary};
  font-size: 20px;
  cursor: pointer;
  padding: 0;
  line-height: 1;
  transition: color 0.2s;
}

.sidebar-close:hover {
  color: ${THEME.criticalRed};
}

.sidebar-content {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
}

.info-row {
  display: flex;
  justify-content: space-between;
  padding: 8px 0;
  border-bottom: 1px solid ${THEME.borderSlate};
}

.info-row:last-child {
  border-bottom: none;
}

.info-label {
  font-size: 12px;
  color: ${THEME.textSecondary};
}

.info-value {
  font-size: 12px;
  font-weight: 500;
  color: ${THEME.textPrimary};
  font-family: 'JetBrains Mono', monospace;
}

/* Alert Pulse Animation */
@keyframes pulse {
  0% { transform: scale(1); opacity: 0.6; }
  50% { transform: scale(1.5); opacity: 0.2; }
  100% { transform: scale(1); opacity: 0.6; }
}

.alert-pulse-halo {
  animation: pulse 2s ease-in-out infinite;
}

.alert-marker-core {
  transition: all 0.3s;
}

.alert-click-area:hover {
  cursor: pointer;
}

/* Geofence Polygons */
.geofence-polygon {
  transition: all 0.3s;
}

.geofence-polygon.intruded {
  filter: drop-shadow(0 0 8px currentColor);
}

.geofence-polygon:hover {
  fill-opacity: 0.4 !important;
  weight: 3;
}

/* Trajectory Vectors */
.trajectory-vector {
  transition: opacity 0.3s;
}

.trajectory-vector:hover {
  opacity: 1 !important;
  weight: 3;
}

.trajectory-arrow {
  pointer-events: none;
}

/* Leaflet Customizations */
.leaflet-container {
  background: ${THEME.darkSlate} !important;
}

.leaflet-control-zoom {
  border: none !important;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3) !important;
}

.leaflet-control-zoom a {
  background: ${THEME.mutedSlate} !important;
  color: ${THEME.textPrimary} !important;
  border: 1px solid ${THEME.borderSlate} !important;
  width: 36px !important;
  height: 36px !important;
  line-height: 34px !important;
  font-size: 16px !important;
  transition: all 0.2s !important;
}

.leaflet-control-zoom a:hover {
  background: ${THEME.tacticalBlue} !important;
  border-color: ${THEME.tacticalBlue} !important;
  color: #fff !important;
}

.leaflet-control-attribution {
  background: rgba(9, 13, 22, 0.9) !important;
  color: ${THEME.textSecondary} !important;
  border-radius: 4px 0 0 0 !important;
}

.leaflet-popup-content-wrapper {
  border-radius: 8px !important;
}

/* Responsive */
@media (max-width: 768px) {
  .map-controls {
    left: 8px;
    right: 8px;
    top: 8px;
    min-width: auto;
    max-width: none;
  }
  
  .camera-sidebar {
    position: fixed;
    top: auto;
    right: 0;
    left: 0;
    bottom: 0;
    width: 100%;
    max-height: 50vh;
    border-radius: 16px 16px 0 0;
  }
}
`;

// Inject styles
if (typeof document !== 'undefined') {
  const styleId = 'mapgis-styles';
  if (!document.getElementById(styleId)) {
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = styleSheet;
    document.head.appendChild(style);
  }
}