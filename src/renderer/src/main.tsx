import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { FloatingMenuApp } from './features/assistant/FloatingMenuApp'
import { FloatingSealApp } from './features/assistant/FloatingSealApp'
import './styles.css'

const route = new URLSearchParams(window.location.search)
const isFloatingSealWindow = route.get('window') === 'floating-seal'
const isFloatingMenuWindow = route.get('window') === 'floating-menu'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {isFloatingMenuWindow ? (
      <FloatingMenuApp />
    ) : isFloatingSealWindow ? (
      <FloatingSealApp />
    ) : (
      <App />
    )}
  </React.StrictMode>
)
