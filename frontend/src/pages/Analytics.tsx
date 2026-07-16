import { useEffect, useState, useCallback } from 'react'
import { CHANGED, cleanEmoji } from '../db/db'
import { computeAnalytics, type Analytics as Data } from '../lib/analytics'
import { useLang } from '../lib/i18n'

export default function Analytics() {
  const [d, setD] = useState<Data | null>(null)
  const { t } = useLang()
  const load = useCallback(() => {
    computeAnalytics().then(setD)
  }, [])
  useEffect(() => {
    load()
    window.addEventListener(CHANGED, load)
    return () => window.removeEventListener(CHANGED, load)
  }, [load])

  if (!d) return <div className="greet"><h1>{t('an.title')}</h1><div className="empty">{t('an.loading')}</div></div>

  const maxDaily = Math.max(1, ...d.daily.map((x) => x.total || x.done))
  const hasData = d.weekTotal > 0 || d.habits.length > 0 || d.reviewsLogged > 0

  return (
    <div>
      <div className="greet">
        <h1>{t('an.title')} 📊</h1>
        <div className="sub">{t('an.sub')}</div>
      </div>

      {!hasData && (
        <div className="card empty-cta">
          <p>{t('an.empty')}</p>
        </div>
      )}

      {/* Stat tiles */}
      <div className="stat-row">
        <div className="stat-tile">
          <div className="stat-v num">{d.weekPct}<span className="stat-u">%</span></div>
          <div className="stat-l">{t('an.weekDone')}</div>
          <div className="stat-sub num">{d.weekDone}/{d.weekTotal} {t('an.tasks')}</div>
        </div>
        <div className="stat-tile">
          <div className="stat-v num">{d.bestStreak}</div>
          <div className="stat-l">{t('an.bestStreak')}</div>
          <div className="stat-sub">{t('an.consecutive')}</div>
        </div>
        <div className="stat-tile">
          <div className="stat-v num">{d.activeGoals}</div>
          <div className="stat-l">{t('an.activeGoals')}</div>
          <div className="stat-sub num">{t('an.avgDone', { n: d.avgProgress })}</div>
        </div>
        <div className="stat-tile">
          <div className="stat-v num">{d.reviewsLogged}</div>
          <div className="stat-l">{t('an.reviews')}</div>
          <div className="stat-sub">{t('an.reflections')}</div>
        </div>
      </div>

      {/* Task completion — last 14 days */}
      <div className="section-h">{t('an.taskCompletion')}</div>
      <div className="card chart-card">
        <div className="chart-bars" role="img" aria-label={`Tasks completed each of the last 14 days, peak ${maxDaily}`}>
          {d.daily.map((day, i) => {
            const donePct = (day.done / maxDaily) * 100
            const totPct = (day.total / maxDaily) * 100
            const isToday = i === d.daily.length - 1
            return (
              <div className="cb-col" key={day.date} title={`${day.date}: ${day.done} of ${day.total} done`}>
                <div className="cb-track">
                  <div className="cb-total" style={{ height: `${totPct}%` }} />
                  <div className={`cb-done ${isToday ? 'today' : ''}`} style={{ height: `${donePct}%` }} />
                </div>
                <span className="cb-lbl">{day.label}</span>
              </div>
            )
          })}
        </div>
        <div className="chart-legend">
          <span><i className="lg lg-done" /> {t('an.completed')}</span>
          <span><i className="lg lg-total" /> {t('an.planned')}</span>
        </div>
      </div>

      {/* Habit consistency */}
      {d.habits.length > 0 && (
        <>
          <div className="section-h">{t('an.habitConsistency')}</div>
          <div className="card">
            {d.habits.map((h) => (
              <div className="hbar-row" key={h.id} title={`${h.name}: logged ${h.days} of 30 days`}>
                <span className="hbar-emoji">{cleanEmoji(h.emoji, h.name)}</span>
                <span className="hbar-name">{h.name}</span>
                <div className="hbar-track">
                  <div className="hbar-fill" style={{ width: `${h.pct}%` }} />
                </div>
                <span className="hbar-pct num">{h.pct}%</span>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Mood trend */}
      {d.moods.length > 0 && (
        <>
          <div className="section-h">{t('an.moodEnergy')}</div>
          <div className="card mood-trend">
            {d.moods.map((m, i) => (
              <div className="mt-col" key={i} title={`${m.date}: energy ${m.energy}/5`}>
                <div className="mt-bar-track">
                  <div className="mt-bar" style={{ height: `${(m.energy / 5) * 100}%` }} />
                </div>
                <span className="mt-mood">{m.mood}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
