import { useEffect, useRef } from 'react'

// Escape closes the top layer only — a sheet, or whatever opened over it
// last (a dropdown, the file viewer, the draw pad, focus mode). One listener
// for all of them, so a dropdown's Escape never also closes the sheet under
// it. A key that ends Chinese/Japanese typing (IME) is the input's, not ours.
const layers: { close: () => void }[] = []
let listening = false

function onKey(e: KeyboardEvent) {
  if (e.key !== 'Escape' || e.isComposing || e.keyCode === 229 || e.defaultPrevented || !layers.length) return
  e.preventDefault()
  layers[layers.length - 1].close()
}

/** Close this layer on Escape while `active` (and nothing opened on top). */
export function useEscape(close: () => void, active = true) {
  const latest = useRef(close)
  useEffect(() => { latest.current = close })
  useEffect(() => {
    if (!active) return
    if (!listening) { window.addEventListener('keydown', onKey); listening = true }
    const layer = { close: () => latest.current() }
    layers.push(layer)
    return () => { const i = layers.lastIndexOf(layer); if (i >= 0) layers.splice(i, 1) }
  }, [active])
}
