import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.warn('Uncaught error:', error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="vg-error-panel mx-4 my-6 flex min-h-[50vh] flex-col items-center justify-center rounded-2xl border border-[#dfe5e6] bg-white p-8 text-center shadow-sm">
          <AlertTriangle className="mb-4 h-10 w-10 text-[#aa735e]" aria-hidden="true" />
          <h2 className="mb-2 text-xl font-bold tracking-[-.035em] text-[#26363c]">Something went wrong</h2>
          <p className="mb-6 max-w-md text-sm leading-6 text-[#687b80]">
            This section encountered an unexpected error. Try again, or return to the workspace.
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            <button
              onClick={() => this.setState({ hasError: false, error: null })}
              className="vg-primary flex items-center gap-2"
            >
              <RefreshCw className="w-4 h-4" />
              Try Again
            </button>
            <button
              onClick={() => {
                this.setState({ hasError: false, error: null });
                window.location.assign('/app');
              }}
              className="vg-secondary"
            >
              Go to overview
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
