import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App'
import { useCanvasStore } from './store/canvasStore'
import './style.css'

// Bump this when shipping a canvas UI build. It is intentionally referenced
// below so Vite emits a new hashed entry and browsers do not reuse an older
// immutable editor bundle during local verification.
const CANVAS_BUILD_REVISION = '2026-10-16-ui-3'

if (typeof window !== 'undefined') {
  ;(window as any).__canvasStore = useCanvasStore
  ;(window as any).__canvasBuildRevision = CANVAS_BUILD_REVISION
}

const root = document.getElementById('root')
if (root) {
  ReactDOM.createRoot(root).render(<App />)
}
