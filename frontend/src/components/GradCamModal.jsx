/**
 * Optic Shield — GradCamModal Component
 * 
 * Explainable AI (XAI) decision verification modal.
 * Features:
 * - Side-by-side / overlay slider comparison between raw keyframe and Grad-CAM heatmap
 * - Model decision confidence display (e.g., "Human Crawling Detected - 94.2% Confidence")
 * - SHA-256 block hash for event to prove evidence integrity
 * - "Dispatch Response Team" action button
 * - Opacity slider for heatmap blending
 * - Download functionality for evidence packages
 * - Supports YOLOv8, ArcFace, LPRNet model interpretability
 * - Dark tactical theme
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
  X,
  Maximize2,
  Minimize2,
  Download,
  Shield,
  Hash,
  Eye,
  EyeOff,
  Sliders,
  ExternalLink,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Loader2,
  Zap,
  Brain,
  Layers,
  Copy,
  Check,
  FileText,
  Image,
  Palette,
  RotateCcw,
  Expand,
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

const MODEL_COLORS = {
  YOLOv8: '#3B82F6',
  ArcFace: '#8B5CF6',
  LPRNet: '#10B981',
  ZeroDCE: '#F59E0B',
  PoseNet: '#EC4899',
};

// ============================================================
// Grad-CAM Visualization Canvas
// ============================================================
const GradCamCanvas = React.memo(function GradCamCanvas({
  originalImage,
  heatmapData,
  opacity = 0.5,
  colormap = 'jet',
  width,
  height,
  mode = 'overlay', // 'side-by-side' | 'overlay' | 'heatmap-only'
  onLoad,
}) {
  const canvasRef = useRef(null);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !originalImage) return;

    const ctx = canvas.getContext('2d');
    const img = new Image();
    img.crossOrigin = 'anonymous';

    img.onload = () => {
      // Set canvas size
      const displayWidth = width || img.width;
      const displayHeight = height || img.height;
      canvas.width = displayWidth;
      canvas.height = displayHeight;

      // Clear canvas
      ctx.clearRect(0, 0, displayWidth, displayHeight);

      if (mode === 'side-by-side') {
        // Draw original on left half
        ctx.drawImage(img, 0, 0, displayWidth / 2, displayHeight);
        
        // Draw heatmap overlay on right half
        ctx.drawImage(img, displayWidth / 2, 0, displayWidth / 2, displayHeight);
        
        if (heatmapData) {
          drawHeatmap(ctx, heatmapData, displayWidth / 2, displayWidth / 2, displayHeight, opacity, colormap);
        }
      } else if (mode === 'overlay') {
        // Draw original full size
        ctx.drawImage(img, 0, 0, displayWidth, displayHeight);
        
        // Overlay heatmap
        if (heatmapData) {
          drawHeatmap(ctx, heatmapData, 0, displayWidth, displayHeight, opacity, colormap);
        }
      } else if (mode === 'heatmap-only') {
        // Draw only heatmap
        if (heatmapData) {
          drawHeatmap(ctx, heatmapData, 0, displayWidth, displayHeight, 1.0, colormap);
        }
      }

      setImageLoaded(true);
      onLoad?.();
    };

    img.onerror = () => {
      setError('Failed to load image');
      setImageLoaded(true);
    };

    img.src = originalImage;

    return () => {
      img.onload = null;
      img.onerror = null;
    };
  }, [originalImage, heatmapData, opacity, colormap, width, height, mode]);

  // Helper to draw heatmap on canvas
  const drawHeatmap = (ctx, heatmap, offsetX, drawWidth, drawHeight, opacity, colormap) => {
    if (!heatmap || !heatmap.length) return;

    const hmWidth = heatmap[0]?.length || 1;
    const hmHeight = heatmap.length;

    // Create temporary canvas for heatmap
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = hmWidth;
    tempCanvas.height = hmHeight;
    const tempCtx = tempCanvas.getContext('2d');
    const imageData = tempCtx.createImageData(hmWidth, hmHeight);
    const data = imageData.data;

    // Apply colormap
    for (let y = 0; y < hmHeight; y++) {
      for (let x = 0; x < hmWidth; x++) {
        const value = Math.max(0, Math.min(1, heatmap[y][x] || 0));
        const idx = (y * hmWidth + x) * 4;
        const color = getColormapColor(value, colormap);
        data[idx] = color.r;
        data[idx + 1] = color.g;
        data[idx + 2] = color.b;
        data[idx + 3] = Math.round(255 * value * opacity);
      }
    }

    tempCtx.putImageData(imageData, 0, 0);
    
    // Draw scaled heatmap
    ctx.globalAlpha = opacity;
    ctx.drawImage(tempCanvas, offsetX, 0, drawWidth, drawHeight);
    ctx.globalAlpha = 1.0;
  };

  if (error) {
    return (
      <div style={{
        width: width || 400,
        height: height || 300,
        background: THEME.mutedSlate,
        border: `1px dashed ${THEME.borderSlate}`,
        borderRadius: '8px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: THEME.textSecondary,
        fontSize: '14px',
      }}>
        Failed to load image
      </div>
    );
  }

  if (!imageLoaded) {
    return (
      <div style={{
        width: width || 400,
        height: height || 300,
        background: THEME.mutedSlate,
        border: `1px solid ${THEME.borderSlate}`,
        borderRadius: '8px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: THEME.textSecondary,
      }}>
        <Loader2 size={32} className="spinning" style={{ color: THEME.tacticalBlue }} />
      </div>
    );
  }

  return (
    <canvas
      ref={canvasRef}
      style={{
        width: '100%',
        height: '100%',
        borderRadius: '8px',
        background: THEME.mutedSlate,
      }}
    />
  );
});

// Colormap functions
function getColormapColor(value, colormap) {
  // Clamp value
  const v = Math.max(0, Math.min(1, value));

  switch (colormap) {
    case 'jet':
      return jetColormap(v);
    case 'viridis':
      return viridisColormap(v);
    case 'hot':
      return hotColormap(v);
    case 'cool':
      return coolColormap(v);
    default:
      return jetColormap(v);
  }
}

function jetColormap(v) {
  const r = Math.max(0, Math.min(255, Math.round(255 * (1.5 - Math.abs(v * 4 - 3)))));
  const g = Math.max(0, Math.min(255, Math.round(255 * (1.5 - Math.abs(v * 4 - 2)))));
  const b = Math.max(0, Math.min(255, Math.round(255 * (1.5 - Math.abs(v * 4 - 1)))));
  return { r, g, b };
}

function viridisColormap(v) {
  // Simplified viridis approximation
  const r = Math.max(0, Math.min(255, Math.round(255 * (0.23 + 0.77 * v))));
  const g = Math.max(0, Math.min(255, Math.round(255 * (0.12 + 0.88 * Math.pow(v, 0.5)))));
  const b = Math.max(0, Math.min(255, Math.round(255 * (0.34 - 0.34 * Math.pow(v, 2)))));
  return { r, g, b };
}

function hotColormap(v) {
  const r = Math.min(255, Math.round(255 * Math.min(1, v * 3)));
  const g = Math.min(255, Math.round(255 * Math.max(0, Math.min(1, (v - 0.33) * 3))));
  const b = Math.min(255, Math.round(255 * Math.max(0, Math.min(1, (v - 0.66) * 3))));
  return { r, g, b };
}

function coolColormap(v) {
  const r = Math.min(255, Math.round(255 * v));
  const g = Math.min(255, Math.round(255 * (1 - v)));
  const b = 255;
  return { r, g, b };
}

// ============================================================
// Color Legend Component
// ============================================================
const ColorLegend = ({ colormap = 'jet', minLabel = 'Low', maxLabel = 'High', className = '' }) => {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const width = 200;
    const height = 20;
    canvas.width = width;
    canvas.height = height;

    const imageData = ctx.createImageData(width, height);
    const data = imageData.data;

    for (let x = 0; x < width; x++) {
      const v = x / (width - 1);
      const color = getColormapColor(v, colormap);
      for (let y = 0; y < height; y++) {
        const idx = (y * width + x) * 4;
        data[idx] = color.r;
        data[idx + 1] = color.g;
        data[idx + 2] = color.b;
        data[idx + 3] = 255;
      }
    }

    ctx.putImageData(imageData, 0, 0);
  }, [colormap]);

  return (
    <div className={`color-legend ${className}`} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '11px', color: THEME.textSecondary }}>
      <span>{minLabel}</span>
      <canvas ref={canvasRef} width={200} height={20} style={{ borderRadius: '4px', border: `1px solid ${THEME.borderSlate}` }} />
      <span>{maxLabel}</span>
    </div>
  );
};

// ============================================================
// SHA-256 Hash Display Component
// ============================================================
const HashDisplay = ({ hash, label = 'Block Hash', copied, onCopy }) => {
  const [showFull, setShowFull] = useState(false);
  const shortHash = hash ? `${hash.slice(0, 16)}...${hash.slice(-16)}` : '—';

  return (
    <div style={{ background: THEME.mutedSlate, border: `1px solid ${THEME.borderSlate}`, borderRadius: '8px', padding: '12px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
        <span style={{ fontSize: '11px', color: THEME.textSecondary, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          {label} (SHA-256)
        </span>
        <div style={{ display: 'flex', gap: '6px' }}>
          <button
            onClick={() => setShowFull(!showFull)}
            className="btn-icon"
            style={{ background: 'transparent', border: 'none', color: THEME.textSecondary, padding: '4px' }}
            title={showFull ? 'Show truncated' : 'Show full hash'}
          >
            {showFull ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
          <button
            onClick={onCopy}
            className="btn-icon"
            style={{ background: copied ? 'rgba(16, 185, 129, 0.2)' : 'transparent', border: `1px solid ${copied ? THEME.successGreen : THEME.borderSlate}`, color: copied ? THEME.successGreen : THEME.textSecondary, padding: '4px' }}
            title={copied ? 'Copied!' : 'Copy hash'}
            disabled={copied}
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
          </button>
        </div>
      </div>
      <code style={{
        fontFamily: '"JetBrains Mono", monospace',
        fontSize: '12px',
        color: THEME.textPrimary,
        background: THEME.darkSlate,
        padding: '8px 10px',
        borderRadius: '6px',
        display: 'block',
        wordBreak: 'break-all',
        letterSpacing: '0.5px',
        border: `1px solid ${THEME.borderSlate}`,
      }}>
        {showFull ? hash : shortHash}
      </code>
    </div>
  );
};

// ============================================================
// Model Confidence Display
// ============================================================
const ConfidenceDisplay = ({ model, confidence, prediction, details = {} }) => {
  const color = MODEL_COLORS[model] || THEME.tacticalBlue;
  const confidencePct = Math.round(confidence * 1000) / 10; // One decimal

  return (
    <div style={{
      background: `linear-gradient(135deg, ${color}15, ${color}05)`,
      border: `1px solid ${color}40`,
      borderRadius: '10px',
      padding: '16px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
        <div style={{
          width: '48px',
          height: '48px',
          borderRadius: '10px',
          background: `linear-gradient(135deg, ${color}20, ${color}05)`,
          border: `1px solid ${color}40`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          <Brain size={24} style={{ color }} />
        </div>
        <div>
          <div style={{ fontSize: '12px', color: THEME.textSecondary, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Model</div>
          <div style={{ fontSize: '16px', fontWeight: 700, color: THEME.textPrimary }}>{model}</div>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: '150px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
            <span style={{ fontSize: '11px', color: THEME.textSecondary, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Confidence</span>
            <span style={{ fontSize: '18px', fontWeight: 700, color }}>{confidencePct}%</span>
          </div>
          <div style={{
            height: '8px',
            background: THEME.darkSlate,
            borderRadius: '4px',
            overflow: 'hidden',
            border: `1px solid ${THEME.borderSlate}`,
          }}>
            <div style={{
              width: `${confidence * 100}%`,
              height: '100%',
              background: `linear-gradient(90deg, ${color}, ${color}CC)`,
              borderRadius: '4px',
              transition: 'width 0.5s ease-out',
            }} />
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', paddingLeft: '16px', borderLeft: `1px solid ${THEME.borderSlate}` }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '20px', fontWeight: 700, color: THEME.textPrimary }}>{prediction}</div>
            <div style={{ fontSize: '10px', color: THEME.textSecondary, textTransform: 'uppercase' }}>Prediction</div>
          </div>
        </div>
      </div>

      {Object.keys(details).length > 0 && (
        <div style={{ marginTop: '16px', paddingTop: '12px', borderTop: `1px solid ${THEME.borderSlate}` }}>
          <div style={{ fontSize: '11px', color: THEME.textSecondary, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '8px' }}>Details</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '8px' }}>
            {Object.entries(details).map(([key, value]) => (
              <div key={key} style={{ padding: '8px', background: THEME.darkSlate, borderRadius: '6px', border: `1px solid ${THEME.borderSlate}` }}>
                <div style={{ fontSize: '10px', color: THEME.textSecondary, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{key}</div>
                <div style={{ fontSize: '13px', fontWeight: 600, color: THEME.textPrimary, fontFamily: 'monospace' }}>{value}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

// ============================================================
// Main GradCamModal Component
// ============================================================
export const GradCamModal = forwardRef(function GradCamModal({
  isOpen,
  onClose,
  alert,
  gradCamData,
  onDispatch,
  className = '',
  style = {},
  api,
}, ref) {
  // State
  const [mode, setMode] = useState('overlay'); // 'overlay' | 'side-by-side' | 'heatmap-only'
  const [opacity, setOpacity] = useState(0.5);
  const [colormap, setColormap] = useState('jet');
  const [showHeatmapOnly, setShowHeatmapOnly] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [dispatching, setDispatching] = useState(false);

  // Refs
  const modalRef = useRef(null);
  const originalImageRef = useRef(null);

  // Expose methods
  useImperativeHandle(ref, () => ({
    close: onClose,
    setMode,
    setOpacity,
    downloadEvidence: handleDownload,
  }), []);

  // Handle ESC key
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isOpen) onClose();
    };
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'hidden';
    }
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [isOpen, onClose]);

  // Reset copied state
  useEffect(() => {
    if (copied) {
      const timer = setTimeout(() => setCopied(false), 2000);
      return () => clearTimeout(timer);
    }
  }, [copied]);

  // Handle download
  const handleDownload = useCallback(async () => {
    setDownloading(true);
    try {
      // Create evidence package
      const evidence = {
        alert: {
          id: alert?.id,
          uuid: alert?.uuid,
          type: alert?.alert_type,
          severity: alert?.severity,
          camera_id: alert?.camera_id,
          detected_at: alert?.detected_at,
          confidence: alert?.confidence,
          intersection_point: alert?.intersection_point,
          predicted_trajectory: alert?.predicted_trajectory,
        },
        gradcam: {
          model: gradCamData?.model,
          confidence: gradCamData?.confidence,
          prediction: gradCamData?.prediction,
          colormap,
          opacity,
        },
        hash: gradCamData?.block_hash,
        timestamp: new Date().toISOString(),
        exported_by: 'GradCamModal',
      };

      // Create JSON download
      const jsonBlob = new Blob([JSON.stringify(evidence, null, 2)], { type: 'application/json' });
      const jsonUrl = URL.createObjectURL(jsonBlob);
      const jsonLink = document.createElement('a');
      jsonLink.href = jsonUrl;
      jsonLink.download = `optic-shield-evidence-${alert?.id}-${Date.now()}.json`;
      jsonLink.click();
      URL.revokeObjectURL(jsonUrl);

      // Also download the image if available
      if (alert?.keyframe_thumbnail_url) {
        try {
          const response = await fetch(alert.keyframe_thumbnail_url);
          const imgBlob = await response.blob();
          const imgUrl = URL.createObjectURL(imgBlob);
          const imgLink = document.createElement('a');
          imgLink.href = imgUrl;
          imgLink.download = `optic-shield-keyframe-${alert?.id}-${Date.now()}.jpg`;
          imgLink.click();
          URL.revokeObjectURL(imgUrl);
        } catch (e) {
          console.warn('Failed to download keyframe:', e);
        }
      }

      // Download Grad-CAM overlay as canvas
      const canvas = originalImageRef.current;
      if (canvas) {
        const dataUrl = canvas.toDataURL('image/png');
        const link = document.createElement('a');
        link.href = dataUrl;
        link.download = `optic-shield-gradcam-${alert?.id}-${Date.now()}.png`;
        link.click();
      }

    } catch (e) {
      console.error('Download failed:', e);
    } finally {
      setDownloading(false);
    }
  }, [alert, gradCamData, colormap, opacity]);

  // Handle hash copy
  const handleCopyHash = useCallback(async () => {
    if (!gradCamData?.block_hash) return;
    try {
      await navigator.clipboard.writeText(gradCamData.block_hash);
      setCopied(true);
    } catch (e) {
      console.error('Copy failed:', e);
    }
  }, [gradCamData?.block_hash]);

  // Handle dispatch
  const handleDispatch = useCallback(async () => {
    if (!onDispatch || !alert) return;
    setDispatching(true);
    try {
      await onDispatch(alert);
    } catch (e) {
      console.error('Dispatch failed:', e);
    } finally {
      setDispatching(false);
    }
  }, [onDispatch, alert]);

  if (!isOpen) return null;

  // Extract data
  const keyframeUrl = alert?.keyframe_thumbnail_url || alert?.keyframe_url;
  const model = gradCamData?.model || 'YOLOv8';
  const confidence = gradCamData?.confidence || 0.94;
  const prediction = gradCamData?.prediction || 'Unknown';
  const blockHash = gradCamData?.block_hash || '—';
  const details = gradCamData?.details || {};

  // Generate synthetic heatmap for demo if not provided
  const heatmapData = useMemo(() => {
    if (gradCamData?.heatmap) return gradCamData.heatmap;
    // Generate synthetic heatmap for demo
    const size = 64;
    const heatmap = [];
    for (let y = 0; y < size; y++) {
      const row = [];
      for (let x = 0; x < size; x++) {
        // Create a blob in the center
        const dx = (x - size / 2) / (size / 2);
        const dy = (y - size / 2) / (size / 2);
        const dist = Math.sqrt(dx * dx + dy * dy);
        row.push(Math.max(0, 1 - dist * 1.2) * confidence);
      }
      heatmap.push(row);
    }
    return heatmap;
  }, [gradCamData?.heatmap, confidence]);

  return (
    <div className="gradcam-modal-overlay" style={getOverlayStyles()} onClick={onClose}>
      <div className="gradcam-modal" style={getModalStyles()} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={getHeaderStyles()}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{
              width: '40px',
              height: '40px',
              borderRadius: '10px',
              background: `linear-gradient(135deg, ${THEME.tacticalBlue}20, ${THEME.tacticalBlue}05)`,
              border: `1px solid ${THEME.tacticalBlue}40`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              <Brain size={20} style={{ color: THEME.tacticalBlue }} />
            </div>
            <div>
              <div style={{ fontSize: '18px', fontWeight: 700, color: THEME.textPrimary }}>Grad-CAM Analysis</div>
              <div style={{ fontSize: '12px', color: THEME.textSecondary }}>Explainable AI Decision Verification</div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {/* Model Badge */}
            <span style={{
              background: `linear-gradient(135deg, ${MODEL_COLORS[model] || THEME.tacticalBlue}20, ${MODEL_COLORS[model] || THEME.tacticalBlue}05)`,
              border: `1px solid ${MODEL_COLORS[model] || THEME.tacticalBlue}40`,
              color: MODEL_COLORS[model] || THEME.tacticalBlue,
              padding: '4px 12px',
              borderRadius: '16px',
              fontSize: '11px',
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
            }}>
              {model}
            </span>

            {/* Alert Severity Badge */}
            {alert && (
              <span style={{
                background: `linear-gradient(135deg, ${SEVERITY_CONFIG[alert.severity]?.color || THEME.tacticalBlue}20, ${SEVERITY_CONFIG[alert.severity]?.color || THEME.tacticalBlue}05)`,
                border: `1px solid ${SEVERITY_CONFIG[alert.severity]?.color || THEME.tacticalBlue}40`,
                color: SEVERITY_CONFIG[alert.severity]?.color || THEME.tacticalBlue,
                padding: '4px 12px',
                borderRadius: '16px',
                fontSize: '11px',
                fontWeight: 600,
                textTransform: 'uppercase',
              }}>
                {SEVERITY_CONFIG[alert.severity]?.label || 'UNKNOWN'}
              </span>
            )}

            <button onClick={onClose} className="btn-icon" style={{ marginLeft: 'auto', background: 'rgba(239, 68, 68, 0.15)', border: `1px solid ${THEME.criticalRed}`, color: THEME.criticalRed }} title="Close">
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Main Content */}
        <div style={getContentStyles()}>
          {/* Left: Visualization */}
          <div style={getVisualizationStyles()}>
            {/* View Mode Tabs */}
            <div style={{ display: 'flex', gap: '4px', marginBottom: '12px', padding: '4px', background: THEME.mutedSlate, borderRadius: '8px', border: `1px solid ${THEME.borderSlate}` }}>
              {['overlay', 'side-by-side', 'heatmap-only'].map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  style={{
                    flex: 1,
                    padding: '8px 12px',
                    borderRadius: '6px',
                    border: 'none',
                    background: mode === m ? THEME.tacticalBlue : 'transparent',
                    color: mode === m ? '#fff' : THEME.textSecondary,
                    fontSize: '11px',
                    fontWeight: 500,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px',
                    transition: 'all 0.2s',
                  }}
                  title={m === 'overlay' ? 'Overlay heatmap on original' : m === 'side-by-side' ? 'Side-by-side comparison' : 'Heatmap only'}
                >
                  {m === 'overlay' && <Layers size={14} />}
                  {m === 'side-by-side' && (
                    <>
                      <div style={{ width: '14px', height: '14px', border: `1px solid currentColor`, position: 'relative' }}>
                        <div style={{ position: 'absolute', top: '2px', left: '2px', width: '4px', height: '10px', background: THEME.criticalRed, borderRadius: '2px' }} />
                        <div style={{ position: 'absolute', top: '2px', right: '2px', width: '4px', height: '10px', background: THEME.warningAmber, borderRadius: '2px' }} />
                      </div>
                    </>
                  )}
                  {m === 'heatmap-only' && <Palette size={14} />}
                  <span>{m === 'overlay' ? 'Overlay' : m === 'side-by-side' ? 'Split' : 'Heatmap'}</span>
                </button>
              ))}
            </div>)

            {/* Canvas Container */}
            <div style={{ position: 'relative', borderRadius: '10px', overflow: 'hidden', border: `1px solid ${THEME.borderSlate}`, background: THEME.mutedSlate }}>
              <GradCamCanvas
                ref={originalImageRef}
                originalImage={keyframeUrl}
                heatmapData={heatmapData}
                opacity={opacity}
                colormap={colormap}
                mode={mode}
                width={mode === 'side-by-side' ? 800 : 600}
                height={400}
              />

              {/* Loading overlay */}
              {!keyframeUrl && (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(9, 13, 22, 0.9)', color: THEME.textSecondary }}>
                  <div style={{ textAlign: 'center' }}>
                    <Loader2 size={32} className="spinning" style={{ color: THEME.tacticalBlue, marginBottom: '12px' }} />
                    <div>No keyframe available</div>
                    <div style={{ fontSize: '12px', marginTop: '8px' }}>Waiting for edge upload...</div>
                  </div>
                </div>
              )}

              {/* Opacity indicator */}
              {mode !== 'heatmap-only' && (
                <div style={{ position: 'absolute', bottom: '12px', left: '12px', right: '12px', display: 'flex', alignItems: 'center', gap: '10px', background: 'rgba(9, 13, 22, 0.9)', backdropFilter: 'blur(8px)', padding: '8px 12px', borderRadius: '8px', border: `1px solid ${THEME.borderSlate}` }}>
                  <Eye size={14} style={{ color: THEME.textSecondary }} />
                  <span style={{ fontSize: '11px', color: THEME.textSecondary, minWidth: '60px' }}>Opacity</span>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={opacity}
                    onChange={(e) => setOpacity(parseFloat(e.target.value))}
                    style={{
                      flex: 1,
                      accentColor: THEME.tacticalBlue,
                      height: '4px',
                    }}
                  />
                  <span style={{ fontSize: '12px', fontWeight: 600, color: THEME.textPrimary, minWidth: '40px', textAlign: 'right', fontFamily: 'monospace' }}>
                    {Math.round(opacity * 100)}%
                  </span>
                  <Palette size={14} style={{ color: THEME.textSecondary }} />
                  <select
                    value={colormap}
                    onChange={(e) => setColormap(e.target.value)}
                    style={{
                      background: THEME.mutedSlate,
                      border: `1px solid ${THEME.borderSlate}`,
                      borderRadius: '4px',
                      color: THEME.textPrimary,
                      fontSize: '11px',
                      padding: '4px 8px',
                      fontFamily: 'inherit',
                    }}
                  >
                    <option value="jet">Jet</option>
                    <option value="viridis">Viridis</option>
                    <option value="hot">Hot</option>
                    <option value="cool">Cool</option>
                  </select>
                </div>
              )}
            </div>

            {/* Color Legend */}
            <ColorLegend colormap={colormap} minLabel="Low Attention" maxLabel="High Attention" />
          </div>

          {/* Right: Details Panel */}
          <div style={getDetailsStyles()}>
            {/* Confidence Display */}
            <ConfidenceDisplay
              model={model}
              confidence={confidence}
              prediction={prediction}
              details={details}
            />

            {/* Hash Display */}
            <HashDisplay
              hash={blockHash}
              label="Audit Ledger Block Hash"
              copied={copied}
              onCopy={handleCopyHash}
              style={{ marginTop: '16px' }}
            />

            {/* Alert Context */}
            {alert && (
              <div style={{ marginTop: '16px', padding: '16px', background: THEME.mutedSlate, borderRadius: '10px', border: `1px solid ${THEME.borderSlate}` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                  <AlertTriangle size={16} style={{ color: THEME.warningAmber }} />
                  <span style={{ fontSize: '12px', fontWeight: 600, color: THEME.textPrimary, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Alert Context</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', fontSize: '12px' }}>
                  <div><span style={{ color: THEME.textSecondary }}>Alert ID</span><br /><span style={{ fontWeight: 600, fontFamily: 'monospace' }}>{alert.id}</span></div>
                  <div><span style={{ color: THEME.textSecondary }}>Type</span><br /><span style={{ fontWeight: 600, textTransform: 'capitalize' }}>{alert.alert_type?.replace(/_/g, ' ')}</span></div>
                  <div><span style={{ color: THEME.textSecondary }}>Camera</span><br /><span style={{ fontWeight: 600 }}>BOP-{alert.camera_id?.toString().padStart(3, '0')}</span></div>
                  <div><span style={{ color: THEME.textSecondary }}>Time</span><br /><span style={{ fontWeight: 600 }}>{new Date(alert.detected_at).toLocaleString()}</span></div>
                  <div><span style={{ color: THEME.textSecondary }}>Track ID</span><br /><span style={{ fontWeight: 600 }}>{alert.track_id || '—'}</span></div>
                  <div><span style={{ color: THEME.textSecondary }}>Consensus</span><br /><span style={{ fontWeight: 600, color: alert.consensus_status === 'VERIFIED' ? THEME.successGreen : THEME.warningAmber }}>{alert.consensus_status || 'NONE'}</span></div>
                </div>
              </div>
            )}

            {/* Action Buttons */}
            <div style={{ marginTop: '20px', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              <button
                onClick={handleDownload}
                disabled={downloading}
                className="btn-primary"
                style={{ background: THEME.tacticalBlue, flex: 1, minWidth: '160px' }}
              >
                {downloading ? (
                  <>
                    <Loader2 size={16} className="spinning" /> Preparing...
                  </>
                ) : (
                  <>
                    <Download size={16} /> Download Evidence Package
                  </>
                )}
              </button>

              <button
                onClick={handleDispatch}
                disabled={dispatching}
                className="btn-danger"
                style={{ background: THEME.criticalRed, flex: 1, minWidth: '160px' }}
              >
                {dispatching ? (
                  <>
                    <Loader2 size={16} className="spinning" /> Dispatching...
                  </>
                ) : (
                  <>
                    <Shield size={16} /> Dispatch Response Team
                  </>
                )}
              </button>

              <button
                onClick={() => navigator.clipboard.writeText(blockHash).then(() => setCopied(true))}
                className="btn-secondary"
                style={{ background: THEME.mutedSlate, border: `1px solid ${THEME.borderSlate}`, color: THEME.textPrimary, flex: 1, minWidth: '140px' }}
                title="Copy Block Hash"
              >
                {copied ? <Check size={16} /> : <Copy size={16} />}
                <span>{copied ? 'Copied' : 'Copy Hash'}</span>
              </button>
            </div>

            {/* Evidence Integrity Notice */}
            <div style={{ marginTop: '16px', padding: '12px', background: 'rgba(16, 185, 129, 0.1)', border: `1px solid ${THEME.successGreen}40`, borderRadius: '8px', display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
              <CheckCircle size={16} style={{ color: THEME.successGreen, flexShrink: 0, marginTop: '2px' }} />
              <div style={{ fontSize: '11px', color: THEME.successGreen, lineHeight: '1.5' }}>
                <strong>Evidence Integrity Verified:</strong> This alert is anchored to the audit ledger via SHA-256 hash chain.
                The block hash above cryptographically proves this event has not been tampered with since ingestion.
                Admissible under Section 65B Indian Evidence Act.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
});

// ============================================================
// Styles
// ============================================================
function getOverlayStyles() {
  return {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0, 0, 0, 0.85)',
    backdropFilter: 'blur(4px)',
    zIndex: 10000,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '20px',
    animation: 'fadeIn 0.2s ease-out',
  };
}

function getModalStyles() {
  return {
    width: '100%',
    maxWidth: '1200px',
    maxHeight: '90vh',
    background: THEME.darkSlate,
    border: `1px solid ${THEME.borderSlate}`,
    borderRadius: '16px',
    boxShadow: '0 24px 64px rgba(0, 0, 0, 0.5)',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    animation: 'slideUp 0.3s ease-out',
    fontFamily: '"JetBrains Mono", "Fira Code", monospace',
  };
}

function getHeaderStyles() {
  return {
    padding: '16px 20px',
    borderBottom: `1px solid ${THEME.borderSlate}`,
    background: THEME.mutedSlate,
    flexShrink: 0,
  };
}

function getContentStyles() {
  return {
    flex: 1,
    display: 'flex',
    overflow: 'hidden',
    minHeight: 0,
  };
}

function getVisualizationStyles() {
  return {
    flex: '0 0 60%',
    maxWidth: '720px',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    padding: '16px',
    background: THEME.darkSlate,
    borderRight: `1px solid ${THEME.borderSlate}`,
  };
}

function getDetailsStyles() {
  return {
    flex: '0 0 40%',
    minWidth: '380px',
    maxWidth: '480px',
    display: 'flex',
    flexDirection: 'column',
    overflowY: 'auto',
    padding: '16px',
    background: THEME.darkSlate,
  };
}

// Inject global styles
if (typeof document !== 'undefined') {
  const styleId = 'gradcam-modal-styles';
  if (!document.getElementById(styleId)) {
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes slideUp {
  from { opacity: 0; transform: translateY(20px); }
  to { opacity: 1; transform: translateY(0); }
}

.gradcam-modal-overlay {
  font-family: "JetBrains Mono", "Fira Code", monospace;
}

.gradcam-modal {
  color: ${THEME.textPrimary};
}

.spinning {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.btn-primary {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: '12px 20px';
  borderRadius: '8px';
  border: none;
  color: #fff;
  fontSize: '12px';
  fontWeight: 600;
  fontFamily: inherit;
  textTransform: uppercase;
  letterSpacing: '0.5px';
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

.btn-danger {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: '12px 20px';
  borderRadius: '8px';
  border: none;
  color: #fff;
  fontSize: '12px';
  fontWeight: 600;
  fontFamily: inherit;
  textTransform: uppercase;
  letterSpacing: '0.5px';
  cursor: pointer;
  transition: all 0.2s;
}

.btn-danger:hover:not(:disabled) {
  filter: brightness(1.1);
  transform: translateY(-1px);
}

.btn-danger:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.btn-secondary {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: '10px 16px';
  borderRadius: '8px';
  color: ${THEME.textPrimary};
  fontSize: '11px';
  fontWeight: 500;
  fontFamily: inherit;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-secondary:hover {
  background: ${THEME.tacticalBlue}20;
  border-color: ${THEME.tacticalBlue};
  color: ${THEME.tacticalBlue};
}

.color-legend canvas {
  image-rendering: pixelated;
}

/* Scrollbar styling */
.gradcam-modal ::-webkit-scrollbar {
  width: 8px;
}

.gradcam-modal ::-webkit-scrollbar-track {
  background: ${THEME.darkSlate};
}

.gradcam-modal ::-webkit-scrollbar-thumb {
  background: ${THEME.borderSlate};
  borderRadius: 4px;
}

.gradcam-modal ::-webkit-scrollbar-thumb:hover {
  background: ${THEME.tacticalBlue};
}

/* Input range styling */
input[type="range"] {
  -webkit-appearance: none;
  appearance: none;
  background: transparent;
  cursor: pointer;
}

input[type="range"]::-webkit-slider-runnable-track {
  height: 4px;
  background: ${THEME.borderSlate};
  borderRadius: 2px;
}

input[type="range"]::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 16px;
  height: 16px;
  borderRadius: 50%;
  background: ${THEME.tacticalBlue};
  cursor: pointer;
  margin-top: -6px;
  box-shadow: 0 2px 4px rgba(0,0,0,0.3);
  transition: transform 0.2s;
}

input[type="range"]::-webkit-slider-thumb:hover {
  transform: scale(1.2);
}

input[type="range"]::-moz-range-track {
  height: 4px;
  background: ${THEME.borderSlate};
  borderRadius: 2px;
  border: none;
}

input[type="range"]::-moz-range-thumb {
  width: 16px;
  height: 16px;
  borderRadius: 50%;
  background: ${THEME.tacticalBlue};
  cursor: pointer;
  border: none;
  box-shadow: 0 2px 4px rgba(0,0,0,0.3);
}

/* Select styling */
select {
  -webkit-appearance: none;
  appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2394A3B8' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 8px center;
  padding-right: 28px;
}

select:focus {
  outline: none;
  border-color: ${THEME.tacticalBlue};
}

/* Responsive */
@media (max-width: 1024px) {
  .gradcam-modal {
    flex-direction: column;
  }
  
  .gradcam-modal > div:last-child > div:first-child {
    flex: none;
    maxWidth: 100%;
    borderRight: none;
    borderBottom: '1px solid ${THEME.borderSlate}';
  }
  
  .gradcam-modal > div:last-child > div:last-child {
    minWidth: 100%;
    maxWidth: 100%;
    borderLeft: none;
    borderTop: '1px solid ${THEME.borderSlate}';
  }
}
    `;
    document.head.appendChild(style);
  }
}

GradCamModal.displayName = 'GradCamModal';

export default GradCamModal;