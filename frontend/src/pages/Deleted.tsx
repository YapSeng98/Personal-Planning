import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { onChanged, cleanEmoji } from '../db/db'
import { useLang, type TFn } from '../lib/i18n'
import { binItems, restoreItem, BIN_DAYS, type BinItem } from '../lib/bin'
import Icon from '../components/Icon'

const DAY = 86_400_000

/** "Task · Mon 14 Nov", "Goal · Year", "Note · 2 files"… */
function detail(it: BinItem, t: TFn, locale: string): string {
  const parts = [t(`bin.kind.${it.kind}`)]
  if (it.kind === 'task' && it.detail) parts.push(new Date(it.detail + 'T00:00').toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' }))
  if (it.kind === 'goal' && it.detail) parts.push(t(`level.${it.detail}`))
  if (it.kind === 'review' && it.detail) parts.push(t(`rev.${it.detail}`))
  if (it.files) parts.push(t(it.files === 1 ? 'bin.file1' : 'bin.files', { n: it.files }))
  return parts.join(' · ')
}

/** Recently deleted: the last 30 days of deletes, from every device. */
export default function Deleted() {
  const { t, lang } = useLang()
  const navigate = useNavigate()
  const locale = lang === 'zh' ? 'zh-CN' : 'en'
  const [items, setItems] = useState<BinItem[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [restored, setRestored] = useState<string[]>([])

  const load = useCallback(async () => setItems(await binItems()), [])
  useEffect(() => {
    load()
    return onChanged(load)
  }, [load])

  async function restore(it: BinItem) {
    setBusy(it.id)
    try {
      await restoreItem(it)
      setRestored((r) => [...r, it.title || t('sketch.untitled')])
    } finally {
      setBusy(null)
    }
  }

  const now = Date.now()
  return (
    <div>
      <div className="greet page-head">
        <div className="hd-title-wrap">
          <div className="hd-title-row">
            <button className="hd-back" onClick={() => navigate(-1)} aria-label={t('common.back')}><Icon name="chevronLeft" size={18} /></button>
            <h1>{t('bin.title')}</h1>
          </div>
          <div className="sub">{t('bin.sub', { n: BIN_DAYS })}</div>
        </div>
      </div>

      {restored.length > 0 && (
        <div className="ai-status ok bin-restored" role="status">✓ {t('bin.restoredNote', { title: restored[restored.length - 1] })}</div>
      )}

      {items && items.length === 0 && <div className="card empty">{t('bin.empty', { n: BIN_DAYS })}</div>}
      {items && items.length > 0 && (
        <div className="card bin-list">
          {items.map((it) => {
            const ago = Math.max(0, Math.floor((now - it.deletedAt) / DAY))
            const left = Math.max(1, BIN_DAYS - ago)
            const title = it.kind === 'review'
              ? new Date(it.title + 'T00:00').toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' })
              : it.title || t('sketch.untitled')
            return (
              <div className="bin-row" key={`${it.kind}:${it.id}`}>
                <span className="bin-ico" aria-hidden>{it.kind === 'habit' ? cleanEmoji(it.emoji ?? '', it.title) : <Icon name={ICON[it.kind]} size={17} />}</span>
                <div className="bin-body">
                  <div className="bin-title">{title}</div>
                  <div className="row-sub">
                    {detail(it, t, locale)} · {ago === 0 ? t('bin.agoToday') : t(ago === 1 ? 'bin.ago1' : 'bin.ago', { n: ago })} · {t(left === 1 ? 'bin.left1' : 'bin.left', { n: left })}
                  </div>
                </div>
                <button type="button" className="btn" disabled={busy === it.id} onClick={() => restore(it)} aria-label={`${t('bin.restore')} ${title}`}>
                  {t('bin.restore')}
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

const ICON = { task: 'check', goal: 'goals', project: 'board', note: 'pencil', folder: 'folder', review: 'reviews', habit: 'today' } as const
