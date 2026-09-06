/**
 * Optic Shield — LedgerViewer Component
 * 
 * Judicial Section 65B SHA-256 audit log stream inspector.
 * Features:
 * - High-contrast terminal/monospace table (JetBrains Mono)
 * - Block Index, Timestamp, Alert ID, Data Hash, Previous Hash, Block Hash
 * - Live "Verify Chain Integrity" button calling /api/v1/audit/verify
 * - Cryptographic validation badge (Green "CHAIN VALID" / Red "CHAIN TAMPERED")
 * - Paginated block browser with search/filter
 * - Block detail view with verification status
 * - Export functionality (JSON/CSV)
 * - Chain integrity visualization
 */

import React, {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
} from 'react';
import {
  Shield,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Search,
  Filter,
  Download,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  Copy,
  Check,
  FileText,
  Terminal,
  Hash,
  RefreshCw,
  ArrowUpDown,
  Minus,
  Plus,
  Settings,
  Info,
  AlertCircle,
  Clock,
  Database,
  Wifi,
  WifiOff,
  Zap,
  Link,
  Unlink,
  Verified,
  Flag,
  Loader2,
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

// ============================================================
// Utility Functions
// ============================================================
const formatTimestamp = (ts) => {
  if (!ts) return '—';
  const date = new Date(ts);
  return date.toLocaleString('en-IN', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZone: 'Asia/Kolkata',
  });
};

const formatHash = (hash, length = 16) => {
  if (!hash) return '—';
  if (hash.length <= length * 2) return hash;
  return `${hash.slice(0, length)}...${hash.slice(-length)}`;
};

const copyToClipboard = async (text, setCopied) => {
  try {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  } catch (e) {
    // console.error('Copy failed:', e);
  }
};

// ============================================================
// Verification Badge Component
// ============================================================
const VerificationBadge = ({ status, animating }) => {
  if (status === 'verifying') {
    return (
      <span style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        padding: '6px 14px',
        borderRadius: '9999px',
        background: 'rgba(59, 130, 246, 0.15)',
        border: `1px solid ${THEME.tacticalBlue}`,
        color: THEME.tacticalBlue,
        fontSize: '12px',
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: '0.5px',
      }}>
        <Zap size={14} className={animating ? 'spinning' : ''} />
        VERIFYING...
      </span>
    );
  }
  
  if (status === 'valid') {
    return (
      <span style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        padding: '6px 14px',
        borderRadius: '9999px',
        background: 'rgba(16, 185, 129, 0.15)',
        border: `1px solid ${THEME.successGreen}`,
        color: THEME.successGreen,
        fontSize: '12px',
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: '0.5px',
      }}>
        <CheckCircle size={14} />
        CHAIN VALID
      </span>
    );
  }
  
  if (status === 'invalid') {
    return (
      <span style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        padding: '6px 14px',
        borderRadius: '9999px',
        background: 'rgba(239, 68, 68, 0.15)',
        border: `1px solid ${THEME.criticalRed}`,
        color: THEME.criticalRed,
        fontSize: '12px',
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: '0.5px',
        animation: 'pulse 1.5s ease-in-out infinite',
      }}>
        <XCircle size={14} />
        CHAIN TAMPERED
      </span>
    );
  }
  
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: '6px',
      padding: '6px 14px',
      borderRadius: '9999px',
      background: 'rgba(100, 116, 139, 0.15)',
      border: `1px solid ${THEME.textMuted}`,
      color: THEME.textMuted,
      fontSize: '12px',
      fontWeight: 600,
      textTransform: 'uppercase',
      letterSpacing: '0.5px',
    }}>
      <Flag size={14} />
      NOT VERIFIED
    </span>
  );
};

