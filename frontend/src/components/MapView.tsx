import { useEffect, useRef, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, CircleMarker, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { LiveAlert } from '../types/detection';
import L from 'leaflet';

// Fix Leaflet default marker icons
const DefaultIcon = L.icon({
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

L.Marker.prototype.options.icon = DefaultIcon;

interface MapViewProps {
  alerts: LiveAlert[];
  selectedAlertId: string | null;
  onAlertClick: (alert: LiveAlert) => void;
  center?: [number, number];
  zoom?: number;
}

const DEFAULT_CENTER: [number, number] = [28.9845, 77.7064];
const DEFAULT_ZOOM = 7;

const SEVERITY_COLORS: Record<string, string> = {
  CRITICAL: '#ef4444',
  HIGH: '#f97316',
  MEDIUM: '#eab308',
};

const ALERT_TYPE_ICONS: Record<string, string> = {
  INTRUSION: '🚨',
  ANPR: '🚗',
  FRS_WATCHLIST: '👤',
  TAMPER: '🔧',
};

function AlertMarker({ alert, isSelected, onClick }: { alert: LiveAlert; isSelected: boolean; onClick: () => void }) {
  const color = SEVERITY_COLORS[alert.severity] || '#6b7280';
  const icon = ALERT_TYPE_ICONS[alert.alertType] || '📍';

  return (
    <Marker position={[alert.location.lat, alert.location.lng]} onClick={onClick}>
      <div
        className={`flex items-center justify-center w-8 h-8 rounded-full border-2 transition-all duration-200 ${
          isSelected ? 'ring-2 ring-offset-2 ring-offset-[hsl(var(--background))] scale-110' : ''
        }`}
        style={{
          backgroundColor: color + '20',
          borderColor: color,
          boxShadow: isSelected ? `0 0 0 3px ${color}40, 0 4px 12px ${color}40` : '0 2px 8px rgba(0,0,0,0.3)',
        }}
        title={`${alert.alertType} - ${alert.severity}`}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onClick(); }}
        aria-label={`${alert.alertType} alert at ${alert.location.name}`}
      >
        <span style={{ fontSize: '10px', lineHeight: 1 }}>{icon}</span>
      </div>
      <Popup offset={[0, -20]}>
        <div className="p-2 min-w-[200px]">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-lg">{icon}</span>
            <span className="font-bold text-[hsl(var(--foreground))]">{alert.alertType}</span>
            <span className={`px-1.5 py-0.5 text-xs font-medium rounded text-white`} style={{ backgroundColor: color }}>
              {alert.severity}
            </span>
          </div>
          <div className="text-xs text-[hsl(var(--muted-foreground))] space-y-0.5">
            <div>📷 {alert.cameraID}</div>
            <div>📍 {alert.location.name}</div>
            <div>⏰ {new Date(alert.timestamp).toLocaleTimeString()}</div>
            <div>🎯 {Math.round(alert.confidence * 100)}% confidence</div>
          </div>
        </div>
      </Popup>
    </Marker>
  );
}

function MapFollower({ alert }: { alert: LiveAlert | null }) {
  const map = useMapEvents({
    moveend: () => {},
  });
  
  useEffect(() => {
    if (alert) {
      map.flyTo([alert.location.lat, alert.location.lng], 13, { duration: 1.5 });
    }
  }, [alert, map]);
  
  return null;
}

export default function MapView({ 
  alerts, 
  selectedAlertId, 
  onAlertClick, 
  center = DEFAULT_CENTER, 
  zoom = DEFAULT_ZOOM 
}: MapViewProps) {
  const [mapReady, setMapReady] = useState(false);
  const selectedAlert = alerts.find(a => a.id === selectedAlertId) || null;

  return (
    <div className="h-full w-full rounded-lg overflow-hidden border border-[hsl(var(--border))] bg-[hsl(var(--muted))]">
      <MapContainer
        center={center}
        zoom={zoom}
        zoomControl={false}
        scrollWheelZoom={true}
        whenReady={setMapReady}
        className="h-full w-full"
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          maxZoom={19}
        />
        <TileLayer
          url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
          attribution="Tiles &copy; Esri"
          maxZoom={19}
          opacity={0.3}
        />
        
        {alerts.map(alert => (
          <AlertMarker
            key={alert.id}
            alert={alert}
            isSelected={alert.id === selectedAlertId}
            onClick={() => onAlertClick(alert)}
          />
        ))}
        
        <MapFollower alert={selectedAlert} />
      </MapContainer>
      
      {/* Map Controls Overlay */}
      <div className="absolute top-3 right-3 z-10 flex flex-col gap-1">
        <button
          onClick={() => {
            const mapEl = document.querySelector('.leaflet-container');
            if (mapEl) {
              (mapEl as any)._leaflet_map.fitBounds(
                alerts.map(a => [a.location.lat, a.location.lng]),
                { padding: [50, 50], maxZoom: 12 }
              );
            }
          }}
          className="bg-[hsl(var(--card))] border border-[hsl(var(--border))] p-2 rounded-lg hover:bg-[hsl(var(--muted))] transition-colors shadow-lg"
          aria-label="Fit all alerts"
          title="Fit All Alerts"
        >
          <svg className="w-5 h-5 text-[hsl(var(--foreground))]" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
          </svg>
        </button>
        <button
          onClick={() => {
            const mapEl = document.querySelector('.leaflet-container');
            if (mapEl) {
              (mapEl as any)._leaflet_map.setView(DEFAULT_CENTER, DEFAULT_ZOOM, { duration: 1.5 });
            }
          }}
          className="bg-[hsl(var(--card))] border border-[hsl(var(--border))] p-2 rounded-lg hover:bg-[hsl(var(--muted))] transition-colors shadow-lg"
          aria-label="Reset view to default"
          title="Reset View"
        >
          <svg className="w-5 h-5 text-[hsl(var(--foreground))]" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8H15a2.5 2.5 0 002.5-2.5V3.935M8 20.065V18.5a2.5 2.5 0 012.5-2.5H15a2.5 2.5 0 012.5 2.5V20.065" />
          </svg>
        </button>
      </div>

      {/* Alert Count Badge */}
      <div className="absolute bottom-3 left-3 z-10 bg-[hsl(var(--card))] border border-[hsl(var(--border))] px-3 py-1.5 rounded-lg shadow-lg">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" aria-hidden="true" />
          <span className="text-sm font-medium text-[hsl(var(--foreground))]">
            {alerts.length} Active {alerts.length === 1 ? 'Alert' : 'Alerts'}
          </span>
        </div>
      </div>
    </div>
  );
}