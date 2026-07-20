import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { FloatingAssistantApp } from './features/assistant/FloatingAssistantApp'
import { FloatingMenuApp } from './features/assistant/FloatingMenuApp'
import { PalaceMaidPetApp } from './features/assistant/PalaceMaidPetApp'
import { FavoriteLibraryApp } from './features/favorites/FavoriteLibraryApp'
import { markFloatingWindowDocument } from './features/assistant/floatingWindowDocument'
import './styles.css'

markFloatingWindowDocument(window.location.search)

const route = new URLSearchParams(window.location.search)
const isFloatingAssistantWindow = route.get('window') === 'floating-assistant'
const isFloatingSealWindow = route.get('window') === 'floating-seal'
const isFloatingMenuWindow = route.get('window') === 'floating-menu'
const isFavoriteLibraryWindow = route.get('window') === 'favorite-library'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {isFavoriteLibraryWindow ? (
      <FavoriteLibraryApp />
    ) : isFloatingAssistantWindow ? (
      <FloatingAssistantApp />
    ) : isFloatingMenuWindow ? (
      <FloatingMenuApp />
    ) : isFloatingSealWindow ? (
      <PalaceMaidPetApp />
    ) : (
      <App />
    )}
  </React.StrictMode>
)
