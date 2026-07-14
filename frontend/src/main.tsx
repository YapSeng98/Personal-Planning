import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/inter/index.css'
import './styles/tokens.css'
import './styles/app.css'
import App from './App.tsx'
import { applyTheme } from './lib/theme'

applyTheme() // before first paint, so the saved theme doesn't flash

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
