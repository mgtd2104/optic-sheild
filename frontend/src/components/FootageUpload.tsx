import { useState, useCallback, useRef } from 'react';
import { apiUpload } from '../api/client';
import '../styles/footageupload.css';

interface UploadedFootage {
  id: string;
  filename: string;
  url: string;
  thumbnail?: string;
  duration?: number;
  size: number;
  uploadedAt: string;
}

interface FootageUploadProps {
  onUploadComplete?: (footage: UploadedFootage) => void;
  cameraId?: string;
  detectionId?: string;
  maxSizeMB?: number;
  acceptedTypes?: string[];
}

const DEFAULT_MAX_SIZE = 500; // MB
const DEFAULT_TYPES = ['video/mp4', 'video/webm', 'video/quicktime', 'video/x-msvideo', 'application/octet-stream'];

export default function FootageUpload({
  onUploadComplete,
  cameraId,
  detectionId,
  maxSizeMB = DEFAULT_MAX_SIZE,
  acceptedTypes = DEFAULT_TYPES,
}: FootageUploadProps) {
  const [dragActive, setDragActive] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cancellerRef = useRef<ReturnType<typeof apiUpload> | null>(null);

  const validateFile = useCallback((file: File): string | null => {
    if (file.size > maxSizeMB * 1024 * 1024) {
      return `File size exceeds ${maxSizeMB}MB limit`;
    }
    if (!acceptedTypes.some(type => file.type === type || file.type.startsWith(type.replace('*', '')))) {
      return 'Invalid file type. Accepted: MP4, WebM, MOV, AVI';
    }
    return null;
  }, [maxSizeMB, acceptedTypes]);

  const handleFileSelect = useCallback((file: File) => {
    const err = validateFile(file);
    if (err) {
      setError(err);
      return;
    }
    setSelectedFile(file);
    setError(null);
    setSuccess(false);
    setProgress(0);
  }, [validateFile]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFileSelect(file);
  }, [handleFileSelect]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
  }, []);

  const handleUpload = async () => {
    if (!selectedFile) return;

    setUploading(true);
    setError(null);
    setProgress(0);

    try {
      const metadata: Record<string, string> = {};
      if (cameraId) metadata.cameraId = cameraId;
      if (detectionId) metadata.detectionId = detectionId;

      const result = await apiUpload<UploadedFootage>(
        '/api/footage/upload',
        selectedFile,
        setProgress,
        metadata
      );

      setSuccess(true);
      setProgress(100);
      onUploadComplete?.(result);
    } catch (err) {
      if (err instanceof Error && err.message !== 'Upload aborted') {
        setError(err.message);
      }
    } finally {
      setUploading(false);
    }
  };

  const handleCancel = () => {
    // Note: true cancellation would require exposing the XHR from apiUpload
    setUploading(false);
    setProgress(0);
    setSelectedFile(null);
  };

  const handleRemove = () => {
    setSelectedFile(null);
    setError(null);
    setSuccess(false);
    setProgress(0);
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const formatDuration = (seconds?: number) => {
    if (!seconds) return '—';
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    return hrs > 0 ? `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}` : `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="footage-upload">
      {/* Drop Zone / File Preview */}
      <div
        className={`upload-dropzone ${dragActive ? 'active' : ''} ${selectedFile ? 'has-file' : ''}`}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={() => !uploading && fileInputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click(); }}
        aria-label="Upload footage drop zone"
      >
        <input
          ref={fileInputRef}
          type="file"
          accept={acceptedTypes.join(',')}
          onChange={(e) => e.target.files?.[0] && handleFileSelect(e.target.files[0])}
          style={{ display: 'none' }}
          aria-hidden="true"
          disabled={uploading}
        />

        {!selectedFile ? (
          <div className="dropzone-content">
            <svg className="upload-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>
            </svg>
            <p className="dropzone-text">
              <strong>Drag & drop</strong> footage here, or click to browse
            </p>
            <p className="dropzone-hint">
              MP4, WebM, MOV, AVI · Max {maxSizeMB}MB
            </p>
          </div>
        ) : (
          <div className="file-preview">
            <div className="file-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8M10 12V4m0 0l-4 4m4-4l4 4"/>
              </svg>
            </div>
            <div className="file-info">
              <p className="file-name" title={selectedFile.name}>{selectedFile.name}</p>
              <p className="file-meta">
                {formatSize(selectedFile.size)} · {selectedFile.type || 'Unknown type'}
              </p>
            </div>
            <button
              className="remove-btn"
              onClick={(e) => { e.stopPropagation(); handleRemove(); }}
              aria-label={`Remove ${selectedFile.name}`}
              disabled={uploading}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </div>
        )}
      </div>

      {/* Progress Bar */}
      {(uploading || success) && (
        <div className="upload-progress" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100} aria-label="Upload progress">
          <div className="progress-bar" style={{ width: `${progress}%` }}></div>
          <span className="progress-text">
            {uploading ? `Uploading... ${progress}%` : 'Upload complete'}
          </span>
        </div>
      )}

      {/* Error Message */}
      {error && (
        <div className="upload-error" role="alert">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="8" x2="12" y2="12"></line>
            <line x1="12" y1="16" x2="12.01" y2="16"></line>
          </svg>
          <span>{error}</span>
        </div>
      )}

      {/* Success Message */}
      {success && !uploading && (
        <div className="upload-success" role="status">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
            <polyline points="22 4 12 14.01 9 11.01"></polyline>
          </svg>
          <span>Footage uploaded successfully</span>
        </div>
      )}

      {/* Action Buttons */}
      <div className="upload-actions">
        {selectedFile && !uploading && !success && (
          <button
            className="btn-primary"
            onClick={handleUpload}
            disabled={!selectedFile}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>
            </svg>
            Upload Footage
          </button>
        )}
        {uploading && (
          <button className="btn-secondary" onClick={handleCancel}>
            Cancel
          </button>
        )}
        {success && (
          <button className="btn-secondary" onClick={handleRemove}>
            Upload Another
          </button>
        )}
      </div>

      {/* Uploaded Footage List (if callback provides) */}
      {onUploadComplete && (
        <div className="uploaded-list" aria-label="Uploaded footage">
          {/* This would be populated by parent state */}
        </div>
      )}
    </div>
  );
}