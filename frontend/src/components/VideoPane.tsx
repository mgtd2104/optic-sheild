import { useRef, useState, useEffect, useCallback } from 'react';

interface StreamAlert {
  type: string;
  severity: string;
  message: string;
}

interface StreamDetection {
  confidence: number;
}

interface AnalysisFrame {
  frame: string;
  detections: StreamDetection[];
  alerts: StreamAlert[];
}

interface OverlayBox {
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
  confidence: number;
  type: 'human' | 'vehicle' | 'face' | 'suspicious';
}

export default function VideoPane({ 
  cameraId = 'CAM-BDR-001',
  streamUrl,
  analysisWsUrl,
  analysisFrame: providedAnalysisFrame,
  className = ''
}: { 
  cameraId?: string; 
  streamUrl?: string;
  analysisWsUrl?: string;
  analysisFrame?: AnalysisFrame | null;
  className?: string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [playing, setPlaying] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(100);
  const [volume, setVolume] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const [showOverlays, setShowOverlays] = useState(true);
  const [stats, setStats] = useState({ detections: 0, avgConfidence: 0 });
  const [analysisFrame, setAnalysisFrame] = useState<AnalysisFrame | null>(null);
  const [threats, setThreats] = useState<StreamAlert[]>([]);
  const activeAnalysisFrame = providedAnalysisFrame || analysisFrame;
  
  // Refs to avoid stale closures in animation loop
  const showOverlaysRef = useRef(showOverlays);
  const animationFrameRef = useRef<number | null>(null);
  const isMountedRef = useRef(true);

  // Keep refs in sync with state
  useEffect(() => {
    showOverlaysRef.current = showOverlays;
  }, [showOverlays]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (!analysisWsUrl) {
      setAnalysisFrame(null);
      return;
    }

    const socket = new WebSocket(analysisWsUrl);
    socket.onopen = () => setPlaying(true);
    socket.onmessage = (event) => {
      const payload = JSON.parse(event.data) as AnalysisFrame;
      const detections = payload.detections || [];
      const average = detections.length
        ? detections.reduce((sum, detection) => sum + detection.confidence, 0) / detections.length
        : 0;
      setAnalysisFrame(payload);
      setThreats(payload.alerts || []);
      setStats({ detections: detections.length, avgConfidence: Math.round(average * 100) });
    };
    socket.onclose = () => setPlaying(false);
    socket.onerror = () => setPlaying(false);

    return () => socket.close();
  }, [analysisWsUrl]);

  // Legacy video fallback controls remain available for browser video sources.
  useEffect(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const drawOverlays = () => {
      if (!isMountedRef.current) return;
      if (!showOverlaysRef.current || video.paused || video.ended) {
        animationFrameRef.current = requestAnimationFrame(drawOverlays);
        return;
      }
      
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      animationFrameRef.current = requestAnimationFrame(drawOverlays);
    };

    // Start animation loop
    animationFrameRef.current = requestAnimationFrame(drawOverlays);
    
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (playing) {
      video.play().catch(() => setPlaying(false));
    } else {
      video.pause();
    }
  }, [playing]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    return () => {
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
    };
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.volume = volume;
    video.muted = volume === 0;
  }, [volume]);

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

  const handleVolumeChange = (newVolume: number) => {
    setVolume(newVolume);
  };

  const toggleMute = () => {
    setVolume(v => v > 0 ? 0 : 1);
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const isMuted = volume === 0;

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
        {activeAnalysisFrame ? (
          <img src={activeAnalysisFrame.frame} className="w-full h-full object-contain" alt="Live AI analyzed video frame" />
        ) : streamUrl ? (
          <video
            ref={videoRef}
            className="w-full h-full object-contain"
            onTimeUpdate={handleTimeUpdate}
            onLoadedMetadata={handleLoadedMetadata}
            playsInline
            crossOrigin="anonymous"
          >
            <source src={streamUrl} type="video/mp4" />
            Your browser does not support the video tag.
          </video>
        ) : (
          <div className="flex h-full min-h-[400px] items-center justify-center text-sm font-mono text-white/70">
            Waiting for live monitoring stream...
          </div>
        )}
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full pointer-events-none"
          aria-hidden="true"
        />

        {analysisWsUrl && threats.length > 0 && (
          <div className="absolute bottom-4 left-4 right-4 rounded-lg border border-red-400/60 bg-red-950/85 p-3 text-white shadow-lg" role="alert">
            <div className="text-xs font-bold uppercase tracking-wider text-red-300">Threat detected</div>
            <div className="mt-1 text-sm">{threats[0].message}</div>
          </div>
        )}
        
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
            onClick={toggleMute}
            aria-label={isMuted ? 'Unmute' : 'Mute'}
            className="flex items-center justify-center w-10 h-10 rounded-lg bg-[hsl(var(--background))] border border-[hsl(var(--border))] text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))] transition-colors focus:outline-none focus:ring-2 focus:ring-primary"
          >
            {isMuted ? (
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/>
              </svg>
            ) : (
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/>
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
            onChange={e => handleVolumeChange(parseFloat(e.target.value))}
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