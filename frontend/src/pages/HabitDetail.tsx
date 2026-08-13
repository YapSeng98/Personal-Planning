import { useEffect, useState, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { db, todayStr, cleanEmoji, habitStats, CHANGED, type Habit, type HabitStats } from '../db/db'
import { aiEnabled, askAI } from '../lib/ai'
import HabitEdit from '../components/HabitEdit'
import { useLang } from '../lib/i18n'

export default function HabitDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [habit, setHabit] = useState<Habit | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [stats, setStats] = useState<HabitStats | null>(null)
  const [editing, setEditing] = useState(false)
  const [insight, setInsight] = useState<string | null>(null)
  const [insightState, setInsightState] = useState<'idle' | 'loading' | 'err'>('idle')
  const insightAuto = useRef(false)
  const { t, lang } = useLang()

  const load = useCallback(async () => {
    if (!id) return
    const h = await db.habits.get(id)
    const valid = h && !h.deleted ? h : null
    setHabit(valid)
    setStats(valid ? await habitStats(id) : null)
    setLoaded(true)
  }, [id])

  useEffect(() => {
    load()
    window.addEventListener(CHANGED, load)
    return () => window.removeEventListener(CHANGED, load)
  }, [load])

  const generateInsight = useCallback(async (force = false) => {
    if (!id || !habit || !stats || !aiEnabled()) return
    const cacheKey = `planner_habit_insight_${id}_${todayStr()}`
    if (!force) {
      const cached = localStorage.getItem(cacheKey)
      if (cached) { setInsight(cached); return }
    }
    setInsightState('loading')
    try {
      const dayNames = lang === 'zh' ? ['日', '一', '二', '三', '四', '五', '六'] : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
      const weekdayLine = stats.weekday.map((c, i) => `${dayNames[i]}: ${c}`).join(', ')
      const prompt = `Habit: "${habit.name}" (target ${habit.targetPerDay}/day).\nCurrent streak: ${stats.current} days. Longest ever: ${stats.longest} days. Total days logged: ${stats.totalDays}. Last 30 days: ${stats.last30Rate}% hit rate.\nCompletions by weekday: ${weekdayLine}.\nGive me a short, specific insight and one practical suggestion to help me keep this habit going.`
      const system = lang === 'zh'
        ? '你是一位简洁、真诚的习惯教练。用2-3个短句：指出数据中一个真实的规律（比如哪天最容易中断），并给一个具体、可执行的建议。不要泛泛而谈，不要列表，最多一个表情。用中文回复。'
        : "You are a concise, honest habit coach. In 2-3 short sentences: point out one real pattern in the data (e.g. which day breaks the chain), and give one specific, actionable suggestion. No generic advice, no lists, at most one emoji."
      const text = await askAI(prompt, system)
      setInsight(text)
      localStorage.setItem(cacheKey, text)
      setInsightState('idle')
    } catch {
      setInsightState('err')
    }
  }, [id, habit, stats, lang])

  useEffect(() => {
    if (!habit || !stats || !id || !aiEnabled()) return
    const cached = localStorage.getItem(`planner_habit_insight_${id}_${todayStr()}`)
    if (cached) { setInsight(cached); return }
    if (insightAuto.current) return
    insightAuto.current = true
    generateInsight()
  }, [habit, stats, id, generateInsight])

  if (!loaded) return <div className="greet"><h1>{t('habit.detailTitle')}</h1></div>

  if (!habit) {
    return (
      <div>
        <div className="greet page-head">
          <div><h1>{t('habit.notFound')}</h1></div>
        </div>
        <div className="card empty-cta">
          <p>{t('habit.notFoundSub')}</p>
          <button className="btn btn-primary" onClick={() => navigate('/')}>{t('habit.backToday')}</button>
        </div>
      </div>
    )
  }

  const s = stats!
  const maxWeekday = Math.max(1, ...s.weekday)
  const weekdayLbl = 'SMTWTFS'

  return (
    <div>
      <div className="greet page-head">
        <div className="hd-title-wrap">
          <div className="hd-title-row">
            <button className="hd-back" onClick={() => navigate(-1)} aria-label={t('common.cancel')}>‹</button>
            <h1>{cleanEmoji(habit.emoji, habit.name)} {habit.name}</h1>
          </div>
          <div className="sub">{t('habit.targetLine', { n: habit.targetPerDay })}</div>
        </div>
        <button className="btn" onClick={() => setEditing(true)}>{t('habit.editBtn')}</button>
      </div>

      {s.totalDays === 0 ? (
        <div className="card empty-cta">
          <p>{t('habit.noLogsYet')}</p>
        </div>
      ) : (
        <>
          <div className="stat-row">
            <div className="stat-tile">
              <div className="stat-v num">{s.current}</div>
              <div className="stat-l">{t('habit.currentStreak')}</div>
              <div className="stat-sub">🔥 {t(s.current === 1 ? 'ins.day' : 'ins.days')}</div>
            </div>
            <div className="stat-tile">
              <div className="stat-v num">{s.longest}</div>
              <div className="stat-l">{t('habit.longestStreak')}</div>
              <div className="stat-sub">{t('habit.everRecorded')}</div>
            </div>
            <div className="stat-tile">
              <div className="stat-v num">{s.totalDays}</div>
              <div className="stat-l">{t('habit.totalDays')}</div>
              <div className="stat-sub">{s.firstLogDate ? t('habit.since', { date: s.firstLogDate }) : ''}</div>
            </div>
            <div className="stat-tile">
              <div className="stat-v num">{s.last30Rate}<span className="stat-u">%</span></div>
              <div className="stat-l">{t('habit.last30')}</div>
              <div className="stat-sub">{t('habit.last30Sub')}</div>
            </div>
          </div>

          {aiEnabled() && (
            <div className="card card-ai briefing habit-insight">
              <div className="lbl grad-text">
                ✦ {t('habit.aiInsight')}
                <button
                  className="insight-refresh"
                  onClick={() => generateInsight(true)}
                  disabled={insightState === 'loading'}
                  aria-label={t('today.refresh')}
                  title={t('today.refresh')}
                >
                  {insightState === 'loading' ? '…' : '↻'}
                </button>
              </div>
              <div className="txt">
                {insight ?? (insightState === 'loading' ? t('rev.drafting') : insightState === 'err' ? t('rev.draftErr') : '')}
              </div>
            </div>
          )}

          <div className="section-h">{t('habit.byWeekday')}</div>
          <div className="card chart-card">
            <div className="chart-bars" role="img" aria-label={`${habit.name}: ${s.weekday.map((c, i) => `${weekdayLbl[i]} ${c}`).join(', ')}`}>
              {s.weekday.map((c, i) => (
                <div className="cb-col" key={i} title={`${weekdayLbl[i]}: ${c}`}>
                  <div className="cb-track">
                    <div className="cb-done" style={{ height: `${(c / maxWeekday) * 100}%` }} />
                  </div>
                  <span className="cb-lbl">{weekdayLbl[i]}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="section-h">{t('habit.calendar')}</div>
          <div className="card heatmap-card">
            <div className="heatmap">
              {s.heatmap.map((d) => {
                const intensity = habit.targetPerDay > 0 ? Math.min(1, d.count / habit.targetPerDay) : d.hit ? 1 : 0
                return (
                  <div
                    key={d.date}
                    className={`hm-cell ${d.hit ? 'hit' : ''}`}
                    style={d.hit ? { opacity: 0.35 + intensity * 0.65 } : undefined}
                    title={`${d.date}: ${d.count}/${habit.targetPerDay}`}
                  />
                )
              })}
            </div>
          </div>
        </>
      )}

      {editing && <HabitEdit habit={habit} onClose={() => setEditing(false)} />}
    </div>
  )
}
