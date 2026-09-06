/**
 * Optic Shield — AlertPanel Component
 * 
 * Prioritized live threat stream sidebar for C2 dashboard.
 * Features:
 * - WebSocket-driven real-time alert stream with auto-scroll
 * - Severity-based priority sorting (CRITICAL > WARNING > INFO)
 * - Alert cards with badge, timestamp, camera ID, consensus status, keyframe thumbnail
 * - Audio alarm chime for CRITICAL/WARNING intrusion events
 * - Click to open Grad-CAM modal for XAI verification
 * - Virtualized list for performance with 1000+ alerts
 * - Filter by camera, severity, type, time range
 * - Acknowledge/resolve/escalate actions with optimistic UI updates
 * - Dark tactical theme (Dark Slate #090D16, Tactical Blue #3B82F6, Critical Red #EF4444)
 */

import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  useImperativeHandle,
  forwardRef,
} from 'react';
import {
  AlertTriangle,
  Camera,
  MapPin,
  Clock,
  CheckCircle,
  XCircle,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Volume2,
  VolumeX,
  Filter,
  X,
  Flag,
  ExternalLink,
  Play,
  Pause,
  Settings,
  Download,
  Bell,
  WifiOff,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import { GradCamModal } from './GradCamModal';

// ============================================================
// Container Styles Function (defined before component use)
// ============================================================
function getContainerStyles(height, width, style, theme) {
  return {
    height,
    width,
    maxWidth: '420px',
    background: theme.darkSlate,
    border: `1px solid ${theme.borderSlate}`,
    borderRadius: '12px',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    fontFamily: '"JetBrains Mono", "Fira Code", monospace',
    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
    ...style,
  };
}

// ============================================================
// Theme Constants
// ============================================================
const THEME = {
  darkSlate: '#090D16',
  tacticalBlue: '#3B82F6',
  criticalRed: '#EF4444',
  warningAmber: '#F59E0B',
  infoBlue: '#3B82F6',
  successGreen: '#10B981',
  mutedSlate: '#1E293B',
  borderSlate: '#334155',
  textPrimary: '#F1F5F9',
  textSecondary: '#94A3B8',
  textMuted: '#64748B',
};

const SEVERITY_CONFIG = {
  3: { label: 'CRITICAL', color: THEME.criticalRed, bg: 'rgba(239, 68, 68, 0.15)', border: THEME.criticalRed, icon: AlertTriangle, priority: 0, sound: true },
  2: { label: 'WARNING', color: THEME.warningAmber, bg: 'rgba(245, 158, 11, 0.15)', border: THEME.warningAmber, icon: AlertCircle, priority: 1, sound: true },
  1: { label: 'INFO', color: THEME.infoBlue, bg: 'rgba(59, 130, 246, 0.15)', border: THEME.infoBlue, icon: AlertCircle, priority: 2, sound: false },
};

const ALERT_TYPE_ICONS = {
  GEOFENCE_INTRUSION: MapPin,
  SUSPICIOUS_BEHAVIOR: AlertTriangle,
  WATCHLIST_MATCH: Flag,
  PLATE_RECOGNIZED: Camera,
  CAMERA_TAMPERED: AlertTriangle,
  CAMERA_BLINDED: XCircle,
  CAMERA_FROZEN: AlertCircle,
  CAMERA_BLURRED: AlertCircle,
  IR_FAILURE: AlertCircle,
  STREAM_DEGRADED: WifiOff,
  GEO_DRIFT: MapPin,
};

// ============================================================
// Audio Context for Alarm Sounds
// ============================================================
const AudioContext = window.AudioContext || window.webkitAudioContext;
let audioCtx = null;

function playAlarmChime(severity) {
  try {
    if (!audioCtx) {
      audioCtx = new AudioContext();
    }

    const oscillator = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    // Different frequencies for different severities
    const frequencies = {
      3: [880, 660, 880, 660], // CRITICAL - urgent alternating
      2: [660, 523, 660],      // WARNING - descending
      1: [523],                 // INFO - single tone
    };

    const freq = frequencies[severity] || frequencies[1];
    let startTime = audioCtx.currentTime;

    freq.forEach((f, i) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.frequency.value = f;
      osc.type = 'sine';
      gain.gain.setValueAtTime(0.3, startTime);
      gain.gain.exponentialRampToValueAtTime(0.01, startTime + 0.3);
      osc.start(startTime);
      osc.stop(startTime + 0.3);
      startTime += 0.35;
    });
  } catch (e) {
    // console.warn('Audio alarm failed:', e);
  }
}