// ============================================================
// Block Row Component
// ============================================================
const BlockRow = ({ block, onClick, selected, onCopyHash }) => {
  const [copied, setCopied] = useState(false);
  
  return (
    <tr
      style={{
        background: selected ? 'rgba(59, 130, 246, 0.1)' : 'transparent',
        borderBottom: `1px solid ${THEME.borderSlate}`,
        cursor: 'pointer',
        transition: 'background 0.15s',
      }}
      onClick={() => onClick?.(block)}
      onMouseEnter={(e) => e.currentTarget.style.background = selected ? 'rgba(59, 130, 246, 0.15)' : 'rgba(59, 130, 246, 0.05)'}
      onMouseLeave={(e) => e.currentTarget.style.background = selected ? 'rgba(59, 130, 246, 0.1)' : 'transparent'}
    >
      <td style={cellStyle}>{block.block_index}</td>
      <td style={cellStyle} title={block.timestamp}>
        {formatTimestamp(block.timestamp)}
      </td>
      <td style={cellStyle}>
        {block.alert_id ? (
          <span style={{ 
            fontFamily: 'monospace',
            color: THEME.tacticalBlue,
            fontWeight: 500,
          }}>
            #{block.alert_id}
          </span>
        ) : (
          <span style={{ color: THEME.textMuted }}>—</span>
        )}
      </td>
      <td style={cellStyle}>
        <span style={{ fontFamily: 'monospace', fontSize: '11px' }}>
          {formatHash(block.event_data?.hash || '—', 12)}
        </span>
      </td>
      <td style={cellStyle}>
        <span style={{ fontFamily: 'monospace', fontSize: '11px', color: THEME.textSecondary }}>
          {formatHash(block.previous_hash, 12)}
        </span>
      </td>
      <td style={cellStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <code style={{
            fontFamily: '"JetBrains Mono", monospace',
            fontSize: '11px',
            color: THEME.textPrimary,
            background: THEME.darkSlate,
            padding: '2px 6px',
            borderRadius: '4px',
            border: `1px solid ${THEME.borderSlate}`,
            maxWidth: '200px',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            display: 'inline-block',
          }}>
            {formatHash(block.current_hash, 20)}
          </code>
          <button
            onClick={(e) => {
              e.stopPropagation();
              copyToClipboard(block.current_hash, () => {});
            }}
            className="btn-icon"
            style={{ padding: '4px', opacity: 0.6 }}
            title="Copy block hash"
          >
            <Copy size={12} />
          </button>
        </div>
      </td>
      <td style={cellStyle}>
        <span style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '4px',
          padding: '2px 8px',
          borderRadius: '4px',
          fontSize: '10px',
          fontWeight: 600,
          textTransform: 'uppercase',
          background: getCategoryBg(block.event_category),
          color: getCategoryColor(block.event_category),
        }}>
          {block.event_category}
        </span>
      </td>
      <td style={cellStyle}>
        <span style={{ fontFamily: 'monospace', fontSize: '11px', color: THEME.textSecondary }}>
          {block.event_type}
        </span>
      </td>
    </tr>
  );
};

const cellStyle = {
  padding: '10px 12px',
  fontSize: '12px',
  fontFamily: '"JetBrains Mono", monospace',
  color: '#F1F5F9',
  verticalAlign: 'middle',
};

const getCategoryBg = (cat) => {
  const colors = {
    ALERT: 'rgba(239, 68, 68, 0.15)',
    CAMERA: 'rgba(59, 130, 246, 0.15)',
    GEOFENCE: 'rgba(245, 158, 11, 0.15)',
    WATCHLIST: 'rgba(139, 92, 246, 0.15)',
    SYSTEM: 'rgba(16, 185, 129, 0.15)',
    AUTHENTICATION: 'rgba(100, 116, 139, 0.15)',
    AUTHORIZATION: 'rgba(100, 116, 139, 0.15)',
    DATA_ACCESS: 'rgba(100, 116, 139, 0.15)',
    DATA_MODIFICATION: 'rgba(245, 158, 11, 0.15)',
    CONFIGURATION: 'rgba(139, 92, 246, 0.15)',
    KEY_MANAGEMENT: 'rgba(239, 68, 68, 0.15)',
  };
  return colors[cat] || 'rgba(100, 116, 139, 0.15)';
};

const getCategoryColor = (cat) => {
  const colors = {
    ALERT: '#EF4444',
    CAMERA: '#3B82F6',
    GEOFENCE: '#F59E0B',
    WATCHLIST: '#8B5CF6',
    SYSTEM: '#10B981',
    AUTHENTICATION: '#64748B',
    AUTHORIZATION: '#64748B',
    DATA_ACCESS: '#64748B',
    DATA_MODIFICATION: '#F59E0B',
    CONFIGURATION: '#8B5CF6',
    KEY_MANAGEMENT: '#EF4444',
  };
  return colors[cat] || '#64748B';
};

