/**
 * Optic Shield — Main Application Shell
 * 
 * Master C2 Tactical Dashboard interface layout.
 * Features:
 * - 3-column tactical grid layout (Sidebar + Main + Right Panel)
 * - Global state management (Context + Reducers)
 * - Theme provider (Dark Slate tactical theme)
 * - Authentication context (JWT + refresh)
 * - WebSocket connection manager
 * - Responsive layout (desktop/tablet)
 * - Routing: Dashboard, Alerts, Audit, Cameras, Geofences, Settings
 * - Integrates: MapGIS, AlertPanel, LedgerViewer, CameraGrid, GradCamModal
 */

import React, {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useContext,
  createContext,
  useReducer,
  useRef,
} from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  AlertTriangle,
  Database,
  Camera,
  MapPin,
  Settings,
  Shield,
  Menu,
  X,
  Bell,
  Wifi,
  WifiOff,
  User,
  LogOut,
  ChevronLeft,
  ChevronRight,
  Sun,
  Moon,
  HelpCircle,
  Info,
  Terminal,
  Shield as ShieldIcon,
  Globe,
  Layers,
  Zap,
  Search,
  Filter,
  Download,
  Upload,
  RefreshCw,
  Maximize2,
  Menu as MenuIcon,
  X as XIcon,
  Loader2,
  Target,
} from 'lucide-react';

// Import components
import MapGIS from './components/MapGIS';
import { AlertPanel } from './components/AlertPanel';
import { LedgerViewer } from './components/LedgerViewer';
import { CameraGrid } from './components/CameraGrid';
import { GradCamModal } from './components/GradCamModal';
import { TacticalFeedPanel } from './components/TacticalFeedPanel';
import ErrorBoundary from './components/ErrorBoundary';
import api, { isAuthenticated, getAuthToken, getConnectionStatus, onConnectionStatusChange, checkBackendHealth } from './services/api';

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
// Global State Context
// ============================================================
const AppContext = createContext(null);

const initialState = {
  // Auth
  user: null,
  token: null,
  refreshToken: null,
  authenticated: false,
  
  // UI State
  sidebarOpen: true,
  rightPanelOpen: false,
  rightPanelView: 'ledger', // 'ledger' | 'alerts' | 'cameras' | 'gradcam'
  fullscreenMap: false,
  theme: 'dark',
  
  // Data
  alerts: [],
  cameras: [],
  geofences: [],
  selectedCamera: null,
  selectedAlert: null,
  gradCamData: null,
  gradCamOpen: false,
  
  // API Connection Status (for dual-backend failover)
  apiConnectionStatus: 'offline', // 'online-colab' | 'online-modal' | 'offline'
  
  // Filters
  alertFilters: {},
  cameraFilters: {},
  ledgerFilters: {},
};

function appReducer(state, action) {
  switch (action.type) {
    case 'SET_AUTH':
      return { ...state, ...action.payload };
    case 'LOGOUT':
      return { ...state, user: null, token: null, refreshToken: null, authenticated: false };
    case 'TOGGLE_SIDEBAR':
      return { ...state, sidebarOpen: !state.sidebarOpen };
    case 'SET_SIDEBAR':
      return { ...state, sidebarOpen: action.payload };
    case 'TOGGLE_RIGHT_PANEL':
      return { ...state, rightPanelOpen: !state.rightPanelOpen };
    case 'SET_RIGHT_PANEL_VIEW':
      return { ...state, rightPanelView: action.payload, rightPanelOpen: true };
    case 'SET_FULLSCREEN_MAP':
      return { ...state, fullscreenMap: action.payload };
    case 'SET_ALERTS':
      return { ...state, alerts: action.payload };
    case 'ADD_ALERT':
      return { ...state, alerts: [action.payload, ...state.alerts].slice(0, 1000) };
    case 'UPDATE_ALERT':
      return { ...state, alerts: state.alerts.map(a => a.id === action.payload.id ? action.payload : a) };
    case 'SET_CAMERAS':
      return { ...state, cameras: action.payload };
    case 'SET_SELECTED_CAMERA':
      return { ...state, selectedCamera: action.payload };
    case 'SET_SELECTED_ALERT':
      return { ...state, selectedAlert: action.payload };
    case 'SET_GEOFENCES':
      return { ...state, geofences: action.payload };
    case 'SET_GRADCAM':
      return { ...state, gradCamData: action.payload, gradCamOpen: true };
    case 'CLOSE_GRADCAM':
      return { ...state, gradCamOpen: false, gradCamData: null };
    case 'SET_API_CONNECTION_STATUS':
      return { ...state, apiConnectionStatus: action.payload };
    case 'SET_ALERT_FILTERS':
      return { ...state, alertFilters: { ...state.alertFilters, ...action.payload } };
    case 'SET_CAMERA_FILTERS':
      return { ...state, cameraFilters: { ...state.cameraFilters, ...action.payload } };
    case 'SET_LEDGER_FILTERS':
      return { ...state, ledgerFilters: { ...state.ledgerFilters, ...action.payload } };
    case 'INCREMENT_ALERT_COUNT':
      return { ...state };
    default:
      return state;
  }
}

export function AppProvider({ children }) {
  const [state, dispatch] = useReducer(appReducer, initialState);
  
  // Initialize auth from localStorage
  useEffect(() => {
    const token = localStorage.getItem('optic_shield_auth_token');
    const refresh = localStorage.getItem('optic_shield_refresh_token');
    if (token) {
      dispatch({ type: 'SET_AUTH', payload: { token, refreshToken: refresh, authenticated: true } });
    }
  }, []);
  
  // Subscribe to API connection status changes (for dual-backend failover UI)
  useEffect(() => {
    const unsubscribe = onConnectionStatusChange((status) => {
      dispatch({ type: 'SET_API_CONNECTION_STATUS', payload: status });
    });
    // Set initial status
    dispatch({ type: 'SET_API_CONNECTION_STATUS', payload: getConnectionStatus() });
    return unsubscribe;
  }, []);
  
  const value = useMemo(() => ({ state, dispatch }), [state]);
  
  return (
    <AppContext.Provider value={value}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const context = useContext(AppContext);
  if (!context) throw new Error('useApp must be used within AppProvider');
  return context;
}

// ============================================================
// Layout Components
// ============================================================

// Sidebar Navigation
const Sidebar = () => {
  const { state, dispatch } = useApp();
  const navigate = useNavigate();
  const location = useLocation();
  const [apiHealth, setApiHealth] = useState({ healthy: false, checking: true, backend: 'unknown' });
  
  const navItems = [
    { path: '/', label: 'Dashboard', icon: LayoutDashboard, exact: true },
    { path: '/alerts', label: 'Alerts', icon: AlertTriangle },
    { path: '/audit', label: 'Audit Ledger', icon: Database },
    { path: '/cameras', label: 'Cameras', icon: Camera },
    { path: '/geofences', label: 'Geofences', icon: MapPin },
    { path: '/settings', label: 'Settings', icon: Settings },
  ];
  
  const handleLogout = () => {
    localStorage.removeItem('optic_shield_auth_token');
    localStorage.removeItem('optic_shield_refresh_token');
    dispatch({ type: 'LOGOUT' });
    navigate('/login');
  };
  
  // Check API health on mount and periodically
  useEffect(() => {
    const checkHealth = async () => {
      if (!state.authenticated) return;
      const health = await api.checkBackendHealth();
      setApiHealth({ 
        healthy: health.healthy, 
        checking: false, 
        backend: health.connectionStatus 
      });
    };
    
    checkHealth();
    const interval = setInterval(checkHealth, 30000);
    return () => clearInterval(interval);
  }, [state.authenticated]);
  
  // Get API status display
  const getApiStatusDisplay = () => {
    if (apiHealth.checking) {
      return { text: 'Checking...', color: THEME.warningAmber, icon: Loader2, pulse: true };
    }
    if (apiHealth.healthy) {
      if (apiHealth.backend === 'online-colab') {
        return { text: 'ONLINE (Colab GPU)', color: THEME.successGreen, icon: Wifi };
      }
      if (apiHealth.backend === 'online-modal') {
        return { text: 'ONLINE (Modal Fallback)', color: THEME.tacticalBlue, icon: Wifi };
      }
      return { text: 'ONLINE', color: THEME.successGreen, icon: Wifi };
    }
    return { text: 'OFFLINE', color: THEME.criticalRed, icon: WifiOff };
  };
  
  const apiStatus = getApiStatusDisplay();
  const StatusIcon = apiStatus.icon;
  
  return (
    <aside style={sidebarStyle(state)}>
      {/* Logo */}
      <div style={sidebarHeaderStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <ShieldIcon size={28} style={{ color: THEME.tacticalBlue }} />
          <span style={{ fontSize: '16px', fontWeight: 700, color: THEME.textPrimary, letterSpacing: '0.5px' }}>
            OPTIC SHIELD
          </span>
        </div>
        {state.sidebarOpen && (
          <span style={{ fontSize: '10px', color: THEME.textMuted, textTransform: 'uppercase', letterSpacing: '1px' }}>
            C2 TACTICAL
          </span>
        )}
      </div>
      
      {/* Navigation */}
      <nav style={navStyle}>
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {navItems.map(item => {
            const isActive = location.pathname === item.path || (item.path !== '/' && location.pathname.startsWith(item.path));
            return (
              <li key={item.path} style={{ marginBottom: '4px' }}>
                <button
                  onClick={() => navigate(item.path)}
                  style={{
                    ...navItemStyle,
                    background: isActive ? 'rgba(59, 130, 246, 0.15)' : 'transparent',
                    borderLeft: isActive ? `3px solid ${THEME.tacticalBlue}` : '3px solid transparent',
                    color: isActive ? THEME.tacticalBlue : THEME.textSecondary,
                  }}
                >
                  {state.sidebarOpen && (
                    <>
                      <item.icon size={18} style={{ flexShrink: 0 }} />
                      <span style={{ flex: 1, textAlign: 'left', fontSize: '13px', fontWeight: 500 }}>
                        {item.label}
                      </span>
                      {isActive && <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: THEME.tacticalBlue, marginLeft: 'auto' }} />}
                    </>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>
      
      {/* Bottom: User & Status */}
      {state.sidebarOpen && (
        <div style={sidebarFooterStyle}>
          {/* API Health Status (REST-based) */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px', borderRadius: '8px', background: THEME.mutedSlate, marginBottom: '10px' }}>
            <StatusIcon 
              size={14} 
              style={{ 
                color: apiStatus.color, 
                animation: apiStatus.pulse ? 'pulse 1.5s ease-in-out infinite' : 'none',
              }} 
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: '11px', fontWeight: 600, color: THEME.textPrimary }}>API STATUS</div>
              <div style={{ fontSize: '10px', color: apiStatus.color, textTransform: 'uppercase', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {apiStatus.text}
              </div>
            </div>
          </div>
          
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px' }}>
            <div style={{ width: '36px', height: '36px', borderRadius: '50%', background: 'rgba(59, 130, 246, 0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: THEME.tacticalBlue }}>
              <User size={18} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: '12px', fontWeight: 600, color: THEME.textPrimary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {state.user?.username || 'Operator'}
              </div>
              <div style={{ fontSize: '10px', color: THEME.textSecondary, textTransform: 'uppercase' }}>
                {state.user?.role || 'TACTICAL OPERATOR'}
              </div>
            </div>
          </div>
          <button onClick={handleLogout} style={{ width: 'calc(100% - 20px)', margin: '0 10px 10px', ...btnStyle, background: 'rgba(239, 68, 68, 0.15)', borderColor: THEME.criticalRed, color: THEME.criticalRed }}>
            <LogOut size={14} /> Sign Out
          </button>
        </div>
        )}
    </aside>
  );
};

// Header
const Header = () => {
  const { state, dispatch } = useApp();
  const [apiHealth, setApiHealth] = useState({ healthy: false, checking: true, backend: 'unknown' });
  
  // Check API health on mount and periodically (REST-based, like Sidebar)
  useEffect(() => {
    const checkHealth = async () => {
      if (!state.authenticated) return;
      const health = await api.checkBackendHealth();
      setApiHealth({ 
        healthy: health.healthy, 
        checking: false, 
        backend: health.connectionStatus 
      });
    };
    
    checkHealth();
    const interval = setInterval(checkHealth, 30000);
    return () => clearInterval(interval);
  }, [state.authenticated]);
  
  // Get display text and color for API connection status
  const getApiStatusDisplay = () => {
    if (apiHealth.checking) {
      return { text: 'Checking...', color: THEME.warningAmber, icon: Loader2, pulse: true };
    }
    if (apiHealth.healthy) {
      if (apiHealth.backend === 'online-colab') {
        return { text: 'ONLINE (Colab GPU)', color: THEME.successGreen, icon: Wifi };
      }
      if (apiHealth.backend === 'online-modal') {
        return { text: 'ONLINE (Modal Fallback)', color: THEME.tacticalBlue, icon: Wifi };
      }
      return { text: 'ONLINE', color: THEME.successGreen, icon: Wifi };
    }
    return { text: 'OFFLINE', color: THEME.criticalRed, icon: WifiOff };
  };
  
  const apiStatus = getApiStatusDisplay();
  const StatusIcon = apiStatus.icon;
  
  return (
    <header style={headerStyle(state)}>
      <div style={headerLeftStyle}>
        <button onClick={() => dispatch({ type: 'TOGGLE_SIDEBAR' })} className="btn-icon" aria-label="Toggle Sidebar">
          {state.sidebarOpen ? <ChevronLeft size={20} /> : <ChevronRight size={20} />}
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginLeft: '12px' }}>
          <ShieldIcon size={20} style={{ color: THEME.tacticalBlue }} />
          <span style={{ fontSize: '18px', fontWeight: 700, color: THEME.textPrimary, letterSpacing: '0.5px' }}>
            OPTIC SHIELD
          </span>
          <span style={{ fontSize: '10px', color: THEME.textMuted, textTransform: 'uppercase', letterSpacing: '1px', background: 'rgba(59, 130, 246, 0.15)', padding: '2px 8px', borderRadius: '4px', border: `1px solid ${THEME.tacticalBlue}40` }}>
            C2 TACTICAL
          </span>
        </div>
      </div>
      
      <div style={headerCenterStyle}>
        {/* API Connection Status */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 12px', borderRadius: '8px', background: `${apiStatus.color}20`, border: `1px solid ${apiStatus.color}40` }}>
          <StatusIcon size={14} style={{ color: apiStatus.color }} />
          <span style={{ fontSize: '11px', fontWeight: 600, color: apiStatus.color, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            {apiStatus.text}
          </span>
        </div>
      </div>
      
      <div style={headerRightStyle}>
        {/* Notifications */}
        <button className="btn-icon" style={{ position: 'relative' }}>
          <Bell size={20} />
          <span style={{ position: 'absolute', top: '2px', right: '2px', width: '8px', height: '8px', borderRadius: '50%', background: THEME.criticalRed, border: '2px solid #090D16' }} />
        </button>
        
        {/* Theme Toggle */}
        <button onClick={() => dispatch({ type: 'SET_THEME', payload: 'dark' })} className="btn-icon" title="Theme" aria-label="Toggle Theme">
          <Moon size={20} />
        </button>
        
        {/* Fullscreen Map Toggle */}
        <button onClick={() => dispatch({ type: 'SET_FULLSCREEN_MAP', payload: true })} className="btn-icon" title="Fullscreen Map">
          <Maximize2 size={20} />
        </button>
        
        {/* User Menu */}
        <div style={{ position: 'relative' }}>
          <button className="btn-icon" style={{ padding: '6px', borderRadius: '8px', background: 'rgba(59, 130, 246, 0.1)', borderColor: THEME.tacticalBlue }}>
            <User size={20} style={{ color: THEME.tacticalBlue }} />
          </button>
        </div>
      </div>
    </header>
  );
};

// Right Panel
const RightPanel = () => {
  const { state, dispatch } = useApp();
  
  if (!state.rightPanelOpen) return null;
  
  return (
    <aside style={rightPanelStyle(state)}>
      <div style={rightPanelHeaderStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {state.rightPanelView === 'ledger' && <Database size={20} style={{ color: THEME.tacticalBlue }} />}
          {state.rightPanelView === 'alerts' && <AlertTriangle size={20} style={{ color: THEME.criticalRed }} />}
          {state.rightPanelView === 'cameras' && <Camera size={20} style={{ color: THEME.successGreen }} />}
          {state.rightPanelView === 'gradcam' && <Zap size={20} style={{ color: THEME.warningAmber }} />}
          <span style={{ fontSize: '14px', fontWeight: 600, color: THEME.textPrimary, textTransform: 'capitalize' }}>
            {state.rightPanelView === 'ledger' ? 'Audit Ledger' : state.rightPanelView === 'alerts' ? 'Alert Stream' : state.rightPanelView === 'cameras' ? 'Cameras' : 'Grad-CAM'}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button onClick={() => dispatch({ type: 'SET_RIGHT_PANEL_VIEW', payload: 'ledger' })} 
            className={`btn-icon ${state.rightPanelView === 'ledger' ? 'active' : ''}`} title="Audit Ledger">
            <Database size={16} />
          </button>
          <button onClick={() => dispatch({ type: 'SET_RIGHT_PANEL_VIEW', payload: 'alerts' })} 
            className={`btn-icon ${state.rightPanelView === 'alerts' ? 'active' : ''}`} title="Alert Stream">
            <AlertTriangle size={16} />
          </button>
          <button onClick={() => dispatch({ type: 'SET_RIGHT_PANEL_VIEW', payload: 'cameras' })} 
            className={`btn-icon ${state.rightPanelView === 'cameras' ? 'active' : ''}`} title="Cameras">
            <Camera size={16} />
          </button>
          <button onClick={() => dispatch({ type: 'TOGGLE_RIGHT_PANEL' })} className="btn-icon">
            <X size={16} />
          </button>
        </div>
      </div>
      
      <div style={rightPanelContentStyle}>
        {state.rightPanelView === 'ledger' && (
          <LedgerViewer 
            api={api}
            height="100%"
            initialFilters={state.ledgerFilters}
          />
        )}
        {state.rightPanelView === 'alerts' && (
          <AlertPanel 
            api={api}
            height="100%"
            width="100%"
            initialFilters={state.alertFilters}
            onAlertAction={async (alert, action) => {
              // Handle alert actions
              console.log('Alert action:', action, alert);
            }}
            onOpenGradCam={(alert) => {
              dispatch({ type: 'SET_GRADCAM', payload: { 
                model: 'YOLOv8', 
                confidence: alert.confidence, 
                prediction: alert.alert_type?.replace(/_/g, ' '), 
                block_hash: alert.audit_block_hash,
                details: { track_id: alert.track_id, camera_id: alert.camera_id }
              }});
              dispatch({ type: 'SET_RIGHT_PANEL_VIEW', payload: 'gradcam' });
            }}
          />
        )}
        {state.rightPanelView === 'cameras' && (
          <CameraGrid 
            cameras={state.cameras}
            api={api}
            height="100%"
            width="100%"
            onCameraSelect={(camera) => dispatch({ type: 'SET_SELECTED_CAMERA', payload: camera })}
            onPTZCommand={(cameraId, command) => console.log('PTZ:', cameraId, command)}
            selectedCameraId={state.selectedCamera?.id}
          />
        )}
        {state.rightPanelView === 'gradcam' && state.gradCamOpen && (
          <GradCamModal
            isOpen={true}
            onClose={() => dispatch({ type: 'CLOSE_GRADCAM' })}
            alert={state.selectedAlert}
            gradCamData={state.gradCamData}
            onDispatch={(alert) => console.log('Dispatch:', alert)}
          />
        )}
      </div>
    </aside>
  );
};

// Main App Component
const AppLayout = () => {
  const { state } = useApp();
  
  return (
    <div style={appStyle}>
      <Header />
      <div style={mainStyle(state)}>
        <Sidebar />
        <main style={mainContentStyle}>
          {/* Page Routes */}
          <Routes>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/alerts" element={<AlertsPage />} />
            <Route path="/audit" element={<AuditPage />} />
            <Route path="/cameras" element={<CamerasPage />} />
            <Route path="/geofences" element={<GeofencesPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
        <RightPanel />
      </div>
      
      {/* Grad-CAM Modal (Global) */}
      {state.gradCamOpen && state.gradCamData && (
        <GradCamModal
          isOpen={true}
          onClose={() => dispatch({ type: 'CLOSE_GRADCAM' })}
          alert={state.selectedAlert}
          gradCamData={state.gradCamData}
          onDispatch={(alert) => console.log('Dispatch:', alert)}
        />
      )}
      
      {/* Global Styles injected via component style sheets */}
    </div>
  );
};

const PageLoader = () => (
  <div style={{
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100vh',
    background: THEME.darkSlate,
    color: THEME.textSecondary,
    fontFamily: '"JetBrains Mono", monospace',
  }}>
    <Loader2 size={48} className="spinning" style={{ color: THEME.tacticalBlue, marginBottom: '16px' }} />
    <div style={{ fontSize: '14px' }}>Loading tactical interface...</div>
  </div>
);

// Placeholder Pages (to be implemented)
// Fallback components for ErrorBoundary
const MapFallback = () => <div style={{ padding: '20px', color: THEME.textMuted, textAlign: 'center' }}>Map unavailable</div>;
const CameraGridFallback = () => <div style={{ padding: '20px', color: THEME.textMuted, textAlign: 'center' }}>Camera grid unavailable</div>;
const AlertPanelFallback = () => <div style={{ padding: '20px', color: THEME.textMuted, textAlign: 'center' }}>Alert stream unavailable</div>;
const LedgerViewerFallback = () => <div style={{ padding: '20px', color: THEME.textMuted, textAlign: 'center' }}>Ledger unavailable</div>;

const DashboardPage = () => {
  const { state, dispatch } = useApp();
  const [detectionCounts, setDetectionCounts] = useState({ person: 0, vehicle: 0, 'license-plate': 0, total: 0 });
  const [healthStatus, setHealthStatus] = useState({ healthy: false, checking: true, backend: 'unknown' });
  
  // Load initial data
  useEffect(() => {
    const loadDashboardData = async () => {
      try {
        const [cameras, alerts, geofences, auditStats, health] = await Promise.allSettled([
          api.getCameras({ limit: 100 }),
          api.getAlerts({ limit: 100 }),
          api.getGeofences({ limit: 100 }),
          api.getAuditStats(),
          api.checkBackendHealth(),
        ]);
        
        if (cameras.status === 'fulfilled') {
          dispatch({ type: 'SET_CAMERAS', payload: cameras.value || [] });
        }
        if (alerts.status === 'fulfilled') {
          dispatch({ type: 'SET_ALERTS', payload: alerts.value || [] });
        }
        if (geofences.status === 'fulfilled') {
          dispatch({ type: 'SET_GEOFENCES', payload: geofences.value || [] });
        }
        if (health.status === 'fulfilled') {
          setHealthStatus({ 
            healthy: health.value.healthy, 
            checking: false, 
            backend: health.value.connectionStatus 
          });
        }
      } catch (error) {
        console.error('Failed to load dashboard data:', error);
        setHealthStatus({ healthy: false, checking: false, backend: 'offline' });
      }
    };
    
    if (state.authenticated) {
      loadDashboardData();
    }
  }, [state.authenticated, dispatch]);
  
  // Periodic health check
  useEffect(() => {
    const interval = setInterval(async () => {
      const health = await api.checkBackendHealth();
      setHealthStatus({ 
        healthy: health.healthy, 
        checking: false, 
        backend: health.connectionStatus 
      });
    }, 30000); // Every 30 seconds
    
    return () => clearInterval(interval);
  }, []);
  
  // Handle detection updates from TacticalFeedPanel
  const handleDetectionUpdate = useCallback((newDetections) => {
    setDetectionCounts(prev => {
      const counts = { ...prev };
      newDetections.forEach(det => {
        const key = det.class_name?.toLowerCase() || 'default';
        if (counts.hasOwnProperty(key)) {
          counts[key]++;
        }
        counts.total++;
      });
      return counts;
    });
  }, []);
  
  // Handle alert generation from detections
  const handleAlertGenerated = useCallback((alertData) => {
    const newAlert = {
      id: `det-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      type: 'detection',
      severity: alertData.class_name === 'person' ? 3 : 2,
      title: `${alertData.class_name.toUpperCase()} Detected`,
      message: `Confidence: ${Math.round(alertData.confidence * 100)}%${alertData.track_id ? ` | Track: #${alertData.track_id}` : ''}`,
      camera_id: 'tactical-feed',
      location: 'Tactical Feed Analysis',
      timestamp: alertData.timestamp,
      status: 'NEW',
      metadata: alertData,
    };
    dispatch({ type: 'ADD_ALERT', payload: newAlert });
  }, [dispatch]);
  
  // Dynamic stats based on state
  const stats = useMemo(() => {
    // Safeguard: ensure arrays are arrays before using .filter/.length
    const cameras = Array.isArray(state.cameras) ? state.cameras : [];
    const alerts = Array.isArray(state.alerts) ? state.alerts : [];
    const geofences = Array.isArray(state.geofences) ? state.geofences : [];
    
    return [
      { 
        label: 'Active Cameras', 
        value: cameras.filter(c => c.status === 'online').length, 
        icon: Camera, 
        color: THEME.successGreen,
        trend: '+2',
      },
      { 
        label: 'Active Alerts', 
        value: alerts.filter(a => a.status === 'NEW' || a.status === 'ACKNOWLEDGED').length, 
        icon: AlertTriangle, 
        color: THEME.criticalRed,
        trend: '+3',
      },
      { 
        label: 'Geofences', 
        value: geofences.length, 
        icon: MapPin, 
        color: THEME.tacticalBlue,
        trend: '0',
      },
      { 
        label: 'Total Detections', 
        value: detectionCounts.total || 0, 
        icon: Target, 
        color: THEME.warningAmber,
        trend: detectionCounts.total > 0 ? `+${detectionCounts.total}` : '0',
      },
    ];
  }, [state.cameras, state.alerts, state.geofences, detectionCounts]);
  
  return (
    <div style={{ padding: '24px', height: '100%', display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ fontSize: '28px', fontWeight: 700, color: THEME.textPrimary }}>TACTICAL DASHBOARD</h1>
          <p style={{ color: THEME.textSecondary, marginTop: '4px' }}>Border Surveillance Command & Control</p>
        </div>
        <div style={{ display: 'flex', gap: '12px' }}>
          <button className="btn-primary"><Download size={16} /> Export Report</button>
          <button className="btn-secondary"><RefreshCw size={16} /> Refresh</button>
        </div>
      </div>
      
      {/* Stats Grid - Dynamic */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '16px' }}>
        {stats.map((stat, i) => (
          <div key={i} style={statCardStyle}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
              <stat.icon size={24} style={{ color: stat.color }} />
              <span style={{ fontSize: '11px', color: THEME.textSecondary, textTransform: 'uppercase' }}>{stat.label}</span>
            </div>
            <div style={{ 
              display: 'flex', 
              alignItems: 'baseline', 
              gap: '8px',
              fontSize: '36px', 
              fontWeight: 700, 
              color: THEME.textPrimary, 
              fontFamily: 'monospace' 
            }}>
              {stat.value}
              {stat.trend && stat.trend !== '0' && (
                <span style={{ 
                  fontSize: '14px', 
                  fontWeight: 600, 
                  color: stat.trend.startsWith('+') ? THEME.successGreen : THEME.textMuted 
                }}>
                  {stat.trend}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
      
      {/* Tactical Feed & Frame Analysis Panel */}
      <ErrorBoundary name="TacticalFeedPanel" fallback={() => <div style={{ padding: '20px', color: THEME.textMuted, textAlign: 'center', background: THEME.mutedSlate, border: `1px solid ${THEME.borderSlate}`, borderRadius: '12px' }}>Tactical Feed unavailable</div>}>
        <TacticalFeedPanel 
          onDetectionUpdate={handleDetectionUpdate}
          onAlertGenerated={handleAlertGenerated}
          cameraId={state.selectedCamera?.id || null}
        />
      </ErrorBoundary>
      
      {/* Main Content Area */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '16px', flex: 1, minHeight: 0 }}>
        {/* Map + Camera Grid */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ background: THEME.mutedSlate, border: `1px solid ${THEME.borderSlate}`, borderRadius: '12px', height: '400px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: THEME.textMuted }}>
            <ErrorBoundary name="MapGIS" fallback={MapFallback}>
              <MapGIS 
                cameras={state.cameras}
                geofences={state.geofences}
                alerts={state.alerts}
                height="100%"
                style={{ width: '100%' }}
              />
            </ErrorBoundary>
          </div>
          <div style={{ background: THEME.mutedSlate, border: `1px solid ${THEME.borderSlate}`, borderRadius: '12px', height: '300px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: THEME.textMuted }}>
            <ErrorBoundary name="CameraGrid" fallback={CameraGridFallback}>
              <CameraGrid cameras={state.cameras} height="100%" compact />
            </ErrorBoundary>
          </div>
        </div>
        
        {/* Right: Alert Panel + Ledger */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ background: THEME.mutedSlate, border: `1px solid ${THEME.borderSlate}`, borderRadius: '12px', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '12px 16px', borderBottom: `1px solid ${THEME.borderSlate}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontWeight: 600, color: THEME.textPrimary }}>LIVE ALERT STREAM</span>
              <span style={{ fontSize: '10px', color: THEME.successGreen, textTransform: 'uppercase' }}>● LIVE</span>
            </div>
            <ErrorBoundary name="AlertPanel" fallback={AlertPanelFallback}>
              <AlertPanel api={api} height="100%" width="100%" />
            </ErrorBoundary>
          </div>
          <div style={{ background: THEME.mutedSlate, border: `1px solid ${THEME.borderSlate}`, borderRadius: '12px', height: '300px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: THEME.textMuted }}>
            <ErrorBoundary name="LedgerViewer" fallback={LedgerViewerFallback}>
              <LedgerViewer api={api} height="100%" />
            </ErrorBoundary>
          </div>
        </div>
      </div>
    </div>
  );
};

const AlertsPage = () => (
  <div style={{ padding: '24px', height: '100%' }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
      <div>
        <h1 style={{ fontSize: '28px', fontWeight: 700 }}>ALERTS</h1>
        <p style={{ color: THEME.textSecondary }}>Threat incident management</p>
      </div>
    </div>
    <ErrorBoundary name="AlertPanel" fallback={AlertPanelFallback}>
      <AlertPanel api={api} height="calc(100vh - 160px)" width="100%" />
    </ErrorBoundary>
  </div>
);

const AuditPage = () => (
  <div style={{ padding: '24px', height: '100%' }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
      <div>
        <h1 style={{ fontSize: '28px', fontWeight: 700 }}>AUDIT LEDGER</h1>
        <p style={{ color: THEME.textSecondary }}>Section 65B compliant audit trail</p>
      </div>
    </div>
    <LedgerViewer api={api} height="calc(100vh - 160px)" />
  </div>
);

const CamerasPage = () => (
  <div style={{ padding: '24px', height: '100%' }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
      <div>
        <h1 style={{ fontSize: '28px', fontWeight: 700 }}>CAMERAS</h1>
        <p style={{ color: THEME.textSecondary }}>Border surveillance network</p>
      </div>
    </div>
    <CameraGrid cameras={[]} api={api} height="calc(100vh - 160px)" />
  </div>
);

const GeofencesPage = () => (
  <div style={{ padding: '24px', height: '100%' }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
      <div>
        <h1 style={{ fontSize: '28px', fontWeight: 700 }}>GEOFENCES</h1>
        <p style={{ color: THEME.textSecondary }}>Virtual perimeter management</p>
      </div>
    </div>
    <div style={{ background: THEME.mutedSlate, border: `1px solid ${THEME.borderSlate}`, borderRadius: '12px', height: 'calc(100vh - 160px)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: THEME.textMuted }}>
      <MapPin size={64} style={{ marginBottom: '16px', opacity: 0.3 }} />
      <div>Geofence management interface</div>
    </div>
  </div>
);

const SettingsPage = () => {
  const [apiHealth, setApiHealth] = useState({ primary: null, backup: null, checking: true });
  
  useEffect(() => {
    const checkEndpoints = async () => {
      try {
        // Check primary endpoint
        const primaryHealth = await fetch(`${import.meta.env.VITE_API_PRIMARY_URL || 'https://trailing-matriarch-marshland.ngrok-free.dev'}/api/v1/health`, {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
        }).then(r => r.ok).catch(() => false);
        
        // Check backup endpoint
        const backupHealth = await fetch(`${import.meta.env.VITE_API_BACKUP_URL || 'https://mgtd2104--optic-shield-backend-health.modal.run'}/api/v1/health`, {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
        }).then(r => r.ok).catch(() => false);
        
        setApiHealth({ 
          primary: primaryHealth ? 'connected' : 'disconnected',
          backup: backupHealth ? 'connected' : 'disconnected',
          checking: false 
        });
      } catch (error) {
        setApiHealth({ 
          primary: 'disconnected',
          backup: 'disconnected',
          checking: false 
        });
      }
    };
    
    checkEndpoints();
    const interval = setInterval(checkEndpoints, 60000);
    return () => clearInterval(interval);
  }, []);
  
  return (
    <div style={{ padding: '24px', height: '100%', maxWidth: '800px' }}>
      <h1 style={{ fontSize: '28px', fontWeight: 700, marginBottom: '24px' }}>SETTINGS</h1>
      
      <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
        <section style={{ background: THEME.mutedSlate, border: `1px solid ${THEME.borderSlate}`, borderRadius: '12px', padding: '24px' }}>
          <h2 style={{ fontSize: '18px', fontWeight: 600, marginBottom: '16px', color: THEME.textPrimary }}>API Pipeline Configuration</h2>
          <p style={{ fontSize: '13px', color: THEME.textSecondary, marginBottom: '20px' }}>
            Endpoints are configured via environment variables (.env) for security. 
            Status reflects real-time health checks.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '16px' }}>
            {/* Primary Pipeline Card */}
            <div style={{ 
              background: THEME.darkSlate, 
              border: `1px solid ${apiHealth.checking ? THEME.warningAmber : (apiHealth.primary === 'connected' ? THEME.successGreen : THEME.criticalRed)}`, 
              borderRadius: '12px', 
              padding: '20px',
              transition: 'border-color 0.3s',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <div style={{ 
                    width: '10px', 
                    height: '10px', 
                    borderRadius: '50%', 
                    background: apiHealth.checking ? THEME.warningAmber : (apiHealth.primary === 'connected' ? THEME.successGreen : THEME.criticalRed),
                    animation: apiHealth.checking ? 'pulse 1.5s ease-in-out infinite' : 'none',
                  }} />
                  <span style={{ fontSize: '13px', fontWeight: 600, color: THEME.textPrimary }}>Primary Pipeline</span>
                </div>
                <span style={{ 
                  fontSize: '10px', 
                  fontWeight: 600, 
                  textTransform: 'uppercase',
                  color: apiHealth.checking ? THEME.warningAmber : (apiHealth.primary === 'connected' ? THEME.successGreen : THEME.criticalRed),
                  background: `rgba(${apiHealth.checking ? '245, 158, 11' : (apiHealth.primary === 'connected' ? '16, 185, 129' : '239, 68, 68')}, 0.15)`,
                  padding: '4px 10px',
                  borderRadius: '20px',
                }}>
                  {apiHealth.checking ? 'CHECKING...' : (apiHealth.primary === 'connected' ? 'CONNECTED' : 'DISCONNECTED')}
                </span>
              </div>
              <div style={{ fontSize: '12px', color: THEME.textSecondary, marginBottom: '8px', fontFamily: 'monospace' }}>
                Colab GPU Backend
              </div>
              <div style={{ fontSize: '11px', color: THEME.textMuted, fontFamily: 'monospace', wordBreak: 'break-all' }}>
                Configured via VITE_API_PRIMARY_URL
              </div>
              <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: `1px solid ${THEME.borderSlate}`, fontSize: '11px', color: THEME.textMuted }}>
                Environment: <code style={{ color: THEME.textSecondary }}>.env</code>
              </div>
            </div>
            
            {/* Backup Pipeline Card */}
            <div style={{ 
              background: THEME.darkSlate, 
              border: `1px solid ${apiHealth.checking ? THEME.warningAmber : (apiHealth.backup === 'connected' ? THEME.successGreen : THEME.criticalRed)}`, 
              borderRadius: '12px', 
              padding: '20px',
              transition: 'border-color 0.3s',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <div style={{ 
                    width: '10px', 
                    height: '10px', 
                    borderRadius: '50%', 
                    background: apiHealth.checking ? THEME.warningAmber : (apiHealth.backup === 'connected' ? THEME.successGreen : THEME.criticalRed),
                    animation: apiHealth.checking ? 'pulse 1.5s ease-in-out infinite' : 'none',
                  }} />
                  <span style={{ fontSize: '13px', fontWeight: 600, color: THEME.textPrimary }}>Backup Pipeline</span>
                </div>
                <span style={{ 
                  fontSize: '10px', 
                  fontWeight: 600, 
                  textTransform: 'uppercase',
                  color: apiHealth.checking ? THEME.warningAmber : (apiHealth.backup === 'connected' ? THEME.successGreen : THEME.criticalRed),
                  background: `rgba(${apiHealth.checking ? '245, 158, 11' : (apiHealth.backup === 'connected' ? '16, 185, 129' : '239, 68, 68')}, 0.15)`,
                  padding: '4px 10px',
                  borderRadius: '20px',
                }}>
                  {apiHealth.checking ? 'CHECKING...' : (apiHealth.backup === 'connected' ? 'CONNECTED' : 'DISCONNECTED')}
                </span>
              </div>
              <div style={{ fontSize: '12px', color: THEME.textSecondary, marginBottom: '8px' }}>
                Modal Serverless GPU
              </div>
              <div style={{ fontSize: '11px', color: THEME.textMuted, fontFamily: 'monospace', wordBreak: 'break-all' }}>
                Configured via VITE_API_BACKUP_URL
              </div>
              <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: `1px solid ${THEME.borderSlate}`, fontSize: '11px', color: THEME.textMuted }}>
                Environment: <code style={{ color: THEME.textSecondary }}>.env</code>
              </div>
            </div>
          </div>
          
          <div style={{ marginTop: '20px', paddingTop: '20px', borderTop: `1px solid ${THEME.borderSlate}` }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}>
              <input type="checkbox" defaultChecked style={{ width: '18px', height: '18px', accentColor: THEME.tacticalBlue }} />
              <span style={{ fontSize: '13px', color: THEME.textPrimary }}>Enable Dual-Endpoint Failover (8s timeout)</span>
            </label>
          </div>
          <div style={{ marginTop: '12px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}>
              <input type="checkbox" defaultChecked style={{ width: '18px', height: '18px', accentColor: THEME.tacticalBlue }} />
              <span style={{ fontSize: '13px', color: THEME.textPrimary }}>Audio Alarms for Critical Alerts</span>
            </label>
          </div>
        </section>
        
        <section style={{ background: THEME.mutedSlate, border: `1px solid ${THEME.borderSlate}`, borderRadius: '12px', padding: '24px' }}>
          <h2 style={{ fontSize: '18px', fontWeight: 600, marginBottom: '16px' }}>Security</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '12px', color: THEME.textSecondary, marginBottom: '6px', textTransform: 'uppercase' }}>AES-256 Encryption</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <ShieldIcon size={18} style={{ color: THEME.successGreen }} />
                <span style={{ color: THEME.successGreen, fontWeight: 600 }}>Enabled (GCM Mode)</span>
              </div>
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '12px', color: THEME.textSecondary, marginBottom: '6px', textTransform: 'uppercase' }}>JWT Token Expiry</label>
              <input type="text" value="30 minutes (access) / 7 days (refresh)" style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: `1px solid ${THEME.borderSlate}`, background: THEME.darkSlate, color: THEME.textPrimary, fontFamily: 'inherit', fontSize: '13px' }} readOnly />
            </div>
          </div>
        </section>
        
        <section style={{ background: THEME.mutedSlate, border: `1px solid ${THEME.borderSlate}`, borderRadius: '12px', padding: '24px' }}>
          <h2 style={{ fontSize: '18px', fontWeight: 600, marginBottom: '16px' }}>About</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '12px', color: THEME.textSecondary, marginBottom: '6px', textTransform: 'uppercase' }}>Version</label>
              <input type="text" value="1.0.0-SIH2026" style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: `1px solid ${THEME.borderSlate}`, background: THEME.darkSlate, color: THEME.textPrimary, fontFamily: 'inherit', fontSize: '13px' }} readOnly />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '12px', color: THEME.textSecondary, marginBottom: '6px', textTransform: 'uppercase' }}>Build</label>
              <input type="text" value="2026-09-04" style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: `1px solid ${THEME.borderSlate}`, background: THEME.darkSlate, color: THEME.textPrimary, fontFamily: 'inherit', fontSize: '13px' }} readOnly />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '12px', color: THEME.textSecondary, marginBottom: '6px', textTransform: 'uppercase' }}>Compliance</label>
              <input type="text" value="Section 65B Indian Evidence Act" style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: `1px solid ${THEME.borderSlate}`, background: THEME.darkSlate, color: THEME.textPrimary, fontFamily: 'inherit', fontSize: '13px' }} readOnly />
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};

// ============================================================
// Login Page
// ============================================================
const LoginPage = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const { dispatch } = useApp();
  
  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const data = await api.login(username, password);
      dispatch({ type: 'SET_AUTH', payload: { token: data.access_token, refreshToken: data.refresh_token, user: { username }, authenticated: true } });
      navigate('/');
    } catch (e) {
      setError(e.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };
  
  return (
    <div style={loginContainerStyle}>
      <div style={loginCardStyle}>
        <div style={{ textAlign: 'center', marginBottom: '32px' }}>
          <ShieldIcon size={48} style={{ color: THEME.tacticalBlue, marginBottom: '16px' }} />
          <h1 style={{ fontSize: '28px', fontWeight: 700, color: THEME.textPrimary, marginBottom: '8px' }}>OPTIC SHIELD</h1>
          <p style={{ color: THEME.textSecondary }}>C2 Tactical Dashboard</p>
          <p style={{ fontSize: '11px', color: THEME.textMuted, textTransform: 'uppercase', letterSpacing: '1px', marginTop: '8px' }}>SIH 2026 PS 26187</p>
        </div>
        
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '12px', color: THEME.textSecondary, marginBottom: '6px', textTransform: 'uppercase' }}>Username</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              style={{ width: '100%', padding: '12px 14px', borderRadius: '8px', border: `1px solid ${THEME.borderSlate}`, background: THEME.darkSlate, color: THEME.textPrimary, fontFamily: 'inherit', fontSize: '14px' }}
              required
              autoFocus
            />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '12px', color: THEME.textSecondary, marginBottom: '6px', textTransform: 'uppercase' }}>Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={{ width: '100%', padding: '12px 14px', borderRadius: '8px', border: `1px solid ${THEME.borderSlate}`, background: THEME.darkSlate, color: THEME.textPrimary, fontFamily: 'inherit', fontSize: '14px' }}
              required
            />
          </div>
          
          {error && (
            <div style={{ padding: '12px', background: 'rgba(239, 68, 68, 0.15)', border: `1px solid ${THEME.criticalRed}`, borderRadius: '8px', color: THEME.criticalRed, fontSize: '13px' }}>
              {error}
            </div>
          )}
          
          <button type="submit" disabled={loading} className="btn-primary" style={{ width: '100%', padding: '14px', fontSize: '14px', marginTop: '8px' }}>
            {loading ? <Loader2 size={18} className="spinning" /> : <>Sign In</>}
          </button>
        </form>
        
        <div style={{ marginTop: '24px', paddingTop: '24px', borderTop: `1px solid ${THEME.borderSlate}`, textAlign: 'center', fontSize: '12px', color: THEME.textMuted }}>
          <p>Demo credentials: <strong style={{ color: THEME.textPrimary }}>admin</strong> / <strong style={{ color: THEME.textPrimary }}>optic2026</strong></p>
          <p style={{ marginTop: '8px' }}>Optic Shield v1.0.0 • SIH 2026 PS 26187</p>
        </div>
      </div>
    </div>
  );
};

// ============================================================
// Main App Component
// ============================================================
function AppContent() {
  const { state } = useApp();
  
  return (
    <div style={appStyle}>
      {state.authenticated ? (
        <AppLayout />
      ) : (
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      )}
    </div>
  );
}

function App() {
  return (
    <BrowserRouter>
      <AppProvider>
        <AppContent />
      </AppProvider>
    </BrowserRouter>
  );
}

// ============================================================
// Styles
// ============================================================
const loginContainerStyle = {
  minHeight: '100vh',
  background: THEME.darkSlate,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '20px',
  fontFamily: '"JetBrains Mono", "Fira Code", monospace',
};

const loginCardStyle = {
  width: '100%',
  maxWidth: '420px',
  background: THEME.mutedSlate,
  border: `1px solid ${THEME.borderSlate}`,
  borderRadius: '16px',
  padding: '40px',
  boxShadow: '0 24px 64px rgba(0, 0, 0, 0.5)',
};

const appStyle = {
  minHeight: '100vh',
  background: THEME.darkSlate,
  color: THEME.textPrimary,
  fontFamily: '"JetBrains Mono", "Fira Code", monospace',
};

const sidebarStyle = (state) => ({
  width: state.sidebarOpen ? '280px' : '72px',
  height: '100vh',
  background: THEME.mutedSlate,
  borderRight: `1px solid ${THEME.borderSlate}`,
  display: 'flex',
  flexDirection: 'column',
  transition: 'width 0.3s ease',
  position: 'fixed',
  left: 0,
  top: 0,
  zIndex: 100,
  overflow: 'hidden',
});

const sidebarHeaderStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '16px',
  borderBottom: `1px solid ${THEME.borderSlate}`,
  minHeight: '72px',
};

const navStyle = {
  flex: 1,
  overflowY: 'auto',
  padding: '12px',
};

const navItemStyle = {
  width: '100%',
  display: 'flex',
  alignItems: 'center',
  gap: '12px',
  padding: '12px 14px',
  borderRadius: '8px',
  border: 'none',
  fontFamily: 'inherit',
  fontSize: '13px',
  cursor: 'pointer',
  transition: 'all 0.2s',
  textAlign: 'left',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
};

const sidebarFooterStyle = {
  padding: '16px',
  borderTop: `1px solid ${THEME.borderSlate}`,
  flexShrink: 0,
};

const headerStyle = (state) => ({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '0 20px',
  height: '64px',
  background: THEME.mutedSlate,
  borderBottom: `1px solid ${THEME.borderSlate}`,
  position: 'fixed',
  top: 0,
  left: state.sidebarOpen ? '280px' : '72px',
  right: 0,
  zIndex: 50,
  transition: 'left 0.3s ease',
  gap: '24px', /* Add gap to prevent overlap */
});

const headerLeftStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: '12px',
  flexShrink: 0, /* Prevent shrinking */
};

const headerCenterStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flex: '1 1 auto', /* Allow center to grow but not shrink past content */
  minWidth: 0, /* Allow shrinking if needed */
};

const headerRightStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  flexShrink: 0, /* Prevent shrinking */
};

const mainStyle = (state) => ({
  display: 'flex',
  flex: 1,
  marginLeft: state.sidebarOpen ? '280px' : '72px',
  marginTop: '64px',
  transition: 'margin-left 0.3s ease',
});

const mainContentStyle = {
  flex: 1,
  overflow: 'auto',
  background: THEME.darkSlate,
};

const rightPanelStyle = (state) => ({
  width: state.rightPanelOpen ? '420px' : '0',
  height: 'calc(100vh - 64px)',
  background: THEME.darkSlate,
  borderLeft: `1px solid ${THEME.borderSlate}`,
  display: 'flex',
  flexDirection: 'column',
  position: 'fixed',
  right: 0,
  top: '64px',
  zIndex: 50,
  transition: 'width 0.3s ease',
  overflow: 'hidden',
});

const rightPanelHeaderStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '12px 16px',
  borderBottom: `1px solid ${THEME.borderSlate}`,
  background: THEME.mutedSlate,
  flexShrink: 0,
};

const rightPanelContentStyle = {
  flex: 1,
  overflowY: 'auto',
  background: THEME.darkSlate,
};

const btnStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '8px',
  padding: '10px 16px',
  borderRadius: '8px',
  border: 'none',
  color: '#fff',
  fontSize: '12px',
  fontWeight: 600,
  fontFamily: 'inherit',
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
  cursor: 'pointer',
  transition: 'all 0.2s',
};

