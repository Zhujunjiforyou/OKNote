import { Component, type ReactNode } from 'react'

interface Props { children: ReactNode }
interface State { hasError: boolean; error: Error | null }

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="h-screen w-screen flex items-center justify-center bg-[#0d0d10] select-none">
          <div className="text-center space-y-2">
            <span className="text-xs text-red-400/60">应用出现错误</span>
            <br />
            <span className="text-[10px] text-muted-foreground/30">
              {this.state.error?.message?.slice(0, 80) || '未知错误'}
            </span>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