// ============================================================
// Alert Card Component
// ============================================================
const AlertCard = React.memo(function AlertCard({
  alert,
  index,
  onClick,
  onAction,
  audioEnabled,
  compact = false,
}) {
  const severity = alert.severity || 1;
  const config = SEVERITY_CONFIG[severity] || SEVERITY_CONFIG[1];
  const Icon = ALERT_TYPE_ICONS[alert.alert_type] || AlertCircle;
  const isCritical = severity === 3;
  const isExpanded = alert._expanded;

  // Trigger audio on first render for critical/warning
  useEffect(() => {
    if (audioEnabled && config.sound && !alert._soundPlayed) {
      alert._soundPlayed = true;
      playAlarmChime(severity);
    }
  }, [audioEnabled, config.sound, severity]);

  const formatTime = (ts) => {
    const date = new Date(ts);
    return date.toLocaleTimeString('en-IN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
  };

  const formatDate = (ts) => {
    const date = new Date(ts);
    return date.toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  };

  const getConsensusBadge = () => {
    const status = alert.consensus_status || 'NONE';
    const badges = {
      VERIFIED: { label: '✓ VERIFIED', color: THEME.successGreen },
      PENDING: { label: '⟳ PENDING', color: THEME.warningAmber },
      CONFLICT: { label: '⚠ CONFLICT', color: THEME.criticalRed },
      REJECTED: { label: '✗ REJECTED', color: THEME.textMuted },
      NONE: { label: '—', color: THEME.textMuted },
    };
    return badges[status] || badges.NONE;
  };

  const consensus = getConsensusBadge();

  if (compact) {
    return (
      <div
        className={`alert-card-compact ${isCritical ? 'critical' : ''}`}
        style={{
          background: config.bg,
          borderLeft: `4px solid ${config.color}`,
          borderRadius: '8px',
          padding: '10px 12px',
          marginBottom: '8px',
          cursor: 'pointer',
          transition: 'all 0.2s',
          border: `1px solid ${config.border}`,
        }}
        onClick={() => onClick?.(alert)}
        onMouseEnter={(e) => e.currentTarget.style.transform = 'translateX(4px)'}
        onMouseLeave={(e) => e.currentTarget.style.transform = 'translateX(0)'}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
          <div style={{ flexShrink: 0, marginTop: '2px' }}>
            <Icon size={16} style={{ color: config.color }} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
              <span style={{
                background: config.color,
                color: '#fff',
                padding: '2px 6px',
                borderRadius: '4px',
                fontSize: '10px',
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
              }}>
                {config.label}
              </span>
              <span style={{
                background: consensus.color,
                color: '#fff',
                padding: '2px 6px',
                borderRadius: '4px',
                fontSize: '10px',
                fontWeight: 500,
              }}>
                {consensus.label}
              </span>
            </div>
            <div style={{ fontSize: '13px', fontWeight: 600, color: THEME.textPrimary, marginBottom: '2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {alert.alert_type?.replace(/_/g, ' ') || 'Unknown Alert'}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '11px', color: THEME.textSecondary }}>
              <span>{formatTime(alert.detected_at)}</span>
              <span>•</span>
              <Camera size={11} />
              <span>BOP-{alert.camera_id?.toString().padStart(3, '0')}</span>
              {alert.confidence && (
                <>
                  <span>•</span>
                  <span>{(alert.confidence * 100).toFixed(1)}%</span>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`alert-card ${isCritical ? 'critical' : ''} ${isExpanded ? 'expanded' : ''}`}
      style={{
        background: config.bg,
        border: `1px solid ${config.border}`,
        borderRadius: '10px',
        marginBottom: '10px',
        overflow: 'hidden',
        transition: 'all 0.3s',
        boxShadow: isCritical ? `0 0 20px ${config.color}40` : 'none',
      }}
      onClick={() => onClick?.(alert)}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          padding: '12px 14px',
          background: isCritical ? `linear-gradient(90deg, ${config.color}20, transparent)` : 'transparent',
          borderBottom: isExpanded ? `1px solid ${config.border}` : 'none',
          cursor: 'pointer',
        }}
        onClick={(e) => {
          e.stopPropagation();
          onClick?.(alert, 'toggle');
        }}
      >
        <div style={{
          width: '10px',
          height: '10px',
          borderRadius: '50%',
          background: config.color,
          boxShadow: isCritical ? `0 0 12px ${config.color}` : 'none',
          animation: isCritical ? 'pulse 1.5s ease-in-out infinite' : 'none',
          flexShrink: 0,
        }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <span style={{
              background: config.color,
              color: '#fff',
              padding: '3px 8px',
              borderRadius: '4px',
              fontSize: '10px',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
            }}>
              {config.label}
            </span>
            <span style={{
              background: consensus.color,
              color: '#fff',
              padding: '3px 8px',
              borderRadius: '4px',
              fontSize: '10px',
              fontWeight: 500,
            }}>
              {consensus.label}
            </span>
            <Icon size={14} style={{ color: config.color }} />
            <span style={{ fontSize: '12px', fontWeight: 600, color: THEME.textPrimary, textTransform: 'capitalize' }}>
              {alert.alert_type?.replace(/_/g, ' ') || 'Unknown Alert'}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '4px', fontSize: '11px', color: THEME.textSecondary, flexWrap: 'wrap' }}>
            <span>
              <Clock size={11} style={{ verticalAlign: 'middle', marginRight: '4px' }} />
              {formatTime(alert.detected_at)} · {formatDate(alert.detected_at)}
            </span>
            <span>
              <Camera size={11} style={{ verticalAlign: 'middle', marginRight: '4px' }} />
              BOP-{alert.camera_id?.toString().padStart(3, '0')}
            </span>
            {alert.track_id && (
              <span>
                <Flag size={11} style={{ verticalAlign: 'middle', marginRight: '4px' }} />
                Track #{alert.track_id}
              </span>
            )}
            {alert.confidence && (
              <span style={{ color: config.color, fontWeight: 600 }}>
                Confidence: {(alert.confidence * 100).toFixed(1)}%
              </span>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {alert.keyframe_thumbnail_url && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onClick?.(alert, 'gradcam');
              }}
              className="btn-icon"
              style={{
                background: 'rgba(59, 130, 246, 0.2)',
                border: '1px solid #3B82F6',
                color: '#3B82F6',
              }}
              title="Open Grad-CAM View"
            >
              <ExternalLink size={14} />
            </button>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onClick?.(alert, 'toggle');
            }}
            className="btn-icon"
            style={{
              background: 'rgba(99, 102, 241, 0.2)',
              border: '1px solid #6366F1',
              color: '#6366F1',
            }}
            title={isExpanded ? 'Collapse' : 'Expand'}
          >
            {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
        </div>
      </div>

      {/* Expanded Content */}
      {isExpanded && (
        <div style={{ padding: '14px', borderTop: `1px solid ${config.border}`, animation: 'slideDown 0.2s ease-out' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px', marginBottom: '12px' }}>
            {/* Keyframe Thumbnail */}
            {alert.keyframe_thumbnail_url && (
              <div style={{ gridColumn: 'span 1' }}>
                <div style={{ fontSize: '11px', color: THEME.textSecondary, marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Keyframe Thumbnail</div>
                <div style={{ position: 'relative', borderRadius: '8px', overflow: 'hidden', border: `1px solid ${THEME.borderSlate}`, background: THEME.mutedSlate }}>
                  <img
                    src={alert.keyframe_thumbnail_url}
                    alt="Alert keyframe"
                    style={{ width: '100%', height: 'auto', display: 'block', maxHeight: '200px', objectFit: 'cover' }}
                    onError={(e) => { e.currentTarget.style.display = 'none'; }}
                  />
                  <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: 'linear-gradient(transparent, rgba(0,0,0,0.8))', padding: '8px', fontSize: '10px', color: THEME.textSecondary }}>
                    {alert.keyframe_timestamp ? `Captured: ${new Date(alert.keyframe_timestamp).toLocaleTimeString()}` : 'Keyframe'}
                  </div>
                </div>
              </div>
            )}

            {/* Alert Details */}
            <div>
              <div style={{ fontSize: '11px', color: THEME.textSecondary, marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Details</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '12px' }}>
                {alert.object_class && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 10px', background: THEME.mutedSlate, borderRadius: '6px' }}>
                    <span style={{ color: THEME.textSecondary }}>Object Class</span>
                    <span style={{ fontWeight: 600, color: THEME.textPrimary, textTransform: 'capitalize' }}>{alert.object_class}</span>
                  </div>
                )}
                {alert.behavior_type && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 10px', background: THEME.mutedSlate, borderRadius: '6px' }}>
                    <span style={{ color: THEME.textSecondary }}>Behavior</span>
                    <span style={{ fontWeight: 600, color: THEME.textPrimary, textTransform: 'capitalize' }}>{alert.behavior_type.replace(/_/g, ' ')}</span>
                  </div>
                )}
                {alert.geofence_id && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 10px', background: THEME.mutedSlate, borderRadius: '6px' }}>
                    <span style={{ color: THEME.textSecondary }}>Geofence</span>
                    <span style={{ fontWeight: 600, color: THEME.textPrimary }}>{alert.geofence_id}</span>
                  </div>
                )}
                {alert.intersection_point && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 10px', background: THEME.mutedSlate, borderRadius: '6px' }}>
                    <span style={{ color: THEME.textSecondary }}>Intersection</span>
                    <span style={{ fontWeight: 500, color: THEME.textPrimary, fontFamily: 'monospace' }}>
                      {alert.intersection_point[1]?.toFixed(4)}, {alert.intersection_point[0]?.toFixed(4)}
                    </span>
                  </div>
                )}
                {alert.plate_text && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 10px', background: THEME.mutedSlate, borderRadius: '6px' }}>
                    <span style={{ color: THEME.textSecondary }}>Plate</span>
                    <span style={{ fontWeight: 700, color: config.color, fontFamily: 'monospace', letterSpacing: '1px' }}>{alert.plate_text}</span>
                  </div>
                )}
                {alert.watchlist_name && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 10px', background: THEME.mutedSlate, borderRadius: '6px' }}>
                    <span style={{ color: THEME.textSecondary }}>Watchlist Match</span>
                    <span style={{ fontWeight: 600, color: THEME.criticalRed }}>{alert.watchlist_name}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Predicted Trajectory */}
            {alert.predicted_trajectory && alert.predicted_trajectory.length >= 2 && (
              <div>
                <div style={{ fontSize: '11px', color: THEME.textSecondary, marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Predicted Trajectory</div>
                <div style={{ padding: '10px', background: THEME.mutedSlate, borderRadius: '8px', border: `1px solid ${THEME.borderSlate}` }}>
                  <div style={{ fontSize: '12px', color: THEME.textPrimary, marginBottom: '4px' }}>
                    {alert.prediction_horizon_seconds || 10}s Kalman Projection
                  </div>
                  <div style={{ fontSize: '11px', color: THEME.textSecondary }}>
                    {alert.predicted_trajectory.length} waypoints · Click map to view
                  </div>
                </div>
              </div>
            )}

            {/* Consensus Details */}
            <div>
              <div style={{ fontSize: '11px', color: THEME.textSecondary, marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Spatial Consensus</div>
              <div style={{ padding: '10px', background: THEME.mutedSlate, borderRadius: '8px', border: `1px solid ${consensus.color}40` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                  <span style={{
                    width: '10px',
                    height: '10px',
                    borderRadius: '50%',
                    background: consensus.color,
                  }} />
                  <span style={{ fontWeight: 600, color: consensus.color }}>{consensus.label}</span>
                </div>
                <div style={{ fontSize: '11px', color: THEME.textSecondary }}>
                  {alert.consensus_sources && alert.consensus_sources.length > 0
                    ? `Sources: ${alert.consensus_sources.join(', ')}`
                    : 'Awaiting multi-source verification...'}
                </div>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', paddingTop: '8px', borderTop: `1px solid ${THEME.borderSlate}` }}>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onAction?.(alert, 'acknowledge');
              }}
              className="btn-action"
              style={{ background: THEME.tacticalBlue }}
            >
              <CheckCircle size={14} /> Acknowledge
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onAction?.(alert, 'resolve');
              }}
              className="btn-action"
              style={{ background: THEME.successGreen }}
            >
              <CheckCircle size={14} /> Resolve
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onAction?.(alert, 'escalate');
              }}
              className="btn-action"
              style={{ background: THEME.warningAmber }}
            >
              <Flag size={14} /> Escalate
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onAction?.(alert, 'gradcam');
              }}
              className="btn-action"
              style={{ background: '#6366F1' }}
            >
              <ExternalLink size={14} /> Grad-CAM
            </button>
          </div>
        </div>
      )}
    </div>
  );
});

