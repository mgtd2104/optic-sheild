/**
 * Optic Shield — Tactical Feed & Frame Analysis Panel
 * 
 * Real-time video analysis with frame-by-frame object detection.
 * Features:
 * - Video file upload with drag-and-drop
 * - Live webcam capture toggle
 * - Canvas overlay with bounding boxes, track IDs, labels
 * - Real-time detection counts (persons, vehicles, license plates)
 * - Sequential frame analysis via POST /api/v1/analyze-frame
 */

import React, {
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
} from 'react';
import {
  Upload,
  Video,
  VideoOff,
  Camera,
  Play,
  Pause,
  StopCircle,
  Trash2,
  Eye,
  EyeOff,
  Settings,
  Zap,
  Target,
  Loader2,
  AlertTriangle,
  CheckCircle,
  XCircle,
  ChevronDown,
  ChevronUp,
  Maximize2,
  Minimize2,
} from 'lucide-react';
import api from '../services/api';

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

// Class colors for bounding boxes
const CLASS_COLORS = {
  person: '#EF4444',       // Critical Red
  vehicle: '#3B82F6',      // Tactical Blue
  'license-plate': '#F59E0B', // Warning Amber
  truck: '#8B5CF6',        // Purple
  bus: '#EC4899',          // Pink
  motorcycle: '#06B6D4',   // Cyan
  bicycle: '#84CC16',      // Lime
  default: '#6B7280',      // Gray
};

// Detection class labels
const CLASS_LABELS = {
  person: 'PERSON',
  vehicle: 'VEHICLE',
  'license-plate': 'LICENSE PLATE',
  truck: 'TRUCK',
  bus: 'BUS',
  motorcycle: 'MOTORCYCLE',
  bicycle: 'BICYCLE',
};

// Category mapping for metric cards (lowercase keys for standardized comparison)
const CATEGORY_MAP = {
  person: 'persons',
  vehicle: 'vehicles',
  truck: 'trucks',
  bus: 'buses',
  motorcycle: 'motorcycles',
  bicycle: 'bicycles',
  'license-plate': 'license_plates',
  plate: 'license_plates',
  car: 'vehicles',
};

// ============================================================
// Utility Functions
// ============================================================

/**
 * Extract class/label from detection object supporting multiple field names
 * @param {Object} det - Detection object
 * @returns {string} Normalized lowercase class name
 */
function getDetectionClass(det) {
  if (!det) return '';
  // Support multiple possible field names from different API versions
  const raw = det.label ?? det.class ?? det.class_name ?? det.category ?? det.type ?? '';
  return String(raw).toLowerCase().trim();
}

/**
 * Get display label for a detection (e.g., "PERSON", "VEHICLE")
 * @param {Object} det - Detection object
 * @returns {string} Display label
 */
function getDetectionLabel(det) {
  const className = getDetectionClass(det);
  return CLASS_LABELS[className] || className.toUpperCase();
}

/**
 * Get category key for metrics aggregation
 * @param {Object} det - Detection object
 * @returns {string|null} Category key or null if unknown
 */
function getDetectionCategory(det) {
  if (!det) return null;
  
  // Check backend's category field first (plural: 'persons', 'vehicles', 'trucks', etc.)
  if (det.category) {
    const cat = String(det.category).toLowerCase().trim();
    // Direct match for plural category values from backend
    const validCategories = ['persons', 'vehicles', 'trucks', 'buses', 'motorcycles', 'bicycles', 'license_plates'];
    if (validCategories.includes(cat)) {
      return cat;
    }
  }
  
  // Fallback: check label/class_name/class/type (singular: 'person', 'vehicle', 'truck', 'car', etc.)
  const className = getDetectionClass(det);
  return CATEGORY_MAP[className] || null;
}

function getClassColor(className) {
  const key = (className || '').toLowerCase();
  return CLASS_COLORS[key] || CLASS_COLORS.default;
}

function getClassLabel(className) {
  const key = (className || '').toLowerCase();
  return CLASS_LABELS[key] || (className || '').toUpperCase();
}

