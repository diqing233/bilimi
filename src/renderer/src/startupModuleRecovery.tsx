import { Component, type ErrorInfo, type ReactNode } from 'react'

type StartupModuleRecoveryBoundaryProps = {
  children: ReactNode
}

type StartupModuleRecoveryBoundaryState = {
  failed: boolean
}

export class StartupModuleRecoveryBoundary extends Component<
  StartupModuleRecoveryBoundaryProps,
  StartupModuleRecoveryBoundaryState
> {
  state: StartupModuleRecoveryBoundaryState = { failed: false }

  static getDerivedStateFromError(): StartupModuleRecoveryBoundaryState {
    return { failed: true }
  }

  componentDidCatch(_error: Error, _errorInfo: ErrorInfo) {
    // React reports the failure to the development console. Keep this boundary
    // focused on replacing an otherwise blank renderer window with recovery UI.
  }

  render() {
    if (!this.state.failed) return this.props.children

    return (
      <main
        aria-labelledby="startup-module-recovery-title"
        style={{
          minHeight: '100vh',
          display: 'grid',
          placeItems: 'center',
          padding: 24,
          boxSizing: 'border-box',
          background: '#edf5ff',
          color: '#27415f',
          fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
        }}
      >
        <section style={{ maxWidth: 420, textAlign: 'center' }}>
          <h1 id="startup-module-recovery-title" style={{ margin: 0, fontSize: 20 }}>
            主界面未能载入
          </h1>
          <p style={{ margin: '12px 0 20px', lineHeight: 1.6 }}>
            请重新载入窗口；如果仍然出现此提示，请关闭后重新打开 bilimi。
          </p>
          <button type="button" onClick={() => window.location.reload()}>
            重新载入
          </button>
        </section>
      </main>
    )
  }
}
