import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import React, { Suspense } from 'react';
import { AuthProvider } from './context/AuthContext';
import { ErrorBoundary } from './components/ErrorBoundary';
import Navbar from './components/Navbar';
import LoginPage from './pages/LoginPage';
import ProtectedRoute from './components/ProtectedRoute';
import './styles/globals.css';

// Lazy load page components for code splitting
const Dashboard = React.lazy(() => import('./pages/Dashboard'));
const AlertsPage = React.lazy(() => import('./pages/Alerts'));
const TrackPage = React.lazy(() => import('./pages/Track'));
const HistoryPage = React.lazy(() => import('./pages/History'));
const Settings = React.lazy(() => import('./pages/Settings'));

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Navigate to="/dashboard" replace />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<Navbar />}>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route
            path="/dashboard"
            element={
              <Suspense fallback={<div className="flex h-[calc(100vh-64px)] items-center justify-center">Loading...</div>}>
                <Dashboard />
              </Suspense>
            }
          />
          <Route
            path="/alerts"
            element={
              <Suspense fallback={<div className="flex h-[calc(100vh-64px)] items-center justify-center">Loading...</div>}>
                <AlertsPage />
              </Suspense>
            }
          />
          <Route
            path="/track"
            element={
              <Suspense fallback={<div className="flex h-[calc(100vh-64px)] items-center justify-center">Loading...</div>}>
                <TrackPage />
              </Suspense>
            }
          />
          <Route
            path="/history"
            element={
              <Suspense fallback={<div className="flex h-[calc(100vh-64px)] items-center justify-center">Loading...</div>}>
                <HistoryPage />
              </Suspense>
            }
          />
          <Route
            path="/settings"
            element={
              <Suspense fallback={<div className="flex h-[calc(100vh-64px)] items-center justify-center">Loading...</div>}>
                <Settings />
              </Suspense>
            }
          />
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