function formatTimestamp(ms) {
  const date = new Date(ms);
  return date.toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

// ============================================================
// Dropzone Component
// ============================================================
const Dropzone = ({ onFileSelect, onFilePicked, isDragActive, isAnalyzing, disabled }) => {
  const inputRef = useRef(null);
  
  const handleDrag = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!disabled && !isAnalyzing) {
      onFileSelect(e.type === 'dragover' || e.type === 'dragenter');
    }
  }, [disabled, isAnalyzing, onFileSelect]);
  
  const handleDrop = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    onFileSelect(false);
    if (!disabled && !isAnalyzing && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      if (file.type.startsWith('video/')) {
        onFilePicked(file);
      }
    }
  }, [disabled, isAnalyzing, onFilePicked]);
  
  const handleFileChange = useCallback((e) => {
    if (e.target.files.length > 0) {
      const file = e.target.files[0];
      if (file.type.startsWith('video/')) {
        onFilePicked(file);
      }
      // Reset input so same file can be selected again
      e.target.value = '';
    }
  }, [onFilePicked]);
  
  const triggerFileInput = useCallback(() => {
    inputRef.current?.click();
  }, []);
  
  return (
    <div
      onDragOver={handleDrag}
      onDragEnter={handleDrag}
      onDragLeave={handleDrag}
      onDrop={handleDrop}
      style={{
        ...dropzoneStyle,
        borderColor: isDragActive ? THEME.tacticalBlue : (disabled ? THEME.borderSlate : THEME.borderSlate),
        background: isDragActive ? 'rgba(59, 130, 246, 0.1)' : (disabled ? THEME.darkSlate : THEME.mutedSlate),
        opacity: disabled ? 0.6 : 1,
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept="video/*"
        onChange={handleFileChange}
        style={{ display: 'none' }}
        disabled={disabled || isAnalyzing}
      />
      <div style={dropzoneContentStyle}>
        <Upload size={48} style={{ color: isDragActive ? THEME.tacticalBlue : THEME.textMuted, marginBottom: '12px' }} />
        <div style={{ fontSize: '14px', fontWeight: 600, color: THEME.textPrimary, marginBottom: '4px' }}>
          {isDragActive ? 'Drop Video File Here' : 'Drag & Drop Video File'}
        </div>
        <div style={{ fontSize: '12px', color: THEME.textSecondary }}>
          Supports: MP4, WebM, MOV, AVI (Max 500MB)
        </div>
        {isAnalyzing && (
          <div style={{ marginTop: '16px', display: 'flex', alignItems: 'center', gap: '8px', color: THEME.tacticalBlue }}>
            <Loader2 size={20} className="spinning" />
            <span style={{ fontSize: '13px', fontWeight: 500 }}>Analyzing frames...</span>
          </div>
        )}
      </div>
    </div>
  );
};

const dropzoneStyle = {
  border: '2px dashed',
  borderRadius: '12px',
  padding: '32px 24px',
  textAlign: 'center',
  transition: 'all 0.2s ease',
  minHeight: '200px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const dropzoneContentStyle = {
  pointerEvents: 'none',
};

// ============================================================
// Webcam Feed Component
// ============================================================
const WebcamFeed = ({ 
  isActive, 
  onFrameCapture, 
  frameInterval = 1000,
  videoRef 
}) => {
  const [stream, setStream] = useState(null);
  const [error, setError] = useState(null);
  const intervalRef = useRef(null);
  const canvasRef = useRef(null);
  
  useEffect(() => {
    if (isActive) {
      navigator.mediaDevices.getUserMedia({ 
        video: { 
          facingMode: 'environment',
          width: { ideal: 1280 },
          height: { ideal: 720 },
        } 
      })
        .then(setStream)
        .catch((err) => {
          console.error('Webcam access denied:', err);
          setError('Camera access denied. Please check permissions.');
        });
    } else {
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
        setStream(null);
      }
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }
    return () => {
      if (stream) stream.getTracks().forEach(track => track.stop());
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isActive]);
  
  // Capture frames at interval
  useEffect(() => {
    if (!isActive || !stream || !videoRef.current || !onFrameCapture) return;
    
    const video = videoRef.current;
    const canvas = canvasRef.current || document.createElement('canvas');
    canvasRef.current = canvas;
    const ctx = canvas.getContext('2d');
    
    const captureFrame = () => {
      if (video.readyState === video.HAVE_ENOUGH_DATA) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0);
        canvas.toBlob((blob) => {
          if (blob) {
            const file = new File([blob], `frame-${Date.now()}.jpg`, { type: 'image/jpeg' });
            onFrameCapture(file);
          }
        }, 'image/jpeg', 0.8);
      }
    };
    
    intervalRef.current = setInterval(captureFrame, frameInterval);
    captureFrame(); // Initial capture
    
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isActive, stream, onFrameCapture, frameInterval, videoRef]);
  
  if (error) {
    return (
      <div style={{ ...webcamPlaceholderStyle, background: 'rgba(239, 68, 68, 0.1)', borderColor: THEME.criticalRed }}>
        <AlertTriangle size={48} style={{ color: THEME.criticalRed, marginBottom: '12px' }} />
        <div style={{ fontSize: '14px', fontWeight: 600, color: THEME.criticalRed, marginBottom: '4px' }}>
          Camera Unavailable
        </div>
        <div style={{ fontSize: '12px', color: THEME.textSecondary }}>{error}</div>
      </div>
    );
  }
  
  if (!isActive) {
    return (
      <div style={webcamPlaceholderStyle}>
        <VideoOff size={48} style={{ color: THEME.textMuted, marginBottom: '12px' }} />
        <div style={{ fontSize: '14px', fontWeight: 600, color: THEME.textSecondary, marginBottom: '4px' }}>
          Webcam Inactive
        </div>
        <div style={{ fontSize: '12px', color: THEME.textMuted }}>Toggle to start live capture</div>
      </div>
    );
  }
  
  return (
    <div style={webcamContainerStyle}>
      <video
        ref={(el) => {
          videoRef.current = el;
          if (el && stream) {
            el.srcObject = stream;
          }
        }}
        autoPlay
        playsInline
        muted
        style={videoStyle}
      />
      <canvas ref={canvasRef} style={{ display: 'none' }} />
    </div>
  );
};

const webcamContainerStyle = {
  position: 'relative',
  width: '100%',
  height: '100%',
  minHeight: '360px',
  background: THEME.darkSlate,
  borderRadius: '8px',
  overflow: 'hidden',
};

const videoStyle = {
  width: '100%',
  height: '100%',
  objectFit: 'contain',
  background: THEME.darkSlate,
};

const webcamPlaceholderStyle = {
  width: '100%',
  height: '100%',
  minHeight: '360px',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  background: THEME.mutedSlate,
  border: `1px solid ${THEME.borderSlate}`,
  borderRadius: '8px',
  padding: '24px',
  textAlign: 'center',
};

