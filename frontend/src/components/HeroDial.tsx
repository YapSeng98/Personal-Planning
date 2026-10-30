import { useEffect, useRef, useState } from 'react'
import { useVideo } from './VideoPlayer'
import { useLang } from '../lib/i18n'

const N = 60 // bezel marks, one per second
const R = 54 // ring radius in the 120-unit viewBox
const C = 2 * Math.PI * R

/** A number from 0 to 1 that changes `rate` times a second, per bar — the
    flicker that makes the bars look like they follow a song. */
function flicker(i: number, t: number, rate: number): number {
  const x = Math.sin((i + 1) * 12.9898 + Math.floor(t * rate) * 78.233) * 43758.5453
  return x - Math.floor(x)
}

/** The bezel around the dial: 60 marks like a watch's, the current second
    lit with a short tail. While music plays it becomes a visualizer — the
    marks grow into bars pulsing to a beat. A page can't hear inside a
    YouTube player, so the bars follow whether it plays, not the sound. */
function Bezel({ music, sec }: { music: boolean; sec: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const st = useRef({ music, sec, level: new Float32Array(N), raf: 0, draw: (_t: number) => {} })
  st.current.music = music
  st.current.sec = sec

  useEffect(() => {
    const cv = ref.current
    const ctx = cv?.getContext('2d')
    if (!cv || !ctx) return
    const s = st.current
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let size = 0, ring = 0, colors = ['#888', '#888', '#888'], tick = '#888', grad: CanvasGradient | string = '#888', shown = true
    const read = () => {
      const cs = getComputedStyle(cv)
      colors = ['--dial-a', '--dial-b', '--dial-c'].map((v) => cs.getPropertyValue(v).trim() || '#8B5CFF')
      tick = cs.getPropertyValue('--dial-tick').trim() || 'rgba(150,150,170,0.5)'
      const c = size / 2
      if ('createConicGradient' in ctx) {
        const g = ctx.createConicGradient(-Math.PI / 2, c, c)
        g.addColorStop(0, colors[0]); g.addColorStop(0.33, colors[1]); g.addColorStop(0.66, colors[2]); g.addColorStop(1, colors[0])
        grad = g
      } else grad = colors[1]
    }
    const resize = () => {
      const r = cv.getBoundingClientRect(), d = Math.min(2, window.devicePixelRatio || 1)
      size = r.width
      // the canvas reaches 16px past the dial on each side; the ring's outer
      // edge is at 57.5 / 120 of the dial
      ring = ((size - 32) * 57.5) / 120
      cv.width = Math.round(size * d); cv.height = Math.round(size * d)
      ctx.setTransform(d, 0, 0, d, 0, 0)
      read()
      s.draw(performance.now())
    }
    s.draw = (now: number) => {
      if (!size || !shown) return
      const c = size / 2, t = now / 1000
      ctx.clearRect(0, 0, size, size)
      ctx.lineCap = 'round'
      const r0 = ring + 4
      // music: each bar eases toward a height made of slow waves, a beat and flicker
      const beat = Math.pow(Math.max(0, Math.sin(t * Math.PI * 2 * 0.95)), 6)
      let moving = false
      for (let i = 0; i < N; i++) {
        let target = 0
        if (s.music) {
          if (reduce) target = 0.25 + 0.35 * flicker(i, 0, 1)
          else {
            const wave = 0.5 + 0.5 * Math.sin(t * 3.1 + i * 0.55) * Math.sin(t * 1.7 - i * 0.23)
            target = 0.12 + 0.5 * wave * (0.55 + 0.45 * flicker(i, t, 9)) + 0.38 * beat * (0.55 + 0.45 * Math.cos((i / N) * Math.PI * 4 + t))
          }
        }
        const cur = s.level[i]
        s.level[i] = reduce ? target : cur + (target - cur) * (target > cur ? 0.35 : 0.12)
        if (Math.abs(s.level[i] - target) > 0.01) moving = true
      }
      for (let i = 0; i < N; i++) {
        const a = (i / N) * Math.PI * 2 - Math.PI / 2
        const cos = Math.cos(a), sin = Math.sin(a)
        const lvl = s.level[i]
        // the lit second and a short tail behind it
        const back = (s.sec - i + N) % N
        const lit = back < 6 ? 1 - back / 6 : 0
        const base = i % 5 === 0 ? 4 : 2.2
        const len = base + lvl * 13
        if (lvl > 0.02) {
          ctx.strokeStyle = grad
          ctx.globalAlpha = 0.22; ctx.lineWidth = 4.6
          ctx.beginPath(); ctx.moveTo(c + cos * r0, c + sin * r0); ctx.lineTo(c + cos * (r0 + len), c + sin * (r0 + len)); ctx.stroke()
          ctx.globalAlpha = 0.95; ctx.lineWidth = 2
        } else if (lit) {
          ctx.strokeStyle = grad; ctx.globalAlpha = 0.35 + 0.65 * lit; ctx.lineWidth = 2
        } else {
          ctx.strokeStyle = tick; ctx.globalAlpha = i % 5 === 0 ? 0.7 : 0.4; ctx.lineWidth = 1.4
        }
        ctx.beginPath(); ctx.moveTo(c + cos * r0, c + sin * r0); ctx.lineTo(c + cos * (r0 + len), c + sin * (r0 + len)); ctx.stroke()
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

  // music started, or a new second: draw (the loop keeps itself going while music plays)
  useEffect(() => {
    const s = st.current
    if (!s.raf) s.draw(performance.now())
  }, [music, sec])

  return <canvas ref={ref} className="hd-bezel" aria-hidden />
}

/** Today's clock: the time big and glowing, like focus mode's timer, inside
    the ring of today's progress; a watch bezel around it that turns into a
    music visualizer while your Today video (or YouTube tab) plays. */
export default function HeroDial({ pct, hasTasks }: { pct: number; hasTasks: boolean }) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(id)
  }, [])
  const { music } = useVideo()
  const { t } = useLang()
  const time = now.toTimeString()
  const hm = time.slice(0, 5)
  const label = hasTasks ? t('today.pctDone', { n: pct }) : t('today.dialToday')
  return (
    <div className={`hero-dial ${music ? 'is-music' : ''}`} role="img" aria-label={`${hm} · ${label}`}>
      <Bezel music={music} sec={now.getSeconds()} />
      <svg className="hd-ring" viewBox="0 0 120 120" aria-hidden>
        <defs>
          <linearGradient id="hdGrad" x1="0" y1="0" x2="1" y2="1">
            <stop className="hd-s1" offset="0" /><stop className="hd-s2" offset="0.55" /><stop className="hd-s3" offset="1" />
          </linearGradient>
        </defs>
        <circle className="hd-track" cx="60" cy="60" r={R} />
        {hasTasks && pct > 0 && (
          <circle className="hd-prog" cx="60" cy="60" r={R} stroke="url(#hdGrad)" strokeDasharray={C} strokeDashoffset={C * (1 - pct / 100)} />
        )}
      </svg>
      <div className="hd-face" aria-hidden>
        <div className="hd-time num">{hm}<small>:{time.slice(6, 8)}</small></div>
        <div className="hd-label">{label}</div>
      </div>
    </div>
  )
}
