import { useEffect, useState, useCallback } from 'react'
import { db, CHANGED, type Goal } from '../db/db'
import { useLang } from '../lib/i18n'

/** Right-hand rail on laptop: every Year goal, each with its own progress
    bar — a single goal used to stand in for all of them (Dexie's .first(),
    arbitrary order), silently hiding the rest whenever there was more than
    one. Week momentum + streak live inline on the Today screen, so the rail
    complements rather than repeats. */
export default function Insights() {
  const [goals, setGoals] = useState<Goal[]>([])
  const { t } = useLang()

  const load = useCallback(() => {
    db.goals.filter((x) => x.type === 'year' && !x.deleted).sortBy('title').then(setGoals)
  }, [])

  useEffect(() => {
    load()
    window.addEventListener(CHANGED, load)
    return () => window.removeEventListener(CHANGED, load)
  }, [load])

  if (goals.length === 0) return <aside className="insights" aria-label="Insights" />

  return (
    <aside className="insights" aria-label="Insights">
      <div className="card ins-card-list">
        <div className="ins-h">{t(goals.length === 1 ? 'ins.yearGoal' : 'ins.yearGoals')}</div>
        {goals.map((g) => (
          <div className="yg-row" key={g.id}>
            <div className="yg-top">
              <span className="yg-title">{g.title}</span>
              <span className="yg-pct num">{g.progress}%</span>
            </div>
            <div className="pbar"><i style={{ width: `${g.progress}%` }} /></div>
          </div>
        ))}
      </div>
    </aside>
  )
}
