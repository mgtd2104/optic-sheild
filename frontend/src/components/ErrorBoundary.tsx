import { Component, ReactNode, ErrorInfo } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = {
    hasError: false,
    error: null,
    errorInfo: null,
  };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    this.setState({ error, errorInfo });
    console.error('ErrorBoundary caught:', error, errorInfo);
  }

  handleReset = (): void => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[hsl(var(--background))] p-4">
          <div className="w-full max-w-md bg-[hsl(var(--card))] border border-[hsl(var(--border))] rounded-xl p-8 shadow-2xl animate-in">
            <div className="text-center">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-destructive/10 mb-4">
                <svg className="w-8 h-8 text-destructive" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <h2 className="text-xl font-bold text-[hsl(var(--foreground))] mb-2">Module Error Detected</h2>
              <p className="text-[hsl(var(--muted-foreground))] mb-4">
                A non-critical module encountered an error. The system is attempting to recover automatically.
              </p>
              
              {this.state.error && (
                <details className="mb-4 text-left">
                  <summary className="text-xs font-medium text-[hsl(var(--muted-foreground))] cursor-pointer select-none">
                    Error Details (Click to Expand)
                  </summary>
                  <pre className="mt-2 p-3 bg-[hsl(var(--muted))] rounded-lg text-xs text-[hsl(var(--muted-foreground))] overflow-auto max-h-32 font-mono">
                    {this.state.error.message}
                    {this.state.error.stack && '\n\n' + this.state.error.stack.split('\n').slice(0, 5).join('\n')}
                  </pre>
                </details>
              )}

              <div className="flex gap-3 justify-center">
                <button
                  onClick={this.handleReset}
                  className="flex-1 py-2.5 px-4 bg-primary text-primary-foreground font-medium rounded-lg transition-colors hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-[hsl(var(--background))]"
                >
                  Reset View
                </button>
                <button
                  onClick={() => window.location.reload()}
                  className="flex-1 py-2.5 px-4 bg-[hsl(var(--secondary))] text-[hsl(var(--secondary-foreground))] font-medium rounded-lg border border-[hsl(var(--border))] transition-colors hover:bg-[hsl(var(--muted))] focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-[hsl(var(--background))]"
                >
                  Full Reload
                </button>
              </div>

              <p className="mt-4 text-xs text-[hsl(var(--muted-foreground))]">
                SIH Demo Mode • Error Boundary Active
              </p>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}