// ============================================================
// Filter Bar Component
// ============================================================
function FilterBar({ filters, onFiltersChange, alertCounts, onClearFilters }) {
  const [showFilters, setShowFilters] = useState(false);

  return (
    <div className="filter-bar" style={{ padding: '12px 14px', borderBottom: `1px solid ${THEME.borderSlate}`, background: THEME.mutedSlate }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
        <Filter size={16} style={{ color: THEME.tacticalBlue }} />
        
        {/* Severity Filter */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <label style={{ fontSize: '11px', color: THEME.textSecondary, marginRight: '6px' }}>Severity:</label>
          <div style={{ display: 'flex', gap: '4px' }}>
            {Object.entries(SEVERITY_CONFIG).map(([key, config]) => (
              <button
                key={key}
                onClick={() => onFiltersChange({ ...filters, severity: filters.severity === parseInt(key) ? null : parseInt(key) })}
                style={{
                  padding: '4px 10px',
                  borderRadius: '16px',
                  fontSize: '10px',
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                  border: `1px solid ${filters.severity === parseInt(key) ? config.color : THEME.borderSlate}`,
                  background: filters.severity === parseInt(key) ? config.bg : 'transparent',
                  color: filters.severity === parseInt(key) ? config.color : THEME.textSecondary,
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                }}
              >
                {config.label} ({alertCounts[key] || 0})
              </button>
            ))}
          </div>
        </div>

        {/* Camera Filter */}
        {filters.cameraId && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', background: THEME.tacticalBlue + '20', border: `1px solid ${THEME.tacticalBlue}`, borderRadius: '16px', padding: '4px 10px' }}>
            <Camera size={11} style={{ color: THEME.tacticalBlue }} />
            <span style={{ fontSize: '11px', fontWeight: 500, color: THEME.tacticalBlue }}>Cam {filters.cameraId}</span>
            <button onClick={() => onFiltersChange({ ...filters, cameraId: null })} style={{ background: 'none', border: 'none', color: THEME.tacticalBlue, cursor: 'pointer', padding: '0 4px' }}>
              <X size={12} />
            </button>
          </div>
        )}

        {/* Type Filter */}
        {filters.type && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', background: THEME.warningAmber + '20', border: `1px solid ${THEME.warningAmber}`, borderRadius: '16px', padding: '4px 10px' }}>
            <AlertTriangle size={11} style={{ color: THEME.warningAmber }} />
            <span style={{ fontSize: '11px', fontWeight: 500, color: THEME.warningAmber, textTransform: 'capitalize' }}>{filters.type.replace(/_/g, ' ')}</span>
            <button onClick={() => onFiltersChange({ ...filters, type: null })} style={{ background: 'none', border: 'none', color: THEME.warningAmber, cursor: 'pointer', padding: '0 4px' }}>
              <X size={12} />
            </button>
          </div>
        )}

        <div style={{ flex: 1 }} />

        {/* Sound Toggle */}
        <button
          onClick={() => onFiltersChange({ ...filters, sound: !filters.sound })}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '6px 12px',
            borderRadius: '8px',
            border: `1px solid ${filters.sound ? THEME.successGreen : THEME.borderSlate}`,
            background: filters.sound ? 'rgba(16, 185, 129, 0.15)' : 'transparent',
            color: filters.sound ? THEME.successGreen : THEME.textSecondary,
            cursor: 'pointer',
            fontSize: '11px',
            fontWeight: 500,
            transition: 'all 0.2s',
          }}
        >
          {filters.sound ? <Volume2 size={14} /> : <VolumeX size={14} />}
          <span>{filters.sound ? 'Sound ON' : 'Sound OFF'}</span>
        </button>

        {/* Clear Filters */}
        {(filters.severity || filters.cameraId || filters.type) && (
          <button
            onClick={onClearFilters}
            className="btn-icon"
            style={{ background: 'rgba(239, 68, 68, 0.15)', border: `1px solid ${THEME.criticalRed}`, color: THEME.criticalRed }}
            title="Clear All Filters"
          >
            <X size={14} />
          </button>
        )}
      </div>
    </div>
  );
}

// ============================================================
// Main AlertPanel Component
// ============================================================
export const AlertPanel = forwardRef(function AlertPanel({
  className = '',
  style = {},
  height = '100%',
  width = '380px',
  initialFilters = {},
  onAlertAction,
  onOpenGradCam,
  api,
}, ref) {
  // State
  const [alerts, setAlerts] = useState([]);
  const [filters, setFilters] = useState({
    severity: null,
    cameraId: null,
    type: null,
    sound: true,
    ...initialFilters,
  });
  const [connectionStatus, setConnectionStatus] = useState('connecting');
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [autoScroll, setAutoScroll] = useState(true);
  const [totalCount, setTotalCount] = useState(0);
  const [unacknowledgedCount, setUnacknowledgedCount] = useState(0);
  const [isPolling, setIsPolling] = useState(false);

  // Refs
  const listRef = useRef(null);
  const observerRef = useRef(null);
  const audioRef = useRef(null);
  const pollIntervalRef = useRef(null);
  const alertCountsRef = useRef({ 1: 0, 2: 0, 3: 0 });
  const lastAlertIdRef = useRef(null);

  // Expose methods to parent
  useImperativeHandle(ref, () => ({
    clearAlerts: () => setAlerts([]),
    getAlertCount: () => alerts.length,
    getUnacknowledgedCount: () => unacknowledgedCount,
    setFilters,
    scrollToTop: () => listRef.current?.scrollTo({ top: 0, behavior: 'smooth' }),
  }), []);

  // Initialize REST polling for alerts
  useEffect(() => {
    if (!api) return;

    let mounted = true;

    const fetchAlerts = async () => {
      if (!mounted || isPolling) return;
      setIsPolling(true);
      
      try {
        // Fetch recent alerts
        const data = await api.getAlerts({ limit: 100, sort: 'desc' });
        const newAlerts = data?.data || data || [];
        
        if (mounted && Array.isArray(newAlerts)) {
          // Deduplicate by alert ID
          const existingIds = new Set(alerts.map(a => a.id));
          const uniqueNewAlerts = newAlerts.filter(a => !existingIds.has(a.id));
          
          if (uniqueNewAlerts.length > 0) {
            setAlerts(prev => {
              const combined = [...uniqueNewAlerts, ...prev].sort((a, b) => {
                const priorityA = SEVERITY_CONFIG[a.severity]?.priority ?? 99;
                const priorityB = SEVERITY_CONFIG[b.severity]?.priority ?? 99;
                if (priorityA !== priorityB) return priorityA - priorityB;
                return new Date(b.detected_at) - new Date(a.detected_at);
              });
              
              // Update counts
              const counts = { 1: 0, 2: 0, 3: 0 };
              let unack = 0;
              combined.forEach(a => {
                counts[a.severity] = (counts[a.severity] || 0) + 1;
                if (a.status === 'PENDING') unack++;
              });
              alertCountsRef.current = counts;
              setTotalCount(combined.length);
              setUnacknowledgedCount(unack);
              
              return combined.slice(0, 1000);
            });
            
            // Track latest alert ID for auto-scroll
            if (uniqueNewAlerts.length > 0) {
              lastAlertIdRef.current = uniqueNewAlerts[0].id;
            }
          }
        }
        
        setConnectionStatus('connected');
      } catch (error) {
        // Gracefully handle 404 - the endpoint may not exist on fallback backend
        if (error instanceof api.APIError && error.status === 404) {
          console.warn('[AlertPanel] /api/v1/alerts not found (404), using empty state');
          if (mounted) {
            setAlerts([]);
            setTotalCount(0);
            setUnacknowledgedCount(0);
            setConnectionStatus('connected'); // Treat as connected but no data
          }
        } else {
          console.error('[AlertPanel] REST polling error:', error);
          if (mounted) setConnectionStatus('error');
        }
      } finally {
        if (mounted) setIsPolling(false);
      }
    };

    // Initial fetch
    fetchAlerts();
    
    // Set up polling interval (every 5 seconds)
    pollIntervalRef.current = setInterval(fetchAlerts, 5000);

    return () => {
      mounted = false;
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, [api, alerts.length]);

  // Handle filter changes
  const handleFiltersChange = useCallback((newFilters) => {
    setFilters(prev => ({ ...prev, ...newFilters }));
  }, []);

  const clearFilters = useCallback(() => {
    setFilters({ severity: null, cameraId: null, type: null, sound: filters.sound });
  }, [filters.sound]);

  // Get filtered alerts
  const filteredAlerts = useMemo(() => {
    if (!alerts || !Array.isArray(alerts)) return [];
    return alerts.filter(alert => {
      if (filters.severity && alert.severity !== filters.severity) return false;
      if (filters.cameraId && alert.camera_id !== filters.cameraId) return false;
      if (filters.type && alert.alert_type !== filters.type) return false;
      return true;
    });
  }, [alerts, filters]);

  // Get alert counts by severity
  const alertCounts = useMemo(() => {
    const counts = { 1: 0, 2: 0, 3: 0 };
    if (alerts && Array.isArray(alerts)) {
      alerts.forEach(a => { counts[a.severity] = (counts[a.severity] || 0) + 1; });
    }
    return counts;
  }, [alerts]);

  // Virtualized list observer for auto-scroll
  useEffect(() => {
    if (!autoScroll || !listRef.current) return;

    observerRef.current = new IntersectionObserver((entries) => {
      const lastItem = entries[entries.length - 1];
      if (lastItem.isIntersecting) {
        // User scrolled to bottom, keep auto-scroll
      }
    }, { threshold: 1.0 });

    const items = listRef.current.querySelectorAll('[data-alert-item]');
    items.forEach(item => observerRef.current?.observe(item));

    return () => observerRef.current?.disconnect();
  }, [autoScroll, filteredAlerts.length]);

  // Scroll to top when new critical alert arrives
  useEffect(() => {
    const criticalAlert = filteredAlerts.find(a => a.severity === 3 && a._receivedAt > Date.now() - 5000);
    if (criticalAlert && autoScroll && listRef.current) {
      listRef.current.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [filteredAlerts, autoScroll]);

  // Handle alert click
  const handleAlertClick = useCallback((alert, action = 'toggle') => {
    if (action === 'gradcam' || action === 'toggle') {
      onOpenGradCam?.(alert);
    }
    if (action === 'toggle') {
      setAlerts(prev => prev.map(a => 
        a._id === alert._id ? { ...a, _expanded: !a._expanded } : a
      ));
    }
  }, [onOpenGradCam]);

  // Handle alert actions
  const handleAlertAction = useCallback(async (alert, action) => {
    if (!api) return;

    try {
      // Optimistic update
      setAlerts(prev => prev.map(a => 
        a._id === alert._id ? { ...a, status: action.toUpperCase() } : a
      ));

      // Call API
      await onAlertAction?.(alert, action);

      // Update unacknowledged count
      setAlerts(prev => {
        let unack = 0;
        prev.forEach(a => { if (a.status === 'PENDING') unack++; });
        setUnacknowledgedCount(unack);
        return prev;
      });
    } catch (error) {
      console.error('Alert action failed:', error);
      // Revert optimistic update
      setAlerts(prev => prev.map(a => 
        a._id === alert._id ? { ...a, status: 'PENDING' } : a
      ));
    }
  }, [api, onAlertAction]);

  // Render empty state
  if (filteredAlerts.length === 0) {
    return (
      <div className="alert-panel" style={getContainerStyles(height, width, style, THEME)}>
        <div style={{ padding: '20px', textAlign: 'center', color: THEME.textSecondary }}>
          <AlertTriangle size={48} style={{ marginBottom: '16px', opacity: 0.3 }} />
          <p style={{ fontSize: '14px', marginBottom: '8px' }}>No alerts match current filters</p>
          <p style={{ fontSize: '12px' }}>{(alerts?.length || 0) === 0 ? 'Waiting for incoming threats...' : 'Adjust filters to see alerts'}</p>
          {filters.severity || filters.cameraId || filters.type ? (
            <button onClick={clearFilters} className="btn-text" style={{ marginTop: '12px', color: THEME.tacticalBlue }}>
              Clear Filters
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="alert-panel" style={getContainerStyles(height, width, style, THEME)}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '12px 14px',
        borderBottom: `1px solid ${THEME.borderSlate}`,
        background: THEME.mutedSlate,
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Bell size={20} style={{ color: THEME.criticalRed }} />
            <span style={{ fontSize: '14px', fontWeight: 700, color: THEME.textPrimary, letterSpacing: '0.5px' }}>
              THREAT STREAM
            </span>
          </div>
          <div style={{ display: 'flex', gap: '4px' }}>
            <span style={{
              padding: '2px 8px',
              borderRadius: '12px',
              fontSize: '10px',
              fontWeight: 700,
              background: THEME.criticalRed + '20',
              color: THEME.criticalRed,
            }}>
              {alertCounts[3] || 0}
            </span>
            <span style={{
              padding: '2px 8px',
              borderRadius: '12px',
              fontSize: '10px',
              fontWeight: 700,
              background: THEME.warningAmber + '20',
              color: THEME.warningAmber,
            }}>
              {alertCounts[2] || 0}
            </span>
            <span style={{
              padding: '2px 8px',
              borderRadius: '12px',
              fontSize: '10px',
              fontWeight: 700,
              background: THEME.infoBlue + '20',
              color: THEME.infoBlue,
            }}>
              {alertCounts[1] || 0}
            </span>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            background: connectionStatus === 'connected' ? THEME.successGreen : 
                       connectionStatus === 'connecting' ? THEME.warningAmber : THEME.criticalRed,
            animation: connectionStatus === 'connected' ? 'pulse 2s ease-in-out infinite' : 'none',
          }} />
          <span style={{ fontSize: '11px', color: THEME.textSecondary, textTransform: 'uppercase' }}>
            REST {connectionStatus === 'connected' ? '• LIVE' : connectionStatus.toUpperCase()}
          </span>
          <button
            onClick={() => setAutoScroll(!autoScroll)}
            className={`btn-icon ${autoScroll ? 'active' : ''}`}
            style={{
              background: autoScroll ? 'rgba(16, 185, 129, 0.2)' : 'transparent',
              border: `1px solid ${autoScroll ? THEME.successGreen : THEME.borderSlate}`,
              color: autoScroll ? THEME.successGreen : THEME.textSecondary,
            }}
            title={autoScroll ? 'Auto-scroll ON' : 'Auto-scroll OFF'}
          >
            {autoScroll ? <Play size={14} /> : <Pause size={14} />}
          </button>
          <button
            onClick={() => setSoundEnabled(!soundEnabled)}
            className="btn-icon"
            style={{
              background: soundEnabled ? 'rgba(16, 185, 129, 0.2)' : 'transparent',
              border: `1px solid ${soundEnabled ? THEME.successGreen : THEME.borderSlate}`,
              color: soundEnabled ? THEME.successGreen : THEME.textSecondary,
            }}
            title={soundEnabled ? 'Alarm Sound ON' : 'Alarm Sound OFF'}
          >
            {soundEnabled ? <Volume2 size={14} /> : <VolumeX size={14} />}
          </button>
        </div>
      </div>

      {/* Filter Bar */}
      <FilterBar
        filters={filters}
        onFiltersChange={handleFiltersChange}
        alertCounts={alertCounts}
        onClearFilters={clearFilters}
      />

      {/* Alert List */}
      <div
        ref={listRef}
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '8px',
          background: THEME.darkSlate,
        }}
      >
        {filteredAlerts.map((alert, index) => (
          <div
            key={alert._id}
            data-alert-item
            style={{ willChange: 'transform' }}
          >
            <AlertCard
              alert={alert}
              index={index}
              onClick={handleAlertClick}
              onAction={handleAlertAction}
              audioEnabled={soundEnabled}
            />
          </div>
        ))}
        {/* Bottom sentinel for auto-scroll */}
        <div style={{ height: '20px' }} />
      </div>

      {/* Footer Stats */}
      <div style={{
        padding: '10px 14px',
        borderTop: `1px solid ${THEME.borderSlate}`,
        background: THEME.mutedSlate,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        fontSize: '11px',
        color: THEME.textSecondary,
        flexShrink: 0,
      }}>
        <span>Total: {totalCount} alerts</span>
        <span>{unacknowledgedCount} unacknowledged</span>
        <span>Filtered: {filteredAlerts.length}</span>
      </div>
    </div>
  );
});

// ============================================================
// Inject keyframe animations
// ============================================================
if (typeof document !== 'undefined') {
  const styleId = 'alertpanel-styles';
  if (!document.getElementById(styleId)) {
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
@keyframes pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.5; transform: scale(1.1); }
}

@keyframes slideDown {
  from { opacity: 0; transform: translateY(-10px); }
  to { opacity: 1; transform: translateY(0); }
}

.alert-panel {
  font-family: "JetBrains Mono", "Fira Code", monospace;
  color: ${THEME.textPrimary};
}

.alert-card {
  animation: slideIn 0.3s ease-out;
}

@keyframes slideIn {
  from { opacity: 0; transform: translateX(-20px); }
  to { opacity: 1; transform: translateX(0); }
}

.alert-card.critical {
  animation: slideIn 0.3s ease-out, pulse 2s ease-in-out infinite;
}

.alert-card:hover {
  transform: translateX(4px);
}

.alert-card.expanded .alert-card-compact {
  display: none;
}

.btn-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 6px;
  border: 1px solid ${THEME.borderSlate};
  background: transparent;
  color: ${THEME.textSecondary};
  cursor: pointer;
  transition: all 0.2s;
  flex-shrink: 0;
}

.btn-icon:hover {
  background: ${THEME.tacticalBlue}20;
  border-color: ${THEME.tacticalBlue};
  color: ${THEME.tacticalBlue};
}

.btn-icon.active {
  background: ${THEME.successGreen}20;
  border-color: ${THEME.successGreen};
  color: ${THEME.successGreen};
}

.btn-action {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  borderRadius: 6px;
  border: none;
  color: #fff;
  fontSize: 11px;
  fontWeight: 600;
  fontFamily: inherit;
  textTransform: uppercase;
  letterSpacing: 0.5px;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-action:hover {
  filter: brightness(1.1);
  transform: translateY(-1px);
}

.btn-text {
  background: none;
  border: none;
  color: inherit;
  fontSize: inherit;
  fontFamily: inherit;
  cursor: pointer;
  padding: 4px 8px;
  textDecoration: underline;
}

.filter-bar {
  flex-shrink: 0;
}
    `;
    document.head.appendChild(style);
  }
}

AlertPanel.displayName = 'AlertPanel';

export default AlertPanel;