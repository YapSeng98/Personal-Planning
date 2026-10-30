import { Fragment, useEffect, useRef, useState } from 'react'
import { useLang } from '../lib/i18n'
import { runCommand, suggestions, type Reply, type Act } from '../lib/command'
import Icon from './Icon'

/** **bold** → <b>, new lines kept; plain text otherwise (never HTML). */
function Rich({ text }: { text: string }) {
  return (
    <>
      {text.split('\n').map((line, i) => (
        <span key={i} className="ask-line">
          {line.split('**').map((part, j) => (j % 2 ? <b key={j}>{part}</b> : <Fragment key={j}>{part}</Fragment>))}
        </span>
      ))}
    </>
  )
}

/** "Ask Planner…" on Today: type what you want in plain words; the answer
    comes as a small card with a button that does it (lib/command.ts). The
    / key jumps here. */
export default function AskBar() {
  const { t, lang } = useLang()
  const [q, setQ] = useState('')
  const [asked, setAsked] = useState('')
  const [reply, setReply] = useState<Reply | null>(null)
  const [busy, setBusy] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const seq = useRef(0)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      const typing = !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))
      if (e.key === '/' && !typing && !e.metaKey && !e.ctrlKey && !document.querySelector('.sheet-backdrop, .focus-mode')) {
        e.preventDefault()
        input.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  async function ask(text: string) {
    const v = text.trim()
    if (!v) return
    const n = ++seq.current
    setAsked(v)
    setBusy(true)
    setReply(null)
    try {
      const r = await runCommand(v, { t, lang })
      if (n === seq.current) setReply(r)
    } catch {
      if (n === seq.current) setReply({ text: t('ask.failed'), tone: 'muted' })
    } finally {
      if (n === seq.current) setBusy(false)
    }
  }

  async function act(a: Act) {
    const n = ++seq.current
    setBusy(true)
    try {
      const r = await a.run()
      if (n !== seq.current) return
      setAsked('')
      setReply(r)
    } catch {
      if (n === seq.current) setReply({ text: t('ask.failed'), tone: 'muted' })
    } finally {
      if (n === seq.current) setBusy(false)
    }
  }

  const close = () => { seq.current++; setReply(null); setAsked(''); setBusy(false) }
  const open = busy || !!reply

  return (
    <div className="ask">
      <form
        className="ask-bar"
        onSubmit={(e) => { e.preventDefault(); ask(q); setQ('') }}
        autoComplete="off"
      >
        <span className="ask-spark" aria-hidden>✦</span>
        <input
          ref={input}
          id="ask-input"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Escape') { e.currentTarget.blur(); close() } }}
          placeholder={t('ask.placeholder')}
          aria-label={t('ask.label')}
          enterKeyHint="send"
          maxLength={300}
        />
        <button type="submit" className="ask-go" disabled={!q.trim() || busy} aria-label={t('ask.go')} title={t('ask.go')}>
          <Icon name="sparkle" size={18} strokeWidth={2} />
        </button>
      </form>
      {!open && (
        <div className="ask-chips">
          {suggestions(t).map((s) => (
            <button key={s} type="button" onClick={() => ask(s)}>{s}</button>
          ))}
        </div>
      )}
      {open && (
        <div className={`ask-answer ${reply?.tone ?? ''}`} role="status" aria-live="polite">
          <div className="ask-who">
            <span>✦ Planner</span>
            <button type="button" className="ask-x" onClick={close} aria-label={t('common.close')}><Icon name="close" size={14} /></button>
          </div>
          {asked && <div className="ask-q">“{asked}”</div>}
          {busy && !reply ? (
            <div className="ask-a ask-thinking">{t('ask.thinking')}</div>
          ) : reply && (
            <>
              <div className="ask-a"><Rich text={reply.text} /></div>
              {!!reply.actions?.length && (
                <div className="ask-acts">
                  {reply.actions.map((a, i) => (
                    <button key={i} type="button" className={`btn ${a.primary ? 'btn-primary' : ''}`} disabled={busy} onClick={() => act(a)}>{a.label}</button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
