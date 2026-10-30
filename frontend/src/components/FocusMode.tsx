import { useEffect, useRef, useState } from 'react'
import { CHANGED } from '../db/db'
import { useLang } from '../lib/i18n'
import { clock, hm, runningTimer } from '../lib/timer'
import {
  useFocus, useFocusOpen, minimiseFocus, pauseFocus, resumeFocus, nextRound, setPlan, endFocus, finishTask,
  roundElapsed, remaining, phaseLength, focusedTodayMin, ROUNDS, PLANS, FOCUS_EVENT, type Focus, type FocusEvent, type Plan,
} from '../lib/focus'
import { useVideo } from './VideoPlayer'
import Icon from './Icon'

const R = 124
const C = 2 * Math.PI * R

/** Stars drifting past, slower while paused (still for reduced motion). */
function Starfield({ moving }: { moving: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const movingRef = useRef(moving)
  movingRef.current = moving
  useEffect(() => {
    const cv = ref.current
    const ctx = cv?.getContext('2d')
    if (!cv || !ctx) return
    const stars = Array.from({ length: 180 }, () => ({ x: Math.random(), y: Math.random(), z: Math.random() }))
    let w = 0, h = 0, raf = 0
    const draw = () => {
      ctx.clearRect(0, 0, w, h)
      for (const s of stars) {
        ctx.globalAlpha = 0.3 + s.z * 0.65
        ctx.fillStyle = s.z > 0.88 ? '#BFD8FF' : '#FFFFFF'
        ctx.beginPath(); ctx.arc(s.x * w, s.y * h, 0.4 + s.z * 1.4, 0, 6.2832); ctx.fill()
      }
    }
    const size = () => {
      const r = cv.getBoundingClientRect(), d = Math.min(2, devicePixelRatio || 1)
      w = r.width; h = r.height; cv.width = w * d; cv.height = h * d; ctx.setTransform(d, 0, 0, d, 0, 0); draw()
    }
    const ro = new ResizeObserver(size)
    ro.observe(cv)
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      let t0 = performance.now()
      const loop = (t: number) => {
        const dt = Math.min(60, t - t0) / 1000
        t0 = t
        const sp = movingRef.current ? 1 : 0.2
        for (const s of stars) {
          s.y -= dt * sp * (0.004 + s.z * 0.035)
          s.x += dt * sp * (s.x - 0.5) * 0.02 * s.z
          if (s.y < 0 || s.x < 0 || s.x > 1) { s.y = 1; s.x = Math.random() }
        }
        if (!document.hidden) draw()
        raf = requestAnimationFrame(loop)
      }
      raf = requestAnimationFrame(loop)
    }
    return () => { cancelAnimationFrame(raf); ro.disconnect() }
  }, [])
  return <canvas ref={ref} className="fm-stars" aria-hidden />
}

/** Keeps the screen on while focus mode is open (where the browser allows). */
function useWakeLock(on: boolean) {
  useEffect(() => {
    if (!on || !('wakeLock' in navigator)) return
    let lock: WakeLockSentinel | null = null
    let gone = false
    const get = () => navigator.wakeLock.request('screen').then((l) => { if (gone) l.release(); else lock = l }).catch(() => {})
    const again = () => { if (!document.hidden) get() }
    get()
    document.addEventListener('visibilitychange', again)
    return () => { gone = true; lock?.release().catch(() => {}); document.removeEventListener('visibilitychange', again) }
  }, [on])
}

/** Re-render once a second while something counts. */
function useTick(on: boolean) {
  const [, set] = useState(0)
  useEffect(() => {
    if (!on) return
    const id = window.setInterval(() => set((n) => n + 1), 1000)
    return () => window.clearInterval(id)
  }, [on])
}

function readout(f: Focus): { sec: number; frac: number } {
  const now = Date.now()
  if (f.phase === 'ready') return { sec: Math.round(phaseLength(f) / 1000), frac: 1 }
  if (f.plan === 'free') {
    const ms = roundElapsed(f, now)
    // the ring goes round once an hour
    return { sec: Math.floor(ms / 1000), frac: (ms % 3600_000) / 3600_000 }
  }
  const left = remaining(f, now)
  return { sec: Math.ceil(left / 1000), frac: left / phaseLength(f) }
}

type Celebrate = FocusEvent & { at: number }

/** The full-screen focus timer: one task, one countdown ring, the music
    from Today, nothing else. Minimise and it carries on in the bar. */
export default function FocusMode() {
  const f = useFocus()
  const open = useFocusOpen()
  const { t } = useLang()
  const [todayMin, setTodayMin] = useState(0)
  const [cele, setCele] = useState<Celebrate | null>(null)
  const playRef = useRef<HTMLButtonElement>(null)
  const { videoId, playing, play, stop, nowPlaying, music: musicOn } = useVideo()
  const shown = open && !!f
  const counting = shown && !f.paused && f.phase !== 'ready'
  useTick(shown)
  useWakeLock(shown)

  // minutes focused today (sessions saved), plus the round running now
  useEffect(() => {
    if (!shown) return
    let alive = true
    const load = () => focusedTodayMin().then((m) => { if (alive) setTodayMin(m) })
    load()
    window.addEventListener(CHANGED, load)
    return () => { alive = false; window.removeEventListener(CHANGED, load) }
  }, [shown])

  // the moment a round ends (or the task is ticked off): a short celebration
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<FocusEvent>).detail
      // a ticked-off task celebrates from the tap itself (below)
      if (d.kind !== 'complete') return
      setCele({ ...d, at: Date.now() })
    }
    window.addEventListener(FOCUS_EVENT, on)
    return () => window.removeEventListener(FOCUS_EVENT, on)
  }, [])
  // a new round under way: a "round complete" still showing is old news
  const phase = f?.phase, round = f?.round
  useEffect(() => {
    if (phase === 'focus') setCele((c) => (c?.kind === 'complete' ? null : c))
  }, [phase, round])
  useEffect(() => {
    if (!cele) return
    const id = window.setTimeout(() => {
      setCele(null)
      if (cele.kind === 'task-done') minimiseFocus()
    }, cele.kind === 'task-done' ? 2400 : 3200)
    return () => window.clearTimeout(id)
  }, [cele])

  // Escape: minimise; Space: pause / carry on
  useEffect(() => {
    if (!shown) return
    playRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); minimiseFocus() }
      const el = e.target as HTMLElement | null
      if (e.key === ' ' && !(el && /^(BUTTON|INPUT|TEXTAREA|SELECT|A)$/.test(el.tagName))) { e.preventDefault(); playRef.current?.click() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [shown])

  // the screen stays while a "task done" celebration plays out
  if (!f && cele?.kind === 'task-done' && open) {
    return (
      <div className="focus-mode" role="dialog" aria-modal="true" aria-label={t('focus.title')}>
        <Starfield moving />
        <div className="fm-planet" aria-hidden />
        <div className="fm-cele" role="status">
          <div className="fm-burst" aria-hidden />
          <div className="fm-cele-big">{t('focus.taskDone')}</div>
          <small>{cele.title}</small>
        </div>
      </div>
    )
  }
  if (!shown || !f) return null

  const { sec, frac } = readout(f)
  const runningNow = runningTimer()?.taskId === f.taskId ? (Date.now() - runningTimer()!.startedAt) / 60_000 : 0
  const isBreak = f.phase === 'break'
  const pomodoro = f.plan !== 'free'
  const phaseLabel = f.phase === 'ready' ? t('focus.ready', { round: f.round })
    : f.paused ? t('focus.paused') : isBreak ? t(f.round >= ROUNDS ? 'focus.longBreak' : 'focus.break') : t('focus.focus')
  const bigLabel = f.phase === 'ready' ? t('focus.startRound', { round: f.round }) : f.paused ? t('focus.resume') : t('focus.pause')
  const onBig = () => (f.phase === 'ready' ? nextRound() : f.paused ? resumeFocus() : pauseFocus())
  const music = nowPlaying?.title ? `${nowPlaying.title}${nowPlaying.artist ? ` · ${nowPlaying.artist}` : ''}` : videoId ? t('focus.video') : ''

  return (
    <div className={`focus-mode ${isBreak ? 'is-break' : ''} ${f.paused ? 'is-paused' : ''}`} role="dialog" aria-modal="true" aria-label={t('focus.title')}>
      <Starfield moving={counting} />
      <div className="fm-planet" aria-hidden />
      <header className="fm-top">
        <div className="fm-what">
          <div className="fm-eyebrow">{pomodoro ? t('focus.eyebrow', { round: f.round, n: ROUNDS }) : t('focus.eyebrowFree')}</div>
          <h2 className="fm-task">{f.title}</h2>
        </div>
        <div className="fm-today">
          <span>{t('focus.today')}</span>
          <b className="num">{hm((todayMin + runningNow) / 60)}</b>
        </div>
        <button type="button" className="fm-icon" onClick={minimiseFocus} aria-label={t('focus.minimise')} title={t('focus.minimise')}>
          <Icon name="down" size={20} strokeWidth={2.2} />
        </button>
      </header>

      <div className="fm-center">
        <div className="fm-ring" style={{ ['--frac' as string]: frac }}>
          <svg viewBox="0 0 280 280" aria-hidden>
            <defs>
              <linearGradient id="fmFocus" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#3FD6FF" /><stop offset=".55" stopColor="#8B5CFF" /><stop offset="1" stopColor="#FF5FD2" />
              </linearGradient>
              <linearGradient id="fmBreak" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#3FD6FF" /><stop offset="1" stopColor="#34D399" />
              </linearGradient>
            </defs>
            <circle className="fm-track" cx="140" cy="140" r={R} />
            <circle className="fm-prog" cx="140" cy="140" r={R} stroke={isBreak ? 'url(#fmBreak)' : 'url(#fmFocus)'}
              strokeDasharray={C} strokeDashoffset={C * (1 - Math.max(0, Math.min(1, frac)))} />
          </svg>
          <div className="fm-readout">
            <div className="fm-clock num" role="timer" aria-live="off">{clock(Math.max(0, sec))}</div>
            <div className="fm-phase">{phaseLabel}</div>
            {pomodoro && (
              <div className="fm-dots" aria-label={t('focus.eyebrow', { round: f.round, n: ROUNDS })}>
                {Array.from({ length: ROUNDS }, (_, i) => <i key={i} className={i < f.round ? 'on' : ''} />)}
              </div>
            )}
          </div>
        </div>
      </div>

      <footer className="fm-bottom">
        <div className="fm-plans" role="radiogroup" aria-label={t('focus.plan')}>
          {(['free', '25', '50'] as Plan[]).map((p) => (
            <button key={p} type="button" role="radio" aria-checked={f.plan === p} className={f.plan === p ? 'on' : ''} onClick={() => setPlan(p)}>
              {p === 'free' ? t('focus.free') : `${PLANS[p].focus} / ${PLANS[p].rest}`}
            </button>
          ))}
        </div>
        <div className="fm-ctrl">
          <button type="button" className="fm-side" onClick={() => { endFocus(); minimiseFocus() }} aria-label={t('focus.stop')}>
            <span className="fm-side-ico"><Icon name="stop" size={18} strokeWidth={2.2} /></span><span>{t('focus.stop')}</span>
          </button>
          <button type="button" ref={playRef} className="fm-play" onClick={onBig} aria-label={bigLabel} title={bigLabel}>
            <Icon name={f.paused || f.phase === 'ready' ? 'play' : 'pause'} size={26} strokeWidth={2.6} />
          </button>
          {isBreak ? (
            <button type="button" className="fm-side" onClick={() => nextRound()}>
              <span className="fm-side-ico"><Icon name="chevronRight" size={18} strokeWidth={2.2} /></span><span>{t('focus.skipBreak')}</span>
            </button>
          ) : (
            <button type="button" className="fm-side" onClick={() => { setCele({ kind: 'task-done', title: f.title, at: Date.now() }); finishTask() }}>
              <span className="fm-side-ico"><Icon name="check" size={18} strokeWidth={2.4} /></span><span>{t('focus.done')}</span>
            </button>
          )}
        </div>
        {music && (
          <div className="fm-music">
            <span className={`fm-eq ${musicOn ? 'on' : ''}`} aria-hidden><i /><i /><i /></span>
            <span className="fm-music-t">{music}</span>
            {!nowPlaying && videoId && (
              <button type="button" onClick={() => (playing ? stop() : play())}>{playing ? t('focus.musicPause') : t('focus.musicPlay')}</button>
            )}
          </div>
        )}
      </footer>

      {cele && cele.kind === 'complete' && (
        <div className="fm-cele" role="status" key={cele.at}>
          <div className="fm-burst" aria-hidden />
          <div className="fm-cele-big">{t('focus.complete')}</div>
          <small>{t(cele.long ? 'focus.completeLong' : 'focus.completeNote', { min: cele.min, rest: cele.rest })}</small>
        </div>
      )}
    </div>
  )
}
