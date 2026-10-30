import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/inter/index.css'
import './styles/tokens.css'
import './styles/app.css'
import './styles/glass.css'
import App from './App.tsx'
import { applyTheme } from './lib/theme'
import { applyBg } from './lib/bg'
import { startGlassLight } from './lib/glassLight'
import { startUpdates } from './lib/pwaUpdate'

// iPhone / iPad Safari zooms into any text box under 16px when it's tapped,
// and the page then no longer fits the screen. maximum-scale=1 stops that
// zoom; iOS still lets you pinch-zoom. (Android doesn't zoom on a tap — and
// there maximum-scale would stop pinch-zoom too, so it's iOS only.)
if (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) {
  const vp = document.querySelector('meta[name="viewport"]')
  if (vp && !/maximum-scale/.test(vp.getAttribute('content') ?? '')) vp.setAttribute('content', `${vp.getAttribute('content')}, maximum-scale=1`)
}

applyTheme() // before first paint, so the saved theme doesn't flash
applyBg()
startUpdates()
startGlassLight()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