// ============================================================
// Detection Overlay Canvas
// ============================================================
const DetectionOverlay = ({ 
  videoElement, 
  detections, 
  videoWidth, 
  videoHeight,
  showLabels = true,
  showConfidence = true,
  showTrackIds = true,
}) => {
  const canvasRef = useRef(null);
  const animationRef = useRef(null);
  
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !videoElement) return;
    
    const ctx = canvas.getContext('2d');
    
    const draw = () => {
      // Match canvas size to video display size
      const rect = videoElement.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      ctx.scale(dpr, dpr);
      
      // Clear
      ctx.clearRect(0, 0, rect.width, rect.height);
      
      // Calculate scale factors
      const scaleX = rect.width / (videoWidth || rect.width);
      const scaleY = rect.height / (videoHeight || rect.height);
      
      // Draw detections
      detections.forEach((det) => {
        const { bbox, track_id, confidence } = det;
        if (!bbox || bbox.length !== 4) return;
        
        // Use robust detection class extraction supporting multiple field names
        const safeClassName = getDetectionClass(det);
        const classLabel = getDetectionLabel(det);
        const safeTrackId = track_id;
        const safeConfidence = confidence;
        
        const [x1, y1, x2, y2] = bbox;
        const x = x1 * scaleX;
        const y = y1 * scaleY;
        const w = (x2 - x1) * scaleX;
        const h = (y2 - y1) * scaleY;
        
        const color = getClassColor(safeClassName);
        
        // Bounding box
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.strokeRect(x, y, w, h);
        
        // Background for label
        if (showLabels) {
          const trackPart = showTrackIds && safeTrackId ? ` #${safeTrackId}` : '';
          const confPart = showConfidence && safeConfidence ? ` (${Math.round(safeConfidence * 100)}%)` : '';
          const label = `${classLabel}${trackPart}${confPart}`;
          ctx.font = '11px "JetBrains Mono", monospace';
          const textWidth = ctx.measureText(label).width;
          const padding = 6;
          
          // Label background
          ctx.fillStyle = color;
          ctx.fillRect(x, y - 22, textWidth + padding * 2, 20);
          
          // Label text
          ctx.fillStyle = '#FFFFFF';
          ctx.fillText(label, x + padding, y - 6);
        }
        
        // Track ID indicator dot
        if (safeTrackId) {
          ctx.beginPath();
          ctx.arc(x + 4, y + 4, 4, 0, Math.PI * 2);
          ctx.fillStyle = color;
          ctx.fill();
          ctx.fillStyle = '#FFFFFF';
          ctx.font = '8px monospace';
          ctx.textAlign = 'center';
          ctx.fillText(String(safeTrackId), x + 4, y + 6);
        }
      });
      
      animationRef.current = requestAnimationFrame(draw);
    };
    
    animationRef.current = requestAnimationFrame(draw);
    
    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [videoElement, detections, videoWidth, videoHeight, showLabels, showConfidence, showTrackIds]);
  
  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        pointerEvents: 'none',
        zIndex: 10,
      }}
    />
  );
};

// ============================================================
// Video Player with Analysis
// ============================================================
const VideoAnalyzer = ({ 
  videoFile, 
  onFrameCapture,
  frameInterval = 1000,
  isPlaying,
  currentTime,
  duration,
  onSeek,
  onPlayPause,
  onStop,
  onVideoEnded,
  onSeekBack,
}) => {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const intervalRef = useRef(null);
  const blobUrlRef = useRef(null); // Store blob URL to prevent premature revocation
  const [videoReady, setVideoReady] = useState(false);
  const [videoDims, setVideoDims] = useState({ width: 0, height: 0 });
  
  useEffect(() => {
    if (videoFile && videoRef.current) {
      // Revoke previous blob URL if exists
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
      }
      
      // Create new blob URL and store in ref
      const url = URL.createObjectURL(videoFile);
      blobUrlRef.current = url;
      videoRef.current.src = url;
      videoRef.current.load();
    }
    
    // Cleanup on unmount only
    return () => {
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
    };
  }, [videoFile]);
  
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    
    const handleLoadedMetadata = () => {
      setVideoDims({ width: video.videoWidth, height: video.videoHeight });
      setVideoReady(true);
      // Auto-play after metadata loads
      if (isPlaying) {
        video.play().catch(err => console.warn('Auto-play prevented:', err));
      }
    };
    
    // Track time updates to detect seek back
    const handleTimeUpdate = () => {
      const currentTime = video.currentTime;
      if (currentTime < previousTimeRef.current - 0.5) { // Seek back detected (allowing 0.5s tolerance)
        onSeekBack?.();
      }
      previousTimeRef.current = currentTime;
    };
    
    const handleEnded = () => {
      onVideoEnded?.();
    };
    
    video.addEventListener('loadedmetadata', handleLoadedMetadata);
    video.addEventListener('timeupdate', handleTimeUpdate);
    video.addEventListener('ended', handleEnded);
    
    return () => {
      video.removeEventListener('loadedmetadata', handleLoadedMetadata);
      video.removeEventListener('timeupdate', handleTimeUpdate);
      video.removeEventListener('ended', handleEnded);
    };
  }, [isPlaying, onVideoEnded, onSeekBack]);
  
  // Frame capture interval
  useEffect(() => {
    if (!isPlaying || !videoReady || !videoRef.current || !onFrameCapture) return;
    
    const captureFrame = () => {
      const video = videoRef.current;
      const canvas = canvasRef.current || document.createElement('canvas');
      canvasRef.current = canvas;
      const ctx = canvas.getContext('2d');
      
      if (video.readyState === video.HAVE_ENOUGH_DATA) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0);
        canvas.toBlob((blob) => {
          if (blob) {
            const file = new File([blob], `frame-${Date.now()}.jpg`, { type: 'image/jpeg' });
            onFrameCapture(file);
          }
        }, 'image/jpeg', 0.8);
      }
    };
    
    intervalRef.current = setInterval(captureFrame, frameInterval);
    captureFrame(); // Initial
    
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isPlaying, videoReady, onFrameCapture, frameInterval]);
  
  const handleTimeUpdate = () => {
    if (videoRef.current) {
      onSeek(videoRef.current.currentTime);
    }
  };
  
  const handleEnded = () => {
    onPlayPause(false);
  };
  
  if (!videoFile) {
    return (
      <div style={videoPlaceholderStyle}>
        <Video size={48} style={{ color: THEME.textMuted, marginBottom: '12px' }} />
        <div style={{ fontSize: '14px', fontWeight: 600, color: THEME.textSecondary, marginBottom: '4px' }}>
          No Video Loaded
        </div>
        <div style={{ fontSize: '12px', color: THEME.textMuted }}>Upload a video file to begin analysis</div>
      </div>
    );
  }
  
  return (
    <div style={videoContainerStyle}>
      <video
        ref={videoRef}
        onEnded={handleEnded}
        style={videoStyle}
      >
        Your browser does not support the video tag.
      </video>
      <canvas ref={canvasRef} style={{ display: 'none' }} />
      
      {videoReady && (
        <div style={controlsStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1 }}>
            <button
              onClick={() => onPlayPause(!isPlaying)}
              disabled={!videoReady}
              style={controlButtonStyle}
              title={isPlaying ? 'Pause' : 'Play'}
            >
              {isPlaying ? <Pause size={20} /> : <Play size={20} />}
            </button>
            <button
              onClick={onStop}
              style={controlButtonStyle}
              title="Stop"
            >
              <StopCircle size={20} />
            </button>
            
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '8px' }}>
              <input
                type="range"
                min={0}
                max={duration || 100}
                value={currentTime || 0}
                onChange={(e) => onSeek(Number(e.target.value))}
                style={{
                  flex: 1,
                  height: '6px',
                  appearance: 'none',
                  background: THEME.borderSlate,
                  borderRadius: '3px',
                  outline: 'none',
                  cursor: 'pointer',
                }}
              />
              <span style={{ 
                fontSize: '11px', 
                color: THEME.textSecondary, 
                fontFamily: 'monospace',
                minWidth: '100px',
                textAlign: 'right'
              }}>
                {formatTimestamp((currentTime || 0) * 1000)} / {formatTimestamp((duration || 0) * 1000)}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const videoContainerStyle = {
  position: 'relative',
  width: '100%',
  height: '100%',
  minHeight: '360px',
  background: THEME.darkSlate,
  borderRadius: '8px',
  overflow: 'hidden',
};