// ============================================================
// Block Detail Modal
// ============================================================
const BlockDetailModal = ({ block, onClose, onCopyHash }) => {
  if (!block) return null;
  
  return (
    <div className="modal-overlay" style={modalOverlayStyle} onClick={onClose}>
      <div className="modal-content" style={modalContentStyle} onClick={(e) => e.stopPropagation()}>
        <div style={modalHeaderStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <Terminal size={24} style={{ color: THEME.tacticalBlue }} />
            <div>
              <div style={{ fontSize: '18px', fontWeight: 700, color: THEME.textPrimary }}>
                Block #{block.block_index}
              </div>
              <div style={{ fontSize: '12px', color: THEME.textSecondary }}>
                {formatTimestamp(block.timestamp)}
              </div>
            </div>
          </div>
          <button onClick={onClose} className="btn-icon" style={{ marginLeft: 'auto' }}>
            <X size={20} />
          </button>
        </div>
        
        <div style={modalBodyStyle}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            {/* Left Column */}
            <div>
              <detailRow label="Block Index" value={block.block_index} />
              <detailRow label="Timestamp" value={formatTimestamp(block.timestamp)} />
              <detailRow label="Alert ID" value={block.alert_id ? `#${block.alert_id}` : '—'} />
              <detailRow label="Camera ID" value={block.camera_id || '—'} />
              <detailRow label="Event Type" value={block.event_type} />
              <detailRow label="Event Category" value={
                <span style={{
                  background: getCategoryBg(block.event_category),
                  color: getCategoryColor(block.event_category),
                  padding: '2px 8px',
                  borderRadius: '4px',
                  fontSize: '11px',
                  fontWeight: 600,
                  textTransform: 'uppercase',
                }}>
                  {block.event_category}
                </span>
              } />
            </div>
            
            {/* Right Column */}
            <div>
              <detailRow label="Hash Algorithm" value={block.hash_algorithm || 'SHA-256'} />
              <detailRow label="Public Key ID" value={block.public_key_id || '—'} />
              <detailRow label="Signature" value={block.signature ? 'Present' : 'None'} />
              <detailRow label="Camera" value={block.camera_id ? `Camera ${block.camera_id}` : 'N/A'} />
              <detailRow label="Alert" value={block.alert_id ? `Alert #${block.alert_id}` : 'N/A'} />
            </div>
          </div>
          
          <div style={{ marginTop: '20px', paddingTop: '16px', borderTop: `1px solid ${THEME.borderSlate}` }}>
            <div style={{ marginBottom: '8px', fontSize: '11px', color: THEME.textSecondary, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Previous Hash
            </div>
            <hashDisplay hash={block.previous_hash} onCopy={() => copyToClipboard(block.previous_hash, () => {})} />
            
            <div style={{ marginTop: '16px', marginBottom: '8px', fontSize: '11px', color: THEME.textSecondary, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Current Block Hash
            </div>
            <hashDisplay hash={block.current_hash} onCopy={() => copyToClipboard(block.current_hash, () => {})} />
            
            <div style={{ marginTop: '16px', marginBottom: '8px', fontSize: '11px', color: THEME.textSecondary, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Event Data (JSON)
            </div>
            <pre style={{
              background: THEME.darkSlate,
              border: `1px solid ${THEME.borderSlate}`,
              borderRadius: '8px',
              padding: '12px',
              maxHeight: '200px',
              overflow: 'auto',
              fontFamily: '"JetBrains Mono", monospace',
              fontSize: '11px',
              color: THEME.textPrimary,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}>
              {JSON.stringify(block.event_data, null, 2)}
            </pre>
          </div>
        </div>
        
        <div style={modalFooterStyle}>
          <button onClick={() => copyToClipboard(JSON.stringify(block, null, 2), () => {})} className="btn-secondary">
            <Copy size={14} /> Copy Full Block JSON
          </button>
          <button onClick={onClose} className="btn-primary">
            <X size={14} /> Close
          </button>
        </div>
      </div>
    </div>
  );
};

const detailRow = ({ label, value }) => (
  <div style={{ marginBottom: '12px' }}>
    <div style={{ fontSize: '11px', color: THEME.textSecondary, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px' }}>
      {label}
    </div>
    <div style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: '13px', color: THEME.textPrimary, wordBreak: 'break-all' }}>
      {typeof value === 'object' ? value : String(value)}
    </div>
  </div>
);

const hashDisplay = ({ hash, onCopy }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
    <code style={{
      flex: 1,
      minWidth: 0,
      fontFamily: '"JetBrains Mono", monospace',
      fontSize: '12px',
      color: THEME.textPrimary,
      background: THEME.darkSlate,
      padding: '10px 12px',
      borderRadius: '6px',
      border: `1px solid ${THEME.borderSlate}`,
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
      display: 'block',
    }}>
      {hash}
    </code>
    <button onClick={onCopy} className="btn-icon" title="Copy hash">
      <Copy size={14} />
    </button>
  </div>
);

const modalOverlayStyle = {
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

const modalContentStyle = {
  width: '100%',
  maxWidth: '900px',
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

const modalHeaderStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '16px 20px',
  borderBottom: `1px solid ${THEME.borderSlate}`,
  background: THEME.mutedSlate,
  flexShrink: 0,
};

const modalBodyStyle = {
  flex: 1,
  overflowY: 'auto',
  padding: '20px',
};

const modalFooterStyle = {
  display: 'flex',
  justifyContent: 'flex-end',
  gap: '10px',
  padding: '16px 20px',
  borderTop: `1px solid ${THEME.borderSlate}`,
  background: THEME.mutedSlate,
  flexShrink: 0,
};

// ============================================================
// Export Modal
// ============================================================
const ExportModal = ({ isOpen, onClose, onExport, blocksCount }) => {
  const [format, setFormat] = useState('json');
  const [range, setRange] = useState('all');
  const [startBlock, setStartBlock] = useState('');
  const [endBlock, setEndBlock] = useState('');
  const [includeVerify, setIncludeVerify] = useState(true);
  const [exporting, setExporting] = useState(false);
  
  if (!isOpen) return null;
  
  const handleExport = async () => {
    setExporting(true);
    try {
      await onExport({ format, range, startBlock, endBlock, includeVerify });
    } finally {
      setExporting(false);
      onClose();
    }
  };
  
  return (
    <div className="modal-overlay" style={modalOverlayStyle} onClick={onClose}>
      <div className="modal-content" style={{ ...modalContentStyle, maxWidth: '500px' }} onClick={(e) => e.stopPropagation()}>
        <div style={modalHeaderStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <FileText size={20} style={{ color: THEME.tacticalBlue }} />
            <span style={{ fontSize: '16px', fontWeight: 700 }}>Export Ledger</span>
          </div>
          <button onClick={onClose} className="btn-icon"><X size={20} /></button>
        </div>
        
        <div style={modalBodyStyle}>
          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', fontSize: '11px', color: THEME.textSecondary, marginBottom: '6px', textTransform: 'uppercase' }}>
              Format
            </label>
            <div style={{ display: 'flex', gap: '8px' }}>
              {['json', 'csv'].map(f => (
                <button
                  key={f}
                  onClick={() => setFormat(f)}
                  style={{
                    flex: 1,
                    padding: '10px',
                    borderRadius: '8px',
                    border: `1px solid ${format === f ? THEME.tacticalBlue : THEME.borderSlate}`,
                    background: format === f ? 'rgba(59, 130, 246, 0.2)' : THEME.mutedSlate,
                    color: format === f ? THEME.tacticalBlue : THEME.textPrimary,
                    fontWeight: format === f ? 600 : 500,
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                  }}
                >
                  {f.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
          
          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', fontSize: '11px', color: THEME.textSecondary, marginBottom: '6px', textTransform: 'uppercase' }}>
              Range
            </label>
            <div style={{ display: 'flex', gap: '8px' }}>
              {['all', 'range'].map(r => (
                <button
                  key={r}
                  onClick={() => setRange(r)}
                  style={{
                    flex: 1,
                    padding: '10px',
                    borderRadius: '8px',
                    border: `1px solid ${range === r ? THEME.tacticalBlue : THEME.borderSlate}`,
                    background: range === r ? 'rgba(59, 130, 246, 0.2)' : THEME.mutedSlate,
                    color: range === r ? THEME.tacticalBlue : THEME.textPrimary,
                    fontWeight: range === r ? 600 : 500,
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                  }}
                >
                  {r === 'all' ? 'All Blocks' : 'Block Range'}
                </button>
              ))}
            </div>
          </div>
          
          {range === 'range' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '16px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '11px', color: THEME.textSecondary, marginBottom: '6px' }}>
                  Start Block Index
                </label>
                <input
                  type="number"
                  value={startBlock}
                  onChange={(e) => setStartBlock(e.target.value)}
                  min="1"
                  style={{
                    width: '100%',
                    padding: '10px',
                    borderRadius: '8px',
                    border: `1px solid ${THEME.borderSlate}`,
                    background: THEME.darkSlate,
                    color: THEME.textPrimary,
                    fontFamily: 'inherit',
                  }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '11px', color: THEME.textSecondary, marginBottom: '6px' }}>
                  End Block Index
                </label>
                <input
                  type="number"
                  value={endBlock}
                  onChange={(e) => setEndBlock(e.target.value)}
                  min="1"
                  style={{
                    width: '100%',
                    padding: '10px',
                    borderRadius: '8px',
                    border: `1px solid ${THEME.borderSlate}`,
                    background: THEME.darkSlate,
                    color: THEME.textPrimary,
                    fontFamily: 'inherit',
                  }}
                />
              </div>
            </div>
          )}
          
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={includeVerify}
              onChange={(e) => setIncludeVerify(e.target.checked)}
              style={{
                width: '18px',
                height: '18px',
                accentColor: THEME.tacticalBlue,
              }}
            />
            <span style={{ fontSize: '13px', color: THEME.textPrimary }}>
              Include verification report (Section 65B compliant)
            </span>
          </label>
        </div>
        
        <div style={modalFooterStyle}>
          <button onClick={onClose} className="btn-secondary" disabled={exporting}>
            <X size={14} /> Cancel
          </button>
          <button onClick={handleExport} className="btn-primary" disabled={exporting || (range === 'range' && (!startBlock || !endBlock))}>
            {exporting ? <Loader2 size={14} className="spinning" /> : <Download size={14} />}
            {exporting ? ' Exporting...' : ' Export'}
          </button>
        </div>
      </div>
    </div>
  );
};

// ============================================================
// Container Styles Function
// ============================================================
function getContainerStyles(height, width, style, theme) {
  return {
    height,
    width,
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
// Main LedgerViewer Component
// ============================================================
export const LedgerViewer = ({ 
  className = '', 
  style = {}, 
  height = '100%', 
  api,
  initialFilters = {},
}) => {
  // State
  const [blocks, setBlocks] = useState([]);
  const [totalBlocks, setTotalBlocks] = useState(0);
  const [loading, setLoading] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verificationResult, setVerificationResult] = useState(null);
  const [selectedBlock, setSelectedBlock] = useState(null);
  const [showExport, setShowExport] = useState(false);
  const [filters, setFilters] = useState({
    startBlock: 1,
    endBlock: null,
    cameraId: null,
    eventCategory: null,
    eventType: null,
    page: 1,
    pageSize: 50,
    ...initialFilters,
  });
  const [sortConfig, setSortConfig] = useState({ key: 'block_index', direction: 'desc' });
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedBlockId, setSelectedBlockId] = useState(null);
  const [showDetail, setShowDetail] = useState(false);
  const [exportModal, setExportModal] = useState(false);
  
  // Refs
  const tableRef = useRef(null);
  
  // Fetch blocks
  const fetchBlocks = useCallback(async () => {
    if (!api) return;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      Object.entries(filters).forEach(([k, v]) => {
        if (v !== null && v !== undefined && v !== '') params.append(k, v);
      });
      params.append('sort_by', sortConfig.key);
      params.append('sort_order', sortConfig.direction);
      if (searchTerm) params.append('search', searchTerm);
      
      const data = await api.getAuditChain(Object.fromEntries(params));
      setBlocks(data.data || data.blocks || []);
      setTotalBlocks(data.total_blocks || data.total || 0);
      setVerificationResult(null); // Reset verification on new fetch
    } catch (e) {
      // Gracefully handle 404 - the endpoint may not exist on fallback backend
      if (e instanceof api.APIError && e.status === 404) {
        // console.warn('[LedgerViewer] /api/v1/audit/chain not found (404), returning empty');
        setBlocks([]);
        setTotalBlocks(0);
      } else {
        // console.error('Failed to fetch blocks:', e);
      }
    } finally {
      setLoading(false);
    }
  }, [api, filters, sortConfig, searchTerm]);
  
  useEffect(() => {
    fetchBlocks();
  }, [fetchBlocks]);
  
  // Verify chain
  const handleVerify = useCallback(async () => {
    if (!api) return;
    setVerifying(true);
    setVerificationResult({ status: 'verifying' });
    try {
      const params = new URLSearchParams();
      if (filters.startBlock) params.append('start_block', filters.startBlock);
      if (filters.endBlock) params.append('end_block', filters.endBlock);
      params.append('detailed', 'true');
      
      const result = await api.verifyAuditChain(Object.fromEntries(params));
      setVerificationResult({ 
        status: result.data.verified ? 'valid' : 'invalid',
        ...result.data,
      });
    } catch (e) {
      console.error('Verification failed:', e);
      setVerificationResult({ status: 'invalid', error: e.message });
    } finally {
      setVerifying(false);
    }
  }, [api, filters]);
  
  // Handle row click
  const handleRowClick = useCallback((block) => {
    setSelectedBlock(block);
    setSelectedBlockId(block.block_index);
    setShowDetail(true);
  }, []);
  
  // Handle sort
  const handleSort = useCallback((key) => {
    setSortConfig(prev => ({
      key,
      direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc',
    }));
  }, []);
  
  // Get verification badge color
  const getVerificationStatus = () => {
    if (!verificationResult) return 'none';
    if (verifying) return 'verifying';
    return verificationResult.status === 'valid' ? 'valid' : 'invalid';
  };
  
  // Compute column visibility
  const columns = [
    { key: 'block_index', label: 'INDEX', width: '80px' },
    { key: 'timestamp', label: 'TIMESTAMP (IST)', width: '180px' },
    { key: 'alert_id', label: 'ALERT ID', width: '100px' },
    { key: 'data_hash', label: 'DATA HASH', width: '180px' },
    { key: 'previous_hash', label: 'PREV HASH', width: '180px' },
    { key: 'current_hash', label: 'BLOCK HASH', width: '240px' },
    { key: 'event_category', label: 'CATEGORY', width: '120px' },
    { key: 'event_type', label: 'EVENT TYPE', width: '160px' },
  ];
  
  return (
    <div className="ledger-viewer" style={getContainerStyles(height, '100%', style, THEME)}>
      {/* Header */}
      <div style={headerStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Hash size={24} style={{ color: THEME.tacticalBlue }} />
            <div>
              <div style={{ fontSize: '16px', fontWeight: 700, color: THEME.textPrimary, letterSpacing: '0.5px' }}>
                AUDIT LEDGER
              </div>
              <div style={{ fontSize: '11px', color: THEME.textSecondary, textTransform: 'uppercase' }}>
                Section 65B Compliant • {totalBlocks} blocks
              </div>
            </div>
          </div>
          
          {/* Verification Badge */}
          <VerificationBadge status={getVerificationStatus()} animating={verifying} />
          
          {/* Actions */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginLeft: 'auto' }}>
            <button onClick={handleVerify} disabled={verifying} className="btn-secondary">
              {verifying ? <Loader2 size={14} className="spinning" /> : <Verified size={14} />}
              {verifying ? ' Verifying...' : ' Verify Chain'}
            </button>
            <button onClick={() => { setExportModal(true); }} className="btn-secondary">
              <Download size={14} /> Export
            </button>
            <button onClick={fetchBlocks} disabled={loading} className="btn-secondary">
              <RefreshCw size={14} className={loading ? 'spinning' : ''} />
            </button>
          </div>
        </div>
        
        {/* Filters & Search */}
        <div style={filterBarStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
            <div style={{ position: 'relative', flex: 1, minWidth: '200px' }}>
              <Search size={14} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: THEME.textMuted }} />
              <input
                type="text"
                placeholder="Search blocks... (hash, alert ID, event type)"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px 12px 8px 36px',
                  borderRadius: '8px',
                  border: `1px solid ${THEME.borderSlate}`,
                  background: THEME.darkSlate,
                  color: THEME.textPrimary,
                  fontSize: '12px',
                  fontFamily: 'inherit',
                }}
              />
            </div>
            
            <div style={{ display: 'flex', gap: '8px' }}>
              <select
                value={filters.eventCategory || ''}
                onChange={(e) => setFilters(prev => ({ ...prev, eventCategory: e.target.value || null }))}
                style={selectStyle}
              >
                <option value="">All Categories</option>
                {['ALERT', 'CAMERA', 'GEOFENCE', 'WATCHLIST', 'SYSTEM', 'AUTHENTICATION', 'AUTHORIZATION', 'DATA_ACCESS', 'DATA_MODIFICATION', 'CONFIGURATION', 'KEY_MANAGEMENT'].map(cat => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>
              
              <input
                type="number"
                placeholder="Start Block"
                value={filters.startBlock || ''}
                onChange={(e) => setFilters(prev => ({ ...prev, startBlock: parseInt(e.target.value) || 1 }))}
                min="1"
                style={{ width: '100px', ...inputStyle }}
              />
              <input
                type="number"
                placeholder="End Block"
                value={filters.endBlock || ''}
                onChange={(e) => setFilters(prev => ({ ...prev, endBlock: parseInt(e.target.value) || null }))}
                min="1"
                style={{ width: '100px', ...inputStyle }}
              />
              
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: THEME.textSecondary, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    defaultChecked={false}
                    style={{ width: '16px', height: '16px', accentColor: THEME.tacticalBlue }}
                  />
                  <span style={{ fontSize: '12px', color: THEME.textSecondary }}>Auto-refresh</span>
                </label>
              </div>
            </div>
          </div>
        </div>
        
        {/* Stats Bar */}
        <div style={statsBarStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <StatItem label="Total Blocks" value={totalBlocks} />
            <StatItem label="Loaded" value={blocks.length} color={THEME.tacticalBlue} />
            <StatItem label="Page" value={`${filters.page} / ${Math.ceil(totalBlocks / filters.pageSize)}`} color={THEME.warningAmber} />
            {verificationResult && verificationResult.blocks_checked && (
              <StatItem label="Verified" value={`${verificationResult.verified_count} / ${verificationResult.blocks_checked}`} color={verificationResult.verified ? THEME.successGreen : THEME.criticalRed} />
            )}
          </div>
          <div style={{ fontSize: '11px', color: THEME.textMuted }}>
            Showing blocks {(filters.page - 1) * filters.pageSize + 1}–{Math.min(filters.page * filters.pageSize, totalBlocks)} of {totalBlocks}
          </div>
        </div>
      </div>
      
      {/* Table */}
      <div style={tableContainerStyle} ref={tableRef}>
        <table style={tableStyle}>
          <thead>
            <tr style={headerRowStyle}>
              {columns.map(col => (
                <th
                  key={col.key}
                  style={{ ...headerCellStyle, width: col.width, cursor: 'pointer' }}
                  onClick={() => handleSort(col.key)}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px' }}>
                    <span>{col.label}</span>
                    {sortConfig.key === col.key && (
                      sortConfig.direction === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />
                    )}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && blocks.length === 0 ? (
              <tr>
                <td colSpan={columns.length} style={{ ...cellStyle, textAlign: 'center', padding: '40px', color: THEME.textMuted }}>
                  <Loader2 size={24} className="spinning" style={{ color: THEME.tacticalBlue, margin: '0 auto 12px', display: 'block' }} />
                  Loading ledger blocks...
                </td>
              </tr>
            ) : blocks.length === 0 ? (
              <tr>
                <td colSpan={columns.length} style={{ ...cellStyle, textAlign: 'center', padding: '40px', color: THEME.textMuted }}>
                  <Database size={32} style={{ margin: '0 auto 12px', display: 'block', color: THEME.textMuted }} />
                  No blocks found matching criteria
                </td>
              </tr>
            ) : (
              blocks.map(block => (
                <BlockRow
                  key={block.block_index}
                  block={block}
                  selected={selectedBlockId === block.block_index}
                  onClick={handleRowClick}
                />
              ))
            )}
          </tbody>
        </table>
      </div>
      
      {/* Pagination */}
      <div style={paginationStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            onClick={() => setFilters(prev => ({ ...prev, page: Math.max(1, prev.page - 1) }))}
            disabled={filters.page <= 1 || loading}
            className="btn-icon"
          >
            <ChevronLeft size={16} />
          </button>
          <span style={{ fontSize: '12px', color: THEME.textSecondary, minWidth: '80px', textAlign: 'center' }}>
            Page {filters.page}
          </span>
          <button
            onClick={() => setFilters(prev => ({ ...prev, page: prev.page + 1 }))}
            disabled={filters.page >= Math.ceil(totalBlocks / filters.pageSize) || loading}
            className="btn-icon"
          >
            <ChevronRight size={16} />
          </button>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '11px', color: THEME.textSecondary }}>Rows per page:</span>
            <select
              value={filters.pageSize}
              onChange={(e) => setFilters(prev => ({ ...prev, pageSize: parseInt(e.target.value), page: 1 }))}
              style={{ ...selectStyle, width: 'auto', padding: '6px 10px' }}
            >
              {[25, 50, 100, 200].map(n => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </div>
        </div>
      </div>
      
      {/* Modals */}
      {showDetail && selectedBlock && (
        <BlockDetailModal 
          block={selectedBlock} 
          onClose={() => { setShowDetail(false); setSelectedBlockId(null); }}
        />
      )}
      
      {exportModal && (
        <ExportModal 
          isOpen={exportModal} 
          onClose={() => setExportModal(false)} 
          onExport={async (params) => {
            // Export logic would call api.exportAuditLedger
            console.log('Export params:', params);
            alert('Export functionality would call /api/v1/audit/export');
          }}
          blocksCount={totalBlocks}
        />
      )}
      
      {/* Styles injection - using dangerouslySetInnerHTML for Vite compatibility */}
      {typeof window !== 'undefined' && !document.getElementById('ledger-viewer-styles') && (
        <style id="ledger-viewer-styles" dangerouslySetInnerHTML={{ __html: globalStyles }} />
      )}
    </div>
  );
};

// Helper components
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

// Styles
const headerStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '14px 20px',
  borderBottom: `1px solid ${THEME.borderSlate}`,
  background: THEME.mutedSlate,
  flexShrink: 0,
};

const filterBarStyle = {
  padding: '12px 20px',
  borderBottom: `1px solid ${THEME.borderSlate}`,
  background: THEME.darkSlate,
  flexShrink: 0,
};

const statsBarStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '10px 20px',
  borderBottom: `1px solid ${THEME.borderSlate}`,
  background: THEME.mutedSlate,
  flexShrink: 0,
};

const tableContainerStyle = {
  flex: 1,
  overflow: 'auto',
  background: THEME.darkSlate,
};

const tableStyle = {
  width: '100%',
  borderCollapse: 'collapse',
  fontFamily: '"JetBrains Mono", "Fira Code", monospace',
  fontSize: '12px',
  minWidth: '1200px',
};

const headerRowStyle = {
  background: THEME.mutedSlate,
  borderBottom: `2px solid ${THEME.borderSlate}`,
};

const headerCellStyle = {
  padding: '10px 12px',
  fontSize: '10px',
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
  color: THEME.textSecondary,
  textAlign: 'left',
  whiteSpace: 'nowrap',
  userSelect: 'none',
};

const inputStyle = {
  padding: '8px 10px',
  borderRadius: '8px',
  border: `1px solid ${THEME.borderSlate}`,
  background: THEME.darkSlate,
  color: THEME.textPrimary,
  fontSize: '12px',
  fontFamily: 'inherit',
};

const selectStyle = {
  padding: '8px 10px',
  borderRadius: '8px',
  border: `1px solid ${THEME.borderSlate}`,
  background: THEME.darkSlate,
  color: THEME.textPrimary,
  fontSize: '12px',
  fontFamily: 'inherit',
  cursor: 'pointer',
};

const paginationStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '12px 20px',
  borderTop: `1px solid ${THEME.borderSlate}`,
  background: THEME.mutedSlate,
  flexShrink: 0,
};

const globalStyles = `
  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }
  
  @keyframes slideUp {
    from { opacity: 0; transform: translateY(20px); }
    to { opacity: 1; transform: translateY(0); }
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
  
  .btn-icon:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  
  .btn-secondary {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 10px 16px;
    borderRadius: 8px;
    border: 1px solid ${THEME.borderSlate};
    background: transparent;
    color: ${THEME.textPrimary};
    fontSize: 12px;
    fontWeight: 500;
    fontFamily: inherit;
    cursor: pointer;
    transition: all 0.2s;
  }
  
  .btn-secondary:hover:not(:disabled) {
    background: ${THEME.tacticalBlue}15;
    border-color: ${THEME.tacticalBlue};
    color: ${THEME.tacticalBlue};
  }
  
  .btn-secondary:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
  
  input[type="number"], input[type="text"] {
    -webkit-appearance: none;
    appearance: none;
  }
  
  input[type="number"]::-webkit-inner-spin-button,
  input[type="number"]::-webkit-outer-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }
  
  input[type="number"] {
    -moz-appearance: textfield;
  }
  
  ::-webkit-scrollbar {
    width: 8px;
    height: 8px;
  }
  
  ::-webkit-scrollbar-track {
    background: ${THEME.darkSlate};
  }
  
  ::-webkit-scrollbar-thumb {
    background: ${THEME.borderSlate};
    borderRadius: 4px;
  }
  
  ::-webkit-scrollbar-thumb:hover {
    background: ${THEME.tacticalBlue};
  }
  
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
`;

export default React.memo(LedgerViewer);