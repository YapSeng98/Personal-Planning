import { useEffect, useState, useCallback } from 'react'
import { db, type Goal, onChanged } from '../db/db'
import { useLang } from '../lib/i18n'
import { useToday } from '../lib/today'
import { paceOf, paceLine } from '../lib/pace'

/** Right-hand rail on laptop: every Year goal, each with its own progress
    bar — a single goal used to stand in for all of them (Dexie's .first(),
    arbitrary order), silently hiding the rest whenever there was more than
    one — and whether it's on pace (lib/pace.ts). Week momentum + streak live
    inline on the Today screen, so the rail complements rather than repeats. */
export default function Insights() {
  const [goals, setGoals] = useState<Goal[]>([])
  const { t } = useLang()
  const today = useToday()

  const load = useCallback(() => {
    db.goals.filter((x) => x.type === 'year' && !x.deleted).sortBy('title').then(setGoals)
  }, [])

  useEffect(() => {
    load()
    return onChanged(load)
  }, [load])

  if (goals.length === 0) return <aside className="insights" aria-label="Insights" />

  return (
    <aside className="insights" aria-label="Insights">
      <div className="card ins-card-list">
        <div className="ins-h">{t(goals.length === 1 ? 'ins.yearGoal' : 'ins.yearGoals')}</div>
        {goals.map((g) => {
          const pace = paceOf(g, today)
          return (
            <div className="yg-row" key={g.id}>
              <div className="yg-top">
                <span className="yg-title">{g.title}</span>
                <span className="yg-pct num">{g.progress}%</span>
              </div>
              <div className="pbar goal-pbar">
                <i style={{ width: `${g.progress}%` }} />
                {pace && pace.state !== 'late' && <b className="pace-mark" style={{ left: `${pace.expected}%` }} aria-hidden />}
              </div>
              {pace && <div className={`pace-line ${pace.state}`}>{paceLine(pace, t)}</div>}
            </div>
          )
        })}
      </div>
    </aside>
  )
}