const controlsStyle = {
  position: 'absolute',
  bottom: 0,
  left: 0,
  right: 0,
  padding: '12px',
  background: 'linear-gradient(transparent, rgba(9, 13, 22, 0.95))',
  display: 'flex',
  alignItems: 'center',
  gap: '12px',
};

const controlButtonStyle = {
  width: '36px',
  height: '36px',
  borderRadius: '8px',
  border: `1px solid ${THEME.borderSlate}`,
  background: THEME.mutedSlate,
  color: THEME.textPrimary,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
  transition: 'all 0.2s',
};

const videoPlaceholderStyle = {
  width: '100%',
  height: '100%',
  minHeight: '360px',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  background: THEME.mutedSlate,
  border: `1px solid ${THEME.borderSlate}`,
  borderRadius: '8px',
  padding: '24px',
  textAlign: 'center',
};

// ============================================================
// Detection Stats Panel
// ============================================================
const DetectionStats = ({ uniqueCounts, totalFrames, processingTime }) => {
  // Use pre-computed unique counts from tracked objects
  const stats = uniqueCounts || {
    persons: 0,
    vehicles: 0,
    trucks: 0,
    buses: 0,
    motorcycles: 0,
    bicycles: 0,
    license_plates: 0,
    total: 0,
  };
  
  const statItems = [
    { key: 'persons', label: 'PERSONS', icon: '👤', color: CLASS_COLORS.person },
    { key: 'vehicles', label: 'VEHICLES', icon: '🚗', color: CLASS_COLORS.vehicle },
    { key: 'trucks', label: 'TRUCKS', icon: '🚛', color: CLASS_COLORS.truck },
    { key: 'buses', label: 'BUSES', icon: '🚌', color: CLASS_COLORS.bus },
    { key: 'motorcycles', label: 'MOTORCYCLES', icon: '🏍️', color: CLASS_COLORS.motorcycle },
    { key: 'bicycles', label: 'BICYCLES', icon: '🚲', color: CLASS_COLORS.bicycle },
    { key: 'license_plates', label: 'LICENSE PLATES', icon: '📋', color: CLASS_COLORS['license-plate'] },
  ];
  
  return (
    <div style={statsContainerStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <span style={{ fontSize: '12px', fontWeight: 600, color: THEME.textPrimary, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          DETECTION COUNTS
        </span>
        <span style={{ fontSize: '11px', color: THEME.textSecondary }}>
          {totalFrames} frames analyzed
        </span>
      </div>
      
      <div style={statsGridStyle}>
        {statItems.map(({ key, label, color }) => (
          <div key={key} style={statItemStyle}>
            <div style={{ 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'space-between',
              marginBottom: '4px'
            }}>
              <span style={{ fontSize: '10px', color: THEME.textSecondary, textTransform: 'uppercase' }}>
                {label}
              </span>
              <div style={{
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                background: color,
                boxShadow: `0 0 8px ${color}`,
              }} />
            </div>
            <div style={{ 
              fontSize: '24px', 
              fontWeight: 700, 
              color: THEME.textPrimary,
              fontFamily: 'monospace',
              lineHeight: 1,
            }}>
              {stats[key] || 0}
            </div>
          </div>
        ))}
        
        {/* Total */}
        <div style={{ ...statItemStyle, borderLeft: `3px solid ${THEME.tacticalBlue}` }}>
          <div style={{ 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'space-between',
            marginBottom: '4px'
          }}>
            <span style={{ fontSize: '10px', color: THEME.tacticalBlue, fontWeight: 600, textTransform: 'uppercase' }}>
              TOTAL
            </span>
            <Target size={12} style={{ color: THEME.tacticalBlue }} />
          </div>
          <div style={{ 
            fontSize: '24px', 
            fontWeight: 700, 
            color: THEME.tacticalBlue,
            fontFamily: 'monospace',
            lineHeight: 1,
          }}>
            {stats.total || 0}
          </div>
        </div>
      </div>
      
      {processingTime && (
        <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: `1px solid ${THEME.borderSlate}` }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: THEME.textSecondary }}>
            <span>Avg Processing Time</span>
            <span style={{ color: THEME.textPrimary, fontFamily: 'monospace', fontWeight: 600 }}>
              {processingTime.toFixed(1)}ms
            </span>
          </div>
        </div>
      )}
    </div>
  );
};

