import { Component, type ReactNode } from 'react'

interface Props { children: ReactNode }
interface State { hasError: boolean; error: Error | null; errorInfo: string }

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null, errorInfo: '' }
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: { componentStack: string }) {
    console.error('[ErrorBoundary]', error.message, error.stack, errorInfo.componentStack)
    this.setState({ errorInfo: errorInfo.componentStack || '' })
    if (typeof window !== 'undefined') {
      (window as unknown as Record<string,unknown>).__lastError = { message: error.message, stack: error.stack, componentStack: errorInfo.componentStack }
    }
    // Persist crash info to disk for debugging
    try {
      const win = window as unknown as { electronAPI?: { saveAppData?: (k: string, v: unknown) => void } }
      if (win.electronAPI?.saveAppData && !error.message?.includes('electronAPI')) {
        win.electronAPI.saveAppData('__crash_log', {
          message: error.message,
          stack: error.stack,
          componentStack: errorInfo.componentStack?.slice(0, 3000),
          href: window.location.href,
          time: new Date().toISOString(),
        })
      }
    } catch { /* ignore */ }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="h-screen w-screen flex items-center justify-center bg-[#08111f] select-none overflow-auto p-4">
          <div className="text-left space-y-1 max-w-full">
            <div className="text-sm text-red-400 font-semibold mb-2">应用出现错误</div>
            <div className="text-xs text-red-300/80 whitespace-pre-wrap break-all" style={{ maxWidth: '90vw' }}>
              {this.state.error?.message || '未知错误'}
            </div>
            {this.state.error?.stack && (
              <pre className="text-[10px] text-white/30 mt-2 whitespace-pre-wrap break-all max-h-[300px] overflow-auto" style={{ maxWidth: '90vw' }}>
                {this.state.error.stack}
              </pre>
            )}
            {this.state.errorInfo && (
              <pre className="text-[9px] text-white/15 mt-1 whitespace-pre-wrap break-all max-h-[200px] overflow-auto">
                {this.state.errorInfo.slice(0, 2000)}
              </pre>
            )}
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
