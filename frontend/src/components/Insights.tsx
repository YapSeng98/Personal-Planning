import { useEffect, useState, useCallback } from 'react'
import { db, CHANGED, type Goal } from '../db/db'
import { useLang } from '../lib/i18n'

/** Right-hand rail on laptop: the year-goal ring. Week momentum + streak now
    live inline on the Today screen, so the rail complements rather than repeats. */
export default function Insights() {
  const [goal, setGoal] = useState<Goal | null>(null)
  const { t } = useLang()

  const load = useCallback(() => {
    db.goals.filter((x) => x.type === 'year' && !x.deleted).first().then((g) => setGoal(g ?? null))
  }, [])

  useEffect(() => {
    load()
    window.addEventListener(CHANGED, load)
    return () => window.removeEventListener(CHANGED, load)
  }, [load])

  if (!goal) return <aside className="insights" aria-label="Insights" />

  return (
    <aside className="insights" aria-label="Insights">
      <div className="card ins-card">
        <div className="ins-h">{t('ins.yearGoal')}</div>
        <div className="ring-big" style={{ ['--p' as string]: goal.progress }}>
          <span className="v num">{goal.progress}%</span>
        </div>
        <div className="ins-sub">{goal.title}</div>
      </div>
    </aside>
  )
}