const statsContainerStyle = {
  background: THEME.mutedSlate,
  border: `1px solid ${THEME.borderSlate}`,
  borderRadius: '12px',
  padding: '16px',
};

const statsGridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))',
  gap: '12px',
};

const statItemStyle = {
  padding: '8px',
  background: THEME.darkSlate,
  borderRadius: '8px',
  border: `1px solid ${THEME.borderSlate}`,
};

// ============================================================
// Detection Log (Recent Detections - Deduplicated by track_id)
// ============================================================
const DetectionLog = ({ detections, maxItems = 10 }) => {
  // Deduplicate by track_id: keep only the latest detection for each unique track_id
  const uniqueDetections = useMemo(() => {
    const trackMap = new Map();
    
    // Process detections in reverse (newest first) to get latest state for each track_id
    for (const det of [...detections].reverse()) {
      const trackId = det?.track_id;
      const className = getDetectionClass(det);
      
      // Use track_id if available, otherwise fallback to a generated key for non-tracked detections
      const key = trackId !== undefined && trackId !== null 
        ? `track_${trackId}` 
        : `untracked_${className}_${det?.timestamp || Date.now()}_${Math.random()}`;
      
      if (!trackMap.has(key)) {
        trackMap.set(key, det);
      }
    }
    
    // Convert back to array, sorted by timestamp descending (newest first)
    return Array.from(trackMap.values())
      .sort((a, b) => (b?.timestamp || 0) - (a?.timestamp || 0))
      .slice(0, maxItems);
  }, [detections, maxItems]);
  
  if (uniqueDetections.length === 0) {
    return (
      <div style={logContainerStyle}>
        <div style={logEmptyStyle}>
          <Target size={32} style={{ color: THEME.textMuted, marginBottom: '8px' }} />
          <div style={{ fontSize: '13px', color: THEME.textSecondary }}>No detections yet</div>
          <div style={{ fontSize: '11px', color: THEME.textMuted, marginTop: '4px' }}>
            Start video analysis to see detections
          </div>
        </div>
      </div>
    );
  }
  
  return (
    <div style={logContainerStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <span style={{ fontSize: '12px', fontWeight: 600, color: THEME.textPrimary, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          ACTIVE TRACKS
        </span>
        <span style={{ fontSize: '11px', color: THEME.textSecondary }}>
          {uniqueDetections.length} unique
        </span>
      </div>
      
      <div style={logListStyle}>
        {uniqueDetections.map((det, idx) => {
          const className = getDetectionClass(det);
          const classLabel = getDetectionLabel(det);
          const trackId = det?.track_id;
          const confidence = det?.confidence;
          const timestamp = det?.timestamp || Date.now();
          
          return (
          <div key={idx} style={logItemStyle}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{
                width: '10px',
                height: '10px',
                borderRadius: '50%',
                background: getClassColor(className),
                boxShadow: `0 0 6px ${getClassColor(className)}`,
              }} />
              <span style={{ fontSize: '11px', fontWeight: 600, color: THEME.textPrimary, textTransform: 'uppercase' }}>
                {classLabel}
              </span>
              {trackId !== undefined && trackId !== null && (
                <span style={{ 
                  fontSize: '10px', 
                  color: THEME.textMuted,
                  background: 'rgba(255,255,255,0.1)',
                  padding: '2px 6px',
                  borderRadius: '4px',
                  fontFamily: 'monospace',
                }}>
                  #{trackId}
                </span>
              )}
              {confidence && (
                <span style={{ 
                  fontSize: '10px', 
                  color: THEME.successGreen,
                  fontFamily: 'monospace',
                  fontWeight: 600,
                }}>
                  {Math.round(confidence * 100)}%
                </span>
              )}
            </div>
            <div style={{ fontSize: '10px', color: THEME.textMuted, fontFamily: 'monospace', marginLeft: '18px', marginTop: '2px' }}>
              {formatTimestamp(timestamp)}
            </div>
          </div>
        )
        })}
      </div>
    </div>
  );
};

const logContainerStyle = {
  background: THEME.mutedSlate,
  border: `1px solid ${THEME.borderSlate}`,
  borderRadius: '12px',
  padding: '16px',
  maxHeight: '300px',
  overflow: 'auto',
};

const logEmptyStyle = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '32px',
  textAlign: 'center',
};

const logListStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: '8px',
};

const logItemStyle = {
  padding: '8px 10px',
  background: THEME.darkSlate,
  borderRadius: '8px',
  border: `1px solid ${THEME.borderSlate}`,
  transition: 'background 0.2s',
};

