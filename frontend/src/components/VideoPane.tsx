import { useRef, useState, useEffect } from 'react';

interface OverlayBox {
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
  confidence: number;
  type: 'human' | 'vehicle' | 'face' | 'suspicious';
}

const MOCK_OVERLAYS: OverlayBox[] = [
  { x: 0.2, y: 0.3, width: 0.15, height: 0.25, label: 'Human', confidence: 0.92, type: 'human' },
  { x: 0.6, y: 0.4, width: 0.2, height: 0.15, label: 'Vehicle', confidence: 0.87, type: 'vehicle' },
  { x: 0.8, y: 0.1, width: 0.1, height: 0.1, label: 'Face', confidence: 0.95, type: 'face' },
];

const TYPE_COLORS: Record<string, string> = {
  human: '#ef4444',
  vehicle: '#3b82f6',
  face: '#f59e0b',
  suspicious: '#ec4899',
};

export default function VideoPane({ 
  cameraId = 'CAM-BDR-001',
  streamUrl = 'https://assets.mixkit.co/videos/preview/mixkit-security-camera-footage-of-a-hallway-33348-large.mp4',
  className = ''
}: { 
  cameraId?: string; 
  streamUrl?: string;
  className?: string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [playing, setPlaying] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(100);
  const [volume, setVolume] = useState(1);
  const [fullscreen, setFullscreen] = useState(false);
  const [showOverlays, setShowOverlays] = useState(true);
  const [stats, setStats] = useState({ detections: 3, avgConfidence: 92 });

  useEffect(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const drawOverlays = () => {
      if (!showOverlays || video.paused || video.ended) return;
      
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      MOCK_OVERLAYS.forEach(box => {
        const x = box.x * canvas.width;
        const y = box.y * canvas.height;
        const w = box.width * canvas.width;
        const h = box.height * canvas.height;

        const color = TYPE_COLORS[box.type] || '#6b7280';

        // Draw bounding box
        ctx.strokeStyle = color;
        ctx.lineWidth = 3;
        ctx.strokeRect(x, y, w, h);

        // Draw label background
        const label = `${box.label} ${Math.round(box.confidence * 100)}%`;
        ctx.font = '13px system-ui, sans-serif';
        const textMetrics = ctx.measureText(label);
        const textWidth = textMetrics.width;
        const textHeight = 18;
        
        ctx.fillStyle = color;
        ctx.fillRect(x, y - textHeight - 4, textWidth + 10, textHeight + 4);
        
        // Draw label text
        ctx.fillStyle = '#ffffff';
        ctx.fillText(label, x + 5, y - 6);
      });

      requestAnimationFrame(drawOverlays);
    };

    video.addEventListener('play', drawOverlays);
    video.addEventListener('pause', () => {});
    
    return () => {
      video.removeEventListener('play', drawOverlays);
    };
  }, [showOverlays]);

  const handleTimeUpdate = () => {
    const video = videoRef.current;
    if (video) setCurrentTime(video.currentTime);
  };

  const handleLoadedMetadata = () => {
    const video = videoRef.current;
    if (video) setDuration(video.duration);
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const video = videoRef.current;
    if (video) video.currentTime = parseFloat(e.target.value);
  };

  const togglePlay = () => setPlaying(p => !p);
  
  const toggleFullscreen = () => {
    const video = videoRef.current;
    if (!video) return;
    if (!fullscreen) {
      video.requestFullscreen();
    } else {
      document.exitFullscreen();
    }
    setFullscreen(!fullscreen);
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className={`videopane bg-[hsl(var(--card))] border border-[hsl(var(--border))] rounded-xl overflow-hidden flex flex-col ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-[hsl(var(--border))] bg-[hsl(var(--muted))]">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" aria-hidden="true" />
            <span className="text-xs font-mono text-[hsl(var(--muted-foreground))] uppercase tracking-wider">LIVE</span>
          </div>
          <h3 className="font-medium text-[hsl(var(--foreground))]">{cameraId}</h3>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={showOverlays}
              onChange={e => setShowOverlays(e.target.checked)}
              className="w-4 h-4 rounded border-[hsl(var(--border))] bg-[hsl(var(--background))] text-primary focus:ring-primary focus:ring-offset-2 focus:ring-offset-[hsl(var(--background))]"
              aria-label="Show detection overlays"
            />
            <span className="text-sm text-[hsl(var(--muted-foreground))]">Overlays</span>
          </label>
        </div>
      </div>

      {/* Video Container */}
      <div className="relative flex-1 bg-black min-h-[400px]">
        <video
          ref={videoRef}
          className="w-full h-full object-contain"
          onTimeUpdate={handleTimeUpdate}
          onLoadedMetadata={handleLoadedMetadata}
          playsInline
          crossOrigin="anonymous"
          muted
        >
          <source src={streamUrl} type="video/mp4" />
          Your browser does not support the video tag.
        </video>
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full pointer-events-none"
          aria-hidden="true"
        />
        
        {/* Recording indicator */}
        {playing && (
          <div className="absolute top-4 left-4 flex items-center gap-2 text-white/90">
            <span className="relative flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
              <span className="text-xs font-mono tracking-wider">REC</span>
            </span>
            <span className="text-xs text-white/70 font-mono">
              {new Date().toLocaleTimeString()}
            </span>
          </div>
        )}
      </div>

      {/* Playback Controls */}
      <div className="flex items-center gap-3 p-4 border-t border-[hsl(var(--border))] bg-[hsl(var(--muted))] flex-wrap">
        <button
          onClick={togglePlay}
          aria-label={playing ? 'Pause' : 'Play'}
          aria-pressed={playing}
          className="flex items-center justify-center w-10 h-10 rounded-lg bg-[hsl(var(--background))] border border-[hsl(var(--border))] text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))] transition-colors focus:outline-none focus:ring-2 focus:ring-primary"
        >
          {playing ? (
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
            </svg>
          ) : (
            <svg className="w-5 h-5 ml-1" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M8 5v14l11-7z"/>
            </svg>
          )}
        </button>
        
        <div className="flex-1 min-w-0 flex items-center gap-2">
          <span className="text-xs font-mono text-[hsl(var(--muted-foreground))] w-12 text-center" aria-live="polite">
            {formatTime(currentTime)}
          </span>
          <input
            type="range"
            className="flex-1 h-1.5 bg-[hsl(var(--border))] rounded-full appearance-none cursor-pointer accent-primary"
            min={0}
            max={duration}
            step={0.1}
            value={currentTime}
            onChange={handleSeek}
            aria-label="Playback timeline"
          />
          <span className="text-xs font-mono text-[hsl(var(--muted-foreground))] w-12 text-center">
            {formatTime(duration)}
          </span>
        </div>
        
        <div className="flex items-center gap-2">
          <button
            onClick={() => setVolume(v => v > 0 ? 0 : 1)}
            aria-label={volume > 0 ? 'Mute' : 'Unmute'}
            className="flex items-center justify-center w-10 h-10 rounded-lg bg-[hsl(var(--background))] border border-[hsl(var(--border))] text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))] transition-colors focus:outline-none focus:ring-2 focus:ring-primary"
          >
            {volume > 0 ? (
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/>
              </svg>
            ) : (
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/>
              </svg>
            )}
          </button>
          <input
            type="range"
            className="w-20 h-1.5 bg-[hsl(var(--border))] rounded-full appearance-none cursor-pointer accent-primary"
            min={0}
            max={1}
            step={0.1}
            value={volume}
            onChange={e => setVolume(parseFloat(e.target.value))}
            aria-label="Volume"
          />
        </div>
        
        <button
          onClick={toggleFullscreen}
          aria-label={fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
          className="flex items-center justify-center w-10 h-10 rounded-lg bg-[hsl(var(--background))] border border-[hsl(var(--border))] text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))] transition-colors focus:outline-none focus:ring-2 focus:ring-primary"
        >
          {fullscreen ? (
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z"/>
            </svg>
          ) : (
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/>
            </svg>
          )}
        </button>
      </div>

      {/* Stats Bar */}
      <div className="flex items-center justify-around p-3 border-t border-[hsl(var(--border))] bg-[hsl(var(--background))]">
        <div className="flex flex-col items-center gap-1">
          <span className="text-2xl font-bold font-mono text-primary">{stats.detections}</span>
          <span className="text-xs text-[hsl(var(--muted-foreground))] uppercase tracking-wider">Active Detections</span>
        </div>
        <div className="flex flex-col items-center gap-1 border-l border-r border-[hsl(var(--border))] px-4">
          <span className="text-2xl font-bold font-mono text-amber-500">{stats.avgConfidence}%</span>
          <span className="text-xs text-[hsl(var(--muted-foreground))] uppercase tracking-wider">Avg Confidence</span>
        </div>
        <div className="flex flex-col items-center gap-1">
          <span className="text-2xl font-bold font-mono text-green-500">24/7</span>
          <span className="text-xs text-[hsl(var(--muted-foreground))] uppercase tracking-wider">Monitoring</span>
        </div>
      </div>
    </div>
  );
}