const statCardStyle = {
  background: THEME.mutedSlate,
  border: `1px solid ${THEME.borderSlate}`,
  borderRadius: '12px',
  padding: '20px',
};

const globalAppStyles = `
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
  }
  
  @keyframes slideUp {
    from { opacity: 0; transform: translateY(20px); }
    to { opacity: 1; transform: translateY(0); }
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
    width: 36px;
    height: 36px;
    borderRadius: 8px;
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
  
  .btn-icon.active {
    background: ${THEME.tacticalBlue}20;
    border-color: ${THEME.tacticalBlue};
    color: ${THEME.tacticalBlue};
  }
  
  .btn-icon:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  
  .btn-primary {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 12px 24px;
    borderRadius: 8px;
    border: none;
    color: #fff;
    fontSize: 13px;
    fontWeight: 600;
    fontFamily: inherit;
    textTransform: uppercase;
    letterSpacing: 0.5px;
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
  
  .btn-secondary {
    display: inline-flex;
    align-items: center;
    justifyContent: center;
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
  
  /* Input styling */
  input[type="text"], input[type="password"], input[type="email"] {
    -webkit-appearance: none;
    appearance: none;
  }
  
  input:focus {
    outline: none;
    border-color: ${THEME.tacticalBlue};
  }
  
  button:focus-visible {
    outline: 2px solid ${THEME.tacticalBlue};
    outline-offset: 2px;
  }
  
  /* Scrollbar */
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
  
  }

/* Responsive */
  @media (max-width: 1024px) {
    .sidebar {
      transform: ${({ state }) => state.sidebarOpen ? 'translateX(0)' : 'translateX(-100%)'};
      box-shadow: 4px 0 24px rgba(0,0,0,0.3);
    }
  }
`;

export default App;