// ============================================================
// Main TacticalFeedPanel Component
// ============================================================
export const TacticalFeedPanel = ({ 
  className = '',
  onDetectionUpdate,
  onAlertGenerated,
  cameraId = null,
}) => {
  const [mode, setMode] = useState('upload'); // 'upload' | 'webcam' | 'analyzing'
  const [videoFile, setVideoFile] = useState(null);
  const [webcamActive, setWebcamActive] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [detections, setDetections] = useState([]);
  const [frameCount, setFrameCount] = useState(0);
  const [processingTimes, setProcessingTimes] = useState([]);
  const [error, setError] = useState(null);
  const [showOverlay, setShowOverlay] = useState(true);
  const [showLabels, setShowLabels] = useState(true);
  const [showConfidence, setShowConfidence] = useState(true);
  const [showTrackIds, setShowTrackIds] = useState(true);
  const [frameInterval, setFrameInterval] = useState(500); // Default 500ms for faster analysis
  const [isDragActive, setIsDragActive] = useState(false);
  const [videoEnded, setVideoEnded] = useState(false); // Track video completion
  
  const previousTimeRef = useRef(0); // Track previous time for seek-back detection
  
  const videoRef = useRef(null);
  const webcamVideoRef = useRef(null);
  const fileInputRef = useRef(null); // Hidden file input for upload button
  const analysisQueueRef = useRef([]);
  const isProcessingRef = useRef(false);
  const seenTrackIds = useRef(new Map()); // Track unique objects: track_id -> { category, label, lastSeen }
  
  // Process analysis queue sequentially
  const processQueue = useCallback(async () => {
    if (isProcessingRef.current || analysisQueueRef.current.length === 0) return;
    
    isProcessingRef.current = true;
    const frameFile = analysisQueueRef.current.shift();
    
    const startTime = performance.now();
    try {
      const result = await api.analyzeFrame(frameFile, {
        return_annotated: true,
        camera_id: cameraId,
      });
      
      const processingTime = performance.now() - startTime;
      setProcessingTimes(prev => [...prev.slice(-99), processingTime]);
      
      if (result && result.detections) {
        const newDetections = result.detections.map(d => ({
          ...d,
          timestamp: Date.now(),
          frame: frameCount + 1,
        }));
        
        // Track unique objects by track_id
        newDetections.forEach(det => {
          const trackId = det.track_id;
          if (trackId !== undefined && trackId !== null) {
            const category = getDetectionCategory(det);
            const label = getDetectionLabel(det);
            if (category) {
              seenTrackIds.current.set(trackId, { 
                category, 
                label,
                trackId,
                lastSeen: Date.now(),
                confidence: det.confidence,
              });
            }
          }
        });
        
        setDetections(prev => [...prev.slice(-499), ...newDetections]);
        setFrameCount(prev => prev + 1);
        
        // Trigger alert for high-confidence detections
        const criticalDetections = newDetections.filter(d => 
          d.confidence > 0.8 && (getDetectionClass(d) === 'person' || getDetectionClass(d) === 'vehicle')
        );
        
        if (criticalDetections.length > 0 && onAlertGenerated) {
          criticalDetections.forEach(det => {
            onAlertGenerated({
              type: 'detection',
              class_name: getDetectionClass(det),
              confidence: det.confidence,
              track_id: det.track_id,
              bbox: det.bbox,
              timestamp: new Date().toISOString(),
            });
          });
        }
        
        if (onDetectionUpdate) {
          onDetectionUpdate(newDetections);
        }
      }
    } catch (err) {
      // Log detailed error info for 422 validation errors
      if (err instanceof api.APIError) {
        console.error('Frame analysis failed:', {
          message: err.message,
          code: err.code,
          status: err.status,
          details: err.details,
        });
        setError(`${err.status} ${err.code}: ${err.message}${err.details ? ` - ${JSON.stringify(err.details)}` : ''}`);
      } else {
        console.error('Frame analysis failed:', err);
        setError(err.message);
      }
    } finally {
      isProcessingRef.current = false;
      // Process next frame
      if (analysisQueueRef.current.length > 0) {
        setTimeout(processQueue, 50);
      } else {
        setIsAnalyzing(false);
      }
    }
  }, [frameCount, onDetectionUpdate, onAlertGenerated]);
  
  // Handle frame capture from video/webcam
  const handleFrameCapture = useCallback((frameFile) => {
    analysisQueueRef.current.push(frameFile);
    if (!isProcessingRef.current) {
      setIsAnalyzing(true);
      processQueue();
    }
  }, [processQueue]);
  
  // Unified video file processing - called by both drag-drop and file input
  const processVideoFile = useCallback((file) => {
    if (!file || !file.type.startsWith('video/')) {
      setError('Please select a valid video file');
      return;
    }
    // Clear unique object tracking on new video
    seenTrackIds.current.clear();
    
    setVideoFile(file);
    setMode('analyzing');
    setDetections([]);
    setFrameCount(0);
    setProcessingTimes([]);
    setError(null);
    setIsPlaying(true);
    setIsDragActive(false);
  }, []);

  // Handle file input change (from hidden input or dropzone)
  const handleFileSelect = useCallback((e) => {
    const file = e.target.files?.[0] || e.dataTransfer?.files?.[0];
    if (file) {
      processVideoFile(file);
    }
    // Reset input so same file can be selected again
    if (e.target) e.target.value = '';
  }, [processVideoFile]);
  
  // Handle video loaded metadata
  const handleVideoMetadata = useCallback((e) => {
    setDuration(e.target.duration);
  }, []);
  
  // Toggle webcam
  const toggleWebcam = useCallback(() => {
    if (webcamActive) {
      setWebcamActive(false);
      setMode('upload');
    } else {
      setVideoFile(null);
      setWebcamActive(true);
      setMode('webcam');
      setDetections([]);
      setFrameCount(0);
      setProcessingTimes([]);
      setError(null);
    }
  }, [webcamActive]);
  
  // Clear analysis
  const clearAnalysis = useCallback(() => {
    setVideoFile(null);
    setWebcamActive(false);
    setMode('upload');
    setDetections([]);
    setFrameCount(0);
    setProcessingTimes([]);
    setError(null);
    setIsPlaying(false);
    setCurrentTime(0);
    setVideoEnded(false);
    // Clear unique object tracking
    seenTrackIds.current.clear();
    analysisQueueRef.current = [];
    isProcessingRef.current = false;
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.src = '';
    }
  }, []);
  
  // Handle video ended - stop analysis
  const handleVideoEnded = useCallback(() => {
    setIsPlaying(false);
    setIsAnalyzing(false);
    setVideoEnded(true);
    // Clear frame extraction interval
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }
  }, []);
  
  // Handle seek back / replay - reset tracking
  const handleSeekBack = useCallback(() => {
    seenTrackIds.current.clear();
    setDetections([]);
    setFrameCount(0);
    setVideoEnded(false);
  }, []);
  
  // Calculate average processing time
  const avgProcessingTime = processingTimes.length > 0
    ? processingTimes.reduce((a, b) => a + b, 0) / processingTimes.length
    : 0;
  
  // Compute unique object counts from tracked IDs
  const uniqueCounts = useMemo(() => {
    const counts = {
      persons: 0,
      vehicles: 0,
      trucks: 0,
      buses: 0,
      motorcycles: 0,
      bicycles: 0,
      license_plates: 0,
      total: 0,
    };
    
    for (const entry of seenTrackIds.current.values()) {
      const category = entry.category;
      if (counts.hasOwnProperty(category)) {
        counts[category]++;
      }
    }
    counts.total = seenTrackIds.current.size;
    
    return counts;
  }, [frameCount]); // Recompute when new frames are processed
  
  // Current video element for overlay
  const currentVideoEl = mode === 'webcam' ? webcamVideoRef.current : videoRef.current;
  const currentVideoWidth = mode === 'webcam' ? (webcamVideoRef.current?.videoWidth || 0) : (videoRef.current?.videoWidth || 0);
  const currentVideoHeight = mode === 'webcam' ? (webcamVideoRef.current?.videoHeight || 0) : (videoRef.current?.videoHeight || 0);
  
  return (
    <div style={{ ...panelStyle, className }}>
      {/* Header */}
      <div style={headerStyle}>
        {/* Hidden file input for upload button */}
        <input
          ref={fileInputRef}
          type="file"
          accept="video/*"
          onChange={handleFileSelect}
          style={{ display: 'none' }}
          disabled={isAnalyzing}
        />
        
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ 
            width: '10px', 
            height: '10px', 
            borderRadius: '50%', 
            background: isAnalyzing ? THEME.tacticalBlue : (webcamActive ? THEME.successGreen : THEME.textMuted),
            animation: isAnalyzing ? 'pulse 1s ease-in-out infinite' : 'none',
          }} />
          <h3 style={{ fontSize: '16px', fontWeight: 700, color: THEME.textPrimary, margin: 0 }}>
            TACTICAL FEED & FRAME ANALYSIS
          </h3>
          {isAnalyzing && (
            <span style={{ 
              fontSize: '10px', 
              fontWeight: 600, 
              color: THEME.tacticalBlue,
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
              background: 'rgba(59, 130, 246, 0.15)',
              padding: '2px 8px',
              borderRadius: '4px',
            }}>
              ANALYZING
            </span>
          )}
        </div>
        
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {/* Upload Video Button */}
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={isAnalyzing}
            style={{
              ...controlButtonStyle,
              padding: '0 12px',
              gap: '6px',
              background: THEME.tacticalBlue,
              color: '#FFFFFF',
              borderColor: THEME.tacticalBlue,
              opacity: isAnalyzing ? 0.5 : 1,
              cursor: isAnalyzing ? 'not-allowed' : 'pointer',
            }}
            title="Upload Video File"
          >
            <Upload size={16} />
            <span style={{ fontSize: '12px', fontWeight: 600 }}>Upload Video</span>
          </button>
          
          {/* Mode Toggle */}
          <div style={{ display: 'flex', background: THEME.darkSlate, borderRadius: '8px', border: `1px solid ${THEME.borderSlate}`, padding: '2px' }}>
            <button
              onClick={() => { setMode('upload'); setWebcamActive(false); setVideoFile(null); }}
              style={{
                ...modeButtonStyle,
                background: mode === 'upload' ? THEME.tacticalBlue : 'transparent',
                color: mode === 'upload' ? '#FFFFFF' : THEME.textSecondary,
              }}
              title="Upload Video"
            >
              <Upload size={16} />
            </button>
            <button
              onClick={toggleWebcam}
              style={{
                ...modeButtonStyle,
                background: webcamActive ? THEME.successGreen : 'transparent',
                color: webcamActive ? '#FFFFFF' : THEME.textSecondary,
              }}
              title="Live Webcam"
            >
              <Camera size={16} />
            </button>
          </div>
          
          {/* Overlay Controls */}
          <div style={{ display: 'flex', gap: '4px', background: THEME.darkSlate, borderRadius: '8px', border: `1px solid ${THEME.borderSlate}`, padding: '2px' }}>
            <button
              onClick={() => setShowOverlay(!showOverlay)}
              style={{
                ...overlayButtonStyle,
                background: showOverlay ? THEME.tacticalBlue : 'transparent',
                color: showOverlay ? '#FFFFFF' : THEME.textSecondary,
              }}
              title="Toggle Overlay"
            >
              <Eye size={14} />
            </button>
            <button
              onClick={() => setShowLabels(!showLabels)}
              style={{
                ...overlayButtonStyle,
                background: showLabels ? THEME.successGreen : 'transparent',
                color: showLabels ? '#FFFFFF' : THEME.textSecondary,
              }}
              title="Toggle Labels"
            >
              <span style={{ fontSize: '10px', fontWeight: 700 }}>Aa</span>
            </button>
            <button
              onClick={() => setShowTrackIds(!showTrackIds)}
              style={{
                ...overlayButtonStyle,
                background: showTrackIds ? THEME.warningAmber : 'transparent',
                color: showTrackIds ? '#FFFFFF' : THEME.textSecondary,
              }}
              title="Toggle Track IDs"
            >
              <Target size={14} />
            </button>
          </div>
          
          {/* Clear Button */}
          {(videoFile || webcamActive) && (
            <button
              onClick={clearAnalysis}
              style={{
                ...controlButtonStyle,
                background: 'rgba(239, 68, 68, 0.15)',
                borderColor: THEME.criticalRed,
                color: THEME.criticalRed,
              }}
              title="Clear Analysis"
            >
              <Trash2 size={16} />
            </button>
          )}
        </div>
      </div>
      
      {/* Main Content */}
      <div style={contentStyle}>
        {/* Video Feed Area */}
        <div style={videoAreaStyle}>
          {mode === 'upload' && !videoFile && (
            <Dropzone
              onFileSelect={setIsDragActive}
              onFilePicked={handleFileSelect}
              isDragActive={isDragActive}
              isAnalyzing={isAnalyzing}
              disabled={webcamActive}
            />
          )}
          
          {videoFile && (
            <div style={{ position: 'relative', width: '100%', height: '100%' }}>
              <VideoAnalyzer
                videoFile={videoFile}
                onFrameCapture={handleFrameCapture}
                frameInterval={frameInterval}
                isPlaying={isPlaying}
                currentTime={currentTime}
                duration={duration}
                onSeek={setCurrentTime}
                onPlayPause={setIsPlaying}
                onStop={() => { setIsPlaying(false); setCurrentTime(0); }}
                onVideoEnded={handleVideoEnded}
                onSeekBack={handleSeekBack}
              />
              {showOverlay && detections.length > 0 && (
                <DetectionOverlay
                  videoElement={currentVideoEl}
                  detections={detections.filter(d => d.frame === frameCount)}
                  videoWidth={currentVideoWidth}
                  videoHeight={currentVideoHeight}
                  showLabels={showLabels}
                  showConfidence={showConfidence}
                  showTrackIds={showTrackIds}
                />
              )}
            </div>
          )}
          
          {webcamActive && (
            <div style={{ position: 'relative', width: '100%', height: '100%' }}>
              <WebcamFeed
                isActive={webcamActive}
                onFrameCapture={handleFrameCapture}
                frameInterval={frameInterval}
                videoRef={webcamVideoRef}
              />
              {showOverlay && detections.length > 0 && (
                <DetectionOverlay
                  videoElement={currentVideoEl}
                  detections={detections.filter(d => d.frame === frameCount)}
                  videoWidth={currentVideoWidth}
                  videoHeight={currentVideoHeight}
                  showLabels={showLabels}
                  showConfidence={showConfidence}
                  showTrackIds={showTrackIds}
                />
              )}
            </div>
          )}
        </div>
        
        {/* Right Sidebar: Stats & Log */}
        <div style={sidebarStyle}>
          <DetectionStats
            uniqueCounts={uniqueCounts}
            totalFrames={frameCount}
            processingTime={avgProcessingTime}
          />
          
          <DetectionLog detections={detections} maxItems={15} />
          
          {/* Settings Panel */}
          <div style={{ ...settingsPanelStyle, marginTop: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
              <span style={{ fontSize: '11px', fontWeight: 600, color: THEME.textPrimary, textTransform: 'uppercase' }}>
                ANALYSIS SETTINGS
              </span>
            </div>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '11px', color: THEME.textSecondary, marginBottom: '6px', textTransform: 'uppercase' }}>
                  Frame Interval: {frameInterval}ms
                </label>
                <input
                  type="range"
                  min={100}
                  max={5000}
                  step={100}
                  value={frameInterval}
                  onChange={(e) => setFrameInterval(Number(e.target.value))}
                  style={{
                    width: '100%',
                    height: '6px',
                    appearance: 'none',
                    background: THEME.borderSlate,
                    borderRadius: '3px',
                    outline: 'none',
                    accentColor: THEME.tacticalBlue,
                  }}
                />
              </div>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '12px', color: THEME.textPrimary }}>
                  <input
                    type="checkbox"
                    checked={showLabels}
                    onChange={(e) => setShowLabels(e.target.checked)}
                    style={{ width: '16px', height: '16px', accentColor: THEME.successGreen }}
                  />
                  Show Class Labels
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '12px', color: THEME.textPrimary }}>
                  <input
                    type="checkbox"
                    checked={showConfidence}
                    onChange={(e) => setShowConfidence(e.target.checked)}
                    style={{ width: '16px', height: '16px', accentColor: THEME.tacticalBlue }}
                  />
                  Show Confidence Scores
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '12px', color: THEME.textPrimary }}>
                  <input
                    type="checkbox"
                    checked={showTrackIds}
                    onChange={(e) => setShowTrackIds(e.target.checked)}
                    style={{ width: '16px', height: '16px', accentColor: THEME.warningAmber }}
                  />
                  Show Track IDs
                </label>
              </div>
            </div>
          </div>
        </div>
      </div>
      
      {/* Error Display */}
      {error && (
        <div style={errorStyle}>
          <AlertTriangle size={16} style={{ flexShrink: 0 }} />
          <span style={{ fontSize: '12px', flex: 1 }}>{error}</span>
          <button
            onClick={() => setError(null)}
            style={{ background: 'none', border: 'none', color: THEME.textMuted, cursor: 'pointer', padding: '4px' }}
          >
            <XCircle size={16} />
          </button>
        </div>
      )}
    </div>
  );
};

