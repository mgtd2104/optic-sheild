import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { ErrorBoundary } from './components/ErrorBoundary';
import Navbar from './components/Navbar';
import LoginPage from './pages/LoginPage';
import Dashboard from './pages/Dashboard';
import AlertsPage from './pages/Alerts';
import TrackPage from './pages/Track';
import HistoryPage from './pages/History';
import Settings from './pages/Settings';
import ProtectedRoute from './components/ProtectedRoute';
import './styles/globals.css';

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<Navbar />}>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/alerts" element={<AlertsPage />} />
          <Route path="/track" element={<TrackPage />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/settings" element={<Settings />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <ErrorBoundary>
          <div className="min-h-screen bg-[hsl(var(--background))] text-[hsl(var(--foreground))]">
            <AppRoutes />
          </div>
        </ErrorBoundary>
      </BrowserRouter>
    </AuthProvider>
  );
}