import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { CHANGED, cleanEmoji } from '../db/db'
import { computeAnalytics, type Analytics as Data } from '../lib/analytics'
import { useLang } from '../lib/i18n'
import { hm } from '../lib/timer'
import { projectColorVar } from '../lib/projectColors'

export default function Analytics() {
  const [d, setD] = useState<Data | null>(null)
  const { t } = useLang()
  const navigate = useNavigate()
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
  const f = d.focus
  const hasFocus = f.daily.some((x) => x.minutes > 0) || f.byProject.length > 0
  const hasData = d.weekTotal > 0 || d.habits.length > 0 || d.reviewsLogged > 0 || hasFocus
  const maxFocus = Math.max(1, ...f.daily.map((x) => x.minutes))
  const ratio = f.estimates.ratio
  const estLine = ratio >= 1.05 ? t('an.estOver', { x: ratio.toFixed(1) })
    : ratio <= 0.95 ? t('an.estUnder', { pct: Math.round(ratio * 100) })
      : t('an.estOk')
  const maxProj = Math.max(1, ...f.byProject.map((x) => x.minutes))

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

      {/* Focus time — from the timer on Today */}
      <div className="section-h">{t('an.focus')}</div>
      <div className="card chart-card">
        {hasFocus ? (
          <>
            <div className="focus-tiles">
              <div><b className="num">{hm(f.todayMin / 60)}</b><span>{t('an.focusToday')}</span></div>
              <div><b className="num">{hm(f.weekMin / 60)}</b><span>{t('an.focusWeek')}</span></div>
              <div><b className="num">{hm(f.avgMin / 60)}</b><span>{t('an.focusAvg')}</span></div>
            </div>
            <div className="chart-bars" role="img" aria-label={t('an.focusAria', { time: hm(f.daily.reduce((n, x) => n + x.minutes, 0) / 60) })}>
              {f.daily.map((day, i) => (
                <div className="cb-col" key={day.date} title={`${day.date}: ${hm(day.minutes / 60)}`}>
                  <div className="cb-track">
                    {day.minutes > 0 && <div className={`cb-done ${i === f.daily.length - 1 ? 'today' : ''}`} style={{ height: `${(day.minutes / maxFocus) * 100}%` }} />}
                  </div>
                  <span className="cb-lbl">{day.label}</span>
                </div>
              ))}
            </div>
          </>
        ) : (
          <p className="an-hint">{t('an.focusEmpty')}</p>
        )}
      </div>

      {f.byProject.length > 0 && (
        <>
          <div className="section-h">{t('an.focusProjects')}</div>
          <div className="card">
            {f.byProject.map((p) => (
              <div className="hbar-row" key={p.id || 'none'} title={`${p.title || t('an.noProject')}: ${hm(p.minutes / 60)}`}>
                <span className="hbar-dot" style={{ background: p.color ? projectColorVar(p.color) : 'var(--text-3)' }} aria-hidden />
                <span className="hbar-name">{p.title || t('an.noProject')}</span>
                <div className="hbar-track">
                  <div className="hbar-fill" style={{ width: `${(p.minutes / maxProj) * 100}%`, background: p.color ? projectColorVar(p.color) : 'var(--text-3)' }} />
                </div>
                <span className="hbar-pct num">{hm(p.minutes / 60)}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {f.estimates.n > 0 && (
        <>
          <div className="section-h">{t('an.estimates')}</div>
          <div className="card est-card">
            <p className="est-line">{estLine}</p>
            <p className="est-sub num">{t('an.estOnTarget', { k: f.estimates.onTarget, n: f.estimates.n })}</p>
            {f.estimates.over.length > 0 && (
              <>
                <div className="est-h">{t('an.estBiggest')}</div>
                {f.estimates.over.map((x) => (
                  <div className="est-row" key={x.id}>
                    <span className="est-title" title={x.title}>{x.title}</span>
                    <span className="est-nums num">{hm(x.est)} → <b>{hm(x.spent)}</b></span>
                  </div>
                ))}
              </>
            )}
          </div>
        </>
      )}

      {/* Habit consistency */}
      {d.habits.length > 0 && (
        <>
          <div className="section-h">{t('an.habitConsistency')}</div>
          <div className="card">
            {d.habits.map((h) => (
              <button
                className="hbar-row hbar-link"
                key={h.id}
                title={`${h.name}: logged ${h.days} of 30 days`}
                onClick={() => navigate(`/habits/${h.id}`)}
              >
                <span className="hbar-emoji">{cleanEmoji(h.emoji, h.name)}</span>
                <span className="hbar-name">{h.name}</span>
                <div className="hbar-track">
                  <div className="hbar-fill" style={{ width: `${h.pct}%` }} />
                </div>
                <span className="hbar-pct num">{h.pct}%</span>
              </button>
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
