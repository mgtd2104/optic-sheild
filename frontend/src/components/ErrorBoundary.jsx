/**
 * Optic Shield — ErrorBoundary Component
 * 
 * Catches JavaScript errors anywhere in child component tree,
 * logs them, and displays a fallback UI instead of crashing.
 */

import React, { Component } from 'react';
import { AlertTriangle, RefreshCw, Bug } from 'lucide-react';

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

export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    this.setState({ error, errorInfo });
    console.error(`[ErrorBoundary${this.props.name ? ` ${this.props.name}` : ''}]`, error, errorInfo);
    this.props.onError?.(error, errorInfo);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  render() {
    if (this.state.hasError) {
      // Custom fallback
      if (this.props.fallback) {
        return this.props.fallback;
      }

      // Default fallback UI
      return (
        <div style={{
          background: THEME.mutedSlate,
          border: `1px solid ${THEME.borderSlate}`,
          borderRadius: '12px',
          padding: '24px',
          textAlign: 'center',
          color: THEME.textSecondary,
          fontFamily: '"JetBrains Mono", "Fira Code", monospace',
          minHeight: '200px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '16px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
            <Bug size={32} style={{ color: THEME.warningAmber }} />
            <AlertTriangle size={32} style={{ color: THEME.warningAmber }} />
          </div>
          
          <h3 style={{ 
            margin: 0, 
            color: THEME.textPrimary, 
            fontSize: '16px',
            fontWeight: 600 
          }}>
            {this.props.name ? `${this.props.name} ` : ''}Component Error
          </h3>
          
          <p style={{ margin: 0, fontSize: '13px', lineHeight: 1.5, maxWidth: '400px' }}>
            This component encountered an error and couldn't render. 
            The rest of the dashboard continues to function normally.
          </p>
          
          {process.env.NODE_ENV !== 'production' && this.state.error && (
            <details style={{ 
              textAlign: 'left', 
              width: '100%',
              maxWidth: '500px',
              padding: '12px',
              background: THEME.darkSlate,
              borderRadius: '6px',
              border: `1px solid ${THEME.borderSlate}`,
              fontSize: '11px',
              color: THEME.textMuted,
            }}>
              <summary style={{ cursor: 'pointer', marginBottom: '8px', fontWeight: 600, color: THEME.textSecondary }}>
                Error Details (Development)
              </summary>
              <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: THEME.criticalRed }}>
                {this.state.error.toString()}
              </pre>
              {this.state.errorInfo && (
                <>
                  <div style={{ marginTop: '8px', fontWeight: 600, color: THEME.textSecondary }}>Component Stack:</div>
                  <pre style={{ margin: '4px 0 0', whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: THEME.textMuted }}>
                    {this.state.errorInfo.componentStack}
                  </pre>
                </>
              )}
            </details>
          )}

          <button
            onClick={this.handleRetry}
            style={{
              background: THEME.tacticalBlue,
              border: 'none',
              borderRadius: '6px',
              color: '#fff',
              padding: '10px 20px',
              fontSize: '12px',
              fontWeight: 600,
              fontFamily: 'inherit',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              transition: 'background 0.2s',
            }}
            onMouseOver={(e) => e.currentTarget.style.background = THEME.tacticalBlue + 'dd'}
            onMouseOut={(e) => e.currentTarget.style.background = THEME.tacticalBlue}
          >
            <RefreshCw size={14} /> Try Again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;