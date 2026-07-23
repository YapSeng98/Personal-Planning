import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/inter/index.css'
import './styles/tokens.css'
import './styles/app.css'
import App from './App.tsx'
import { applyTheme } from './lib/theme'
import { applyBg } from './lib/bg'

applyTheme() // before first paint, so the saved theme doesn't flash
applyBg()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
