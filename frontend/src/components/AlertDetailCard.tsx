import { LiveAlert } from '../types/detection';

const SEVERITY_CONFIG: Record<string, { color: string; bg: string }> = {
  CRITICAL: { color: '#ef4444', bg: '#ef444420' },
  HIGH: { color: '#f97316', bg: '#f9731620' },
  MEDIUM: { color: '#eab308', bg: '#eab30820' },
};

const TYPE_CONFIG: Record<string, { icon: string; label: string }> = {
  INTRUSION: { icon: '🚨', label: 'INTRUSION' },
  ANPR: { icon: '🚗', label: 'ANPR' },
  FRS_WATCHLIST: { icon: '👤', label: 'FRS WATCHLIST' },
  TAMPER: { icon: '🔧', label: 'TAMPER' },
};

interface AlertDetailCardProps {
  alert: LiveAlert;
  onClose: () => void;
  showExplainability?: boolean;
  showTrackInfo?: boolean;
}

export default function AlertDetailCard({ 
  alert, 
  onClose, 
  showExplainability = false,
  showTrackInfo = true 
}: AlertDetailCardProps) {
  const severityConfig = SEVERITY_CONFIG[alert.severity] || SEVERITY_CONFIG.HIGH;
  const typeConfig = TYPE_CONFIG[alert.alertType] || TYPE_CONFIG.INTRUSION;

  // Sanitize location name for safe rendering
  const sanitize = (str: string) => str
    .replace(/&/g, '&')
    .replace(/</g, '<')
    .replace(/>/g, '>')
    .replace(/"/g, '"')
    .replace(/'/g, '&#039;');

  return (
    <div className="space-y-4">
      {/* Header */}
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
          {/* Sanitized location name to prevent XSS */}
          <p className="text-sm text-[hsl(var(--muted-foreground))]">{sanitize(alert.location.name)}</p>
        </div>
      </div>

      {/* Thumbnail */}
      <div className="aspect-video rounded-lg overflow-hidden border border-[hsl(var(--border))] bg-[hsl(var(--muted))]">
        <img 
          src={alert.thumbnailImg} 
          alt={`Alert thumbnail for ${alert.alertType}`}
          className="w-full h-full object-cover"
        />
      </div>

      {/* Details Grid */}
      <div className="grid grid-cols-2 gap-3">
        <DetailItem label="Alert ID" value={alert.id} />
        <DetailItem label="Camera" value={alert.cameraID} />
        <DetailItem label="Timestamp" value={new Date(alert.timestamp).toLocaleString()} />
        <DetailItem label="Confidence" value={`${Math.round(alert.confidence * 100)}%`} />
        <DetailItem label="Coordinates" value={`${alert.location.lat.toFixed(4)}, ${alert.location.lng.toFixed(4)}`} />
        {showTrackInfo && (
          <>
            <DetailItem label="Direction" value={alert.metadata?.direction || '—'} />
            <DetailItem label="Speed" value={`${alert.metadata?.speedKmph || 0} km/h`} />
            <DetailItem label="Track ID" value={alert.metadata?.trackId || '—'} />
          </>
        )}
        {showTrackInfo && (
          <DetailItem label="Classification" value={alert.metadata?.classification || '—'} />
        )}
      </div>

      {/* Explainability Heatmap (TrackPage specific) */}
      {showExplainability && alert.explainabilityHeatmapUrl && (
        <div className="pt-2 border-t border-[hsl(var(--border))]">
          <p className="text-xs font-medium text-[hsl(var(--muted-foreground))] mb-2">EXPLAINABILITY HEATMAP</p>
          <div className="aspect-video rounded-lg overflow-hidden border border-[hsl(var(--border))] bg-[hsl(var(--muted))]">
            <img src={alert.explainabilityHeatmapUrl} alt="Explainability heatmap" className="w-full h-full object-cover opacity-80" />
          </div>
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex gap-2 pt-2">
        <button 
          onClick={onClose}
          className="flex-1 py-2.5 px-4 bg-[hsl(var(--secondary))] text-[hsl(var(--secondary-foreground))] font-medium rounded-lg border border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))] transition-colors"
        >
          Close
        </button>
        <button 
          onClick={() => navigator.clipboard.writeText(JSON.stringify(alert, null, 2))}
          className="flex-1 py-2.5 px-4 bg-primary text-primary-foreground font-medium rounded-lg hover:opacity-90 transition-opacity"
        >
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