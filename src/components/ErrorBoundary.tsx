import { Component, type ReactNode, type ErrorInfo } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
  fallbackLabel?: string;
}

interface State {
  hasError: boolean;
  error?: Error;
}

/**
 * 全局错误边界：任何子组件崩溃时，显示友好错误卡片而非整页黑屏。
 * 这是防止"黑屏"类事故的最后一道防线。
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', this.props.fallbackLabel ?? '', error, info.componentStack);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: undefined });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div
          className="flex-1 flex items-center justify-center p-6 cyber-grid"
          style={{ backgroundColor: 'var(--bg-base)', opacity: 0.95 }}
        >
          <div
            className="max-w-md w-full rounded-2xl border p-6 text-center relative"
            style={{ borderColor: 'rgba(255,45,123,0.3)', backgroundColor: 'var(--bg-surface)', boxShadow: '0 0 20px rgba(255,45,123,0.1)' }}
          >
            {/* HUD 角标 — 霓虹粉色 */}
            <span className="hud-corner absolute top-2 left-2" style={{ borderColor: 'rgba(255,45,123,0.4)' }} />
            <span className="hud-corner absolute top-2 right-2" style={{ borderColor: 'rgba(255,45,123,0.4)' }} />
            <span className="hud-corner absolute bottom-2 left-2" style={{ borderColor: 'rgba(255,45,123,0.4)' }} />
            <span className="hud-corner absolute bottom-2 right-2" style={{ borderColor: 'rgba(255,45,123,0.4)' }} />

            <div
              className="w-12 h-12 rounded-full mx-auto mb-4 flex items-center justify-center animate-pulse-glow"
              style={{ backgroundColor: 'rgba(255,45,123,0.1)', boxShadow: '0 0 15px rgba(255,45,123,0.3)' }}
            >
              <AlertTriangle size={22} style={{ color: '#ff2d7b' }} />
            </div>
            <h2 className="text-base font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>
              {this.props.fallbackLabel ?? '页面'}出现异常
            </h2>
            <p className="text-xs mb-4 break-all" style={{ color: 'var(--text-muted)' }}>
              {this.state.error?.message ?? '未知错误'}
            </p>
            <div className="flex gap-2 justify-center">
              <button
                onClick={this.handleReset}
                className="btn-cyber inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium"
                style={{ background: 'linear-gradient(135deg, rgba(255,45,123,0.2), rgba(180,74,255,0.2))', color: '#ff2d7b', border: '1px solid rgba(255,45,123,0.3)' }}
              >
                <RefreshCw size={13} />
                重试
              </button>
              <button
                onClick={() => (window.location.href = '/')}
                className="btn-ghost px-4 py-2 rounded-lg text-xs font-medium border"
                style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
              >
                返回首页
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