const panelStyle = {
  background: THEME.mutedSlate,
  border: `1px solid ${THEME.borderSlate}`,
  borderRadius: '12px',
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  minHeight: '600px',
  overflow: 'hidden',
};

const headerStyle = {
  padding: '16px 20px',
  borderBottom: `1px solid ${THEME.borderSlate}`,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  flexShrink: 0,
};

const contentStyle = {
  display: 'grid',
  gridTemplateColumns: '1fr 320px',
  gap: '16px',
  flex: 1,
  minHeight: 0,
  padding: '16px 20px',
  overflow: 'hidden',
};

const videoAreaStyle = {
  position: 'relative',
  minHeight: '360px',
  display: 'flex',
  flexDirection: 'column',
};

const sidebarStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: '16px',
  minHeight: 0,
};

const settingsPanelStyle = {
  background: THEME.darkSlate,
  border: `1px solid ${THEME.borderSlate}`,
  borderRadius: '12px',
  padding: '16px',
};

const modeButtonStyle = {
  width: '36px',
  height: '36px',
  borderRadius: '6px',
  border: 'none',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
  transition: 'all 0.2s',
  fontSize: '14px',
};

const overlayButtonStyle = {
  width: '32px',
  height: '32px',
  borderRadius: '6px',
  border: 'none',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
  transition: 'all 0.2s',
  fontSize: '12px',
};

const errorStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  padding: '12px 20px',
  background: 'rgba(239, 68, 68, 0.15)',
  borderTop: `1px solid ${THEME.criticalRed}`,
  color: THEME.criticalRed,
  fontSize: '12px',
};

export default TacticalFeedPanel;