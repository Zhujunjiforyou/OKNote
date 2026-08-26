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
      const win = window as unknown as { electronAPI?: { reportCrash?: (value: unknown) => void } }
      if (win.electronAPI?.reportCrash && !error.message?.includes('electronAPI')) {
        win.electronAPI.reportCrash({
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
        <div className="h-screen w-screen flex items-center justify-center bg-[#08111f] overflow-auto p-5 text-slate-100">
          <div className="w-full max-w-sm rounded-2xl border border-red-400/20 bg-slate-950/80 p-5 shadow-2xl">
            <h1 className="text-base font-semibold text-red-300">这个窗口暂时无法显示</h1>
            <p className="mt-2 select-text text-sm leading-relaxed text-slate-300">
              诊断信息已保存在本机。你可以重新载入窗口；如果问题仍然出现，请保留数据目录后再反馈。
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              <button type="button" onClick={() => window.location.reload()} className="min-h-9 rounded-lg bg-blue-500 px-3 text-sm font-semibold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-300">
                重新载入
              </button>
              <button type="button" onClick={() => window.electronAPI?.closeWindow()} className="min-h-9 rounded-lg px-3 text-sm text-slate-300 hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-300">
                关闭窗口
              </button>
            </div>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
