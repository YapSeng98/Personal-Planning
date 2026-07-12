import { useEffect, useState } from 'react'
import { db, todayStr, habitStreak, type Goal } from '../db/db'

interface WeekDay {
  label: string
  done: number
}

/** Right-hand rail on laptop: year-goal ring, week momentum, best streak. */
export default function Insights() {
  const [goal, setGoal] = useState<Goal | null>(null)
  const [week, setWeek] = useState<WeekDay[]>([])
  const [streak, setStreak] = useState(0)

  useEffect(() => {
    ;(async () => {
      const g = await db.goals.filter((x) => x.type === 'year' && !x.deleted).first()
      setGoal(g ?? null)

      const days: WeekDay[] = []
      for (let d = 6; d >= 0; d--) {
        const date = new Date(Date.now() - d * 86400_000)
        const done = await db.tasks
          .where('due')
          .equals(todayStr(date))
          .and((t) => t.state === 'done' && !t.deleted)
          .count()
        days.push({ label: 'SMTWTFS'[date.getDay()], done })
      }
      setWeek(days)

      const habits = await db.habits.filter((h) => h.active === 1 && !h.deleted).toArray()
      let best = 0
      for (const h of habits) best = Math.max(best, await habitStreak(h.id))
      setStreak(best)
    })()
  }, [])

  const max = Math.max(1, ...week.map((w) => w.done))

  return (
    <aside className="insights" aria-label="Insights">
      {goal && (
        <div className="card ins-card">
          <div className="ins-h">Year goal</div>
          <div className="ring-big" style={{ ['--p' as string]: goal.progress }}>
            <span className="v num">{goal.progress}%</span>
          </div>
          <div className="ins-sub">{goal.title}</div>
        </div>
      )}
      <div className="card ins-card">
        <div className="ins-h">Week momentum</div>
        <div className="bars" role="img" aria-label={`Tasks completed each day this week, peak ${max}`}>
          {week.map((w, i) => (
            <div key={i} className="bar-col">
              <i style={{ height: `${(w.done / max) * 100}%` }} className={i === 6 ? 'hot' : ''} />
              <span>{w.label}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="card ins-card">
        <div className="ins-h">Best streak</div>
        <div className="streak-big">
          🔥 <span className="num">{streak}</span> {streak === 1 ? 'day' : 'days'}
        </div>
        <div className="ins-sub">Keep the chain going</div>
      </div>
    </aside>
  )
}
