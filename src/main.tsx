import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { supabaseConfigurationError } from './data/supabaseClient'
import { AppErrorBoundary } from './components/AppErrorBoundary'

function lockMobileZoom() {
  let lastTouchEnd = 0
  const preventGestureZoom = (event: Event) => event.preventDefault()

  document.addEventListener('gesturestart', preventGestureZoom, { passive: false })
  document.addEventListener('gesturechange', preventGestureZoom, { passive: false })
  document.addEventListener('gestureend', preventGestureZoom, { passive: false })
  document.addEventListener(
    'touchend',
    (event) => {
      const target = event.target instanceof Element ? event.target : null
      if (target?.closest('button, a, input, select, textarea, [role="button"]')) {
        lastTouchEnd = Date.now()
        return
      }

      const now = Date.now()
      if (now - lastTouchEnd <= 300) event.preventDefault()
      lastTouchEnd = now
    },
    { passive: false },
  )
}

lockMobileZoom()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {supabaseConfigurationError ? (
      <main className="startupMessage" role="alert">
        <h1>Приложение не настроено</h1>
        <p>{supabaseConfigurationError}</p>
      </main>
    ) : (
      <AppErrorBoundary><App /></AppErrorBoundary>
    )}
  </StrictMode>,
)
