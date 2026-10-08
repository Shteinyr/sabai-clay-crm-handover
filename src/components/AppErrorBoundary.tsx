import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'

export class AppErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Application render failed', error, info.componentStack)
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <main className="startupMessage" role="alert">
        <h1>Не удалось открыть приложение</h1>
        <p>Перезагрузите страницу. Если ошибка повторится, сообщите администратору. Локальные данные не удалены.</p>
        <button type="button" onClick={() => window.location.reload()}>Перезагрузить</button>
      </main>
    )
  }
}
