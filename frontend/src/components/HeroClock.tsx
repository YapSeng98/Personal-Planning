import { useEffect, useRef, useState } from 'react'
import { useVideo } from './VideoPlayer'
import { useLang } from '../lib/i18n'

/** A number from 0 to 1 that changes `rate` times a second, per bar — the
    flicker that makes the bars look like they follow a song. */
function flicker(i: number, t: number, rate: number): number {
  const x = Math.sin((i + 1) * 12.9898 + Math.floor(t * rate) * 78.233) * 43758.5453
  return x - Math.floor(x)
}

/** The music visualizer: a row of bars, calm dots while nothing plays,
    pulsing to a beat while your Today video or YouTube tab plays. A page
    can't hear inside a YouTube player, so the bars follow whether it plays,
    not the sound. */
function MusicBars({ music }: { music: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const st = useRef({ music, level: new Float32Array(0), raf: 0, draw: (_t: number) => {} })
  st.current.music = music

  useEffect(() => {
    const cv = ref.current
    const ctx = cv?.getContext('2d')
    if (!cv || !ctx) return
    const s = st.current
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let w = 0, h = 0, n = 0, fill: CanvasGradient | string = '#888', dot = '#888', shown = true
    const read = () => {
      const cs = getComputedStyle(cv)
      const [a, b, c] = ['--clk-a', '--clk-b', '--clk-c'].map((v) => cs.getPropertyValue(v).trim() || '#8B5CFF')
      dot = cs.getPropertyValue('--clk-dot').trim() || 'rgba(150,150,170,0.5)'
      const g = ctx.createLinearGradient(0, 0, w, 0)
      g.addColorStop(0, a); g.addColorStop(0.55, b); g.addColorStop(1, c)
      fill = g
    }
    const resize = () => {
      const r = cv.getBoundingClientRect(), d = Math.min(2, window.devicePixelRatio || 1)
      w = r.width; h = r.height
      cv.width = Math.round(w * d); cv.height = Math.round(h * d)
      ctx.setTransform(d, 0, 0, d, 0, 0)
      n = Math.max(12, Math.floor(w / 7))
      if (s.level.length !== n) s.level = new Float32Array(n)
      read()
      s.draw(performance.now())
    }
    const bar = (x: number, bw: number, len: number) => {
      const y = (h - len) / 2, r = Math.min(bw / 2, len / 2)
      ctx.beginPath()
      if (ctx.roundRect) ctx.roundRect(x, y, bw, len, r)
      else ctx.rect(x, y, bw, len)
      ctx.fill()
    }
    s.draw = (now: number) => {
      if (!w || !shown) return
      const t = now / 1000
      ctx.clearRect(0, 0, w, h)
      const step = w / n, bw = Math.max(2, step * 0.5)
      // a beat about twice a second, strongest in the low bars (the left)
      const beat = Math.pow(Math.max(0, Math.sin(t * Math.PI * 2 * 0.95)), 6)
      let moving = false
      for (let i = 0; i < n; i++) {
        let target = 0
        if (s.music) {
          if (reduce) target = 0.25 + 0.4 * flicker(i, 0, 1)
          else {
            const wave = 0.5 + 0.5 * Math.sin(t * 3.1 + i * 0.6) * Math.sin(t * 1.7 - i * 0.27)
            const low = 1 - i / n
            target = 0.1 + 0.55 * wave * (0.5 + 0.5 * flicker(i, t, 9)) + 0.4 * beat * (0.35 + 0.65 * low)
          }
        }
        const cur = s.level[i]
        s.level[i] = reduce ? target : cur + (target - cur) * (target > cur ? 0.35 : 0.12)
        if (Math.abs(s.level[i] - target) > 0.01) moving = true
      }
      for (let i = 0; i < n; i++) {
        const x = i * step + (step - bw) / 2
        const lvl = s.level[i]
        if (lvl > 0.02) {
          const len = Math.max(bw, lvl * h)
          ctx.fillStyle = fill
          ctx.globalAlpha = 0.25; bar(x - 1.5, bw + 3, Math.min(h, len + 3)) // glow
          ctx.globalAlpha = 1; bar(x, bw, len)
        } else {
          ctx.fillStyle = dot; ctx.globalAlpha = 0.55
          bar(x, bw, bw) // a dot at rest
        }
      }
      ctx.globalAlpha = 1
      // keep animating while music plays or the bars are still settling
      if (!reduce && (s.music || moving)) s.raf = requestAnimationFrame(s.draw)
      else s.raf = 0
    }
    const ro = new ResizeObserver(resize)
    ro.observe(cv)
    const io = new IntersectionObserver(([e]) => {
      shown = e.isIntersecting
      if (shown && !s.raf) s.draw(performance.now())
    })
    io.observe(cv)
    // the theme or wallpaper changed: new colours
    const mo = new MutationObserver(() => { read(); if (!s.raf) s.draw(performance.now()) })
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-bg', 'class'] })
    return () => { cancelAnimationFrame(s.raf); s.raf = 0; ro.disconnect(); io.disconnect(); mo.disconnect() }
  }, [])

  // music started or stopped: draw (the loop keeps itself going while it plays)
  useEffect(() => {
    const s = st.current
    if (!s.raf) s.draw(performance.now())
  }, [music])

  // in a box of its own: the canvas can never change the layout it measures
  return <div className="hc-viz" aria-hidden><canvas ref={ref} /></div>
}

/** Today's clock: the time big and glowing, like focus mode's timer; under
    it the music visualizer, and today's progress as a slim bar. */
export default function HeroClock({ done, total }: { done: number; total: number }) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(id)
  }, [])
  const { music } = useVideo()
  const { t } = useLang()
  const time = now.toTimeString()
  const hm = time.slice(0, 5)
  const pct = total ? Math.round((done / total) * 100) : 0
  const label = total ? t('today.dialDone', { done, n: total }) : t('today.dialToday')
  return (
    <div className={`hero-clock ${music ? 'is-music' : ''}`} role="img" aria-label={`${hm} · ${label}`}>
      <div className="hc-time num" aria-hidden>{hm}<small>:{time.slice(6, 8)}</small></div>
      <MusicBars music={music} />
      <div className="hc-prog" aria-hidden>
        <span className="hc-label">{label}</span>
        {total > 0 && <span className="hc-bar"><i style={{ width: `${pct}%` }} /></span>}
      </div>
    </div>
  )
}
