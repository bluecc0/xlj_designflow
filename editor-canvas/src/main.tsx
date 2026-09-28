import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App'
import { useCanvasStore } from './store/canvasStore'
import './style.css'

if (typeof window !== 'undefined') {
  ;(window as any).__canvasStore = useCanvasStore
}

const root = document.getElementById('root')
if (root) {
  ReactDOM.createRoot(root).render(<App />)
}
