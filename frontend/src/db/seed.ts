import { db, uuid, todayStr } from './db'

/** Demo data for offline/first-run exploration. Runs once, only if empty. */
export async function seedIfEmpty() {
  const seeded = await db.meta.get('seeded')
  if (seeded) return
  const now = Date.now()
  const today = todayStr()

  const yearGoal = {
    id: uuid(),
    title: 'Increase investment portfolio by 20%',
    type: 'year' as const,
    lifeArea: 'Finance',
    whyItMatters: 'Compound growth toward financial independence.',
    progress: 62,
    status: 'in_progress' as const,
    targetDate: `${new Date().getFullYear()}-12-31`,
    deleted: 0 as const,
    updatedAt: now,
  }
  await db.goals.add(yearGoal)

  const mk = (t: Partial<Parameters<typeof db.tasks.add>[0]> & { title: string }) => ({
    id: uuid(),
    state: 'open' as const,
    priority: 3,
    due: today,
    deleted: 0 as const,
    updatedAt: now,
    ...t,
  })
  await db.tasks.bulkAdd([
    mk({ title: 'Morning gym', state: 'done', timeBlockStart: `${today}T06:00`, timeBlockEnd: `${today}T07:00` }),
    mk({ title: 'Q3 portfolio rebalance', isMit: true, priority: 1, estimatedHours: 2, goalId: yearGoal.id, timeBlockStart: `${today}T09:00`, timeBlockEnd: `${today}T11:00` }),
    mk({ title: 'Daily review + journal', timeBlockStart: `${today}T20:00`, timeBlockEnd: `${today}T21:00` }),
  ])

  const habits = [
    { name: 'Drink water', emoji: '💧', targetPerDay: 8 },
    { name: 'Exercise', emoji: '🏃', targetPerDay: 1 },
    { name: 'Read', emoji: '📖', targetPerDay: 1 },
    { name: 'Meditate', emoji: '🧘', targetPerDay: 1 },
  ].map((h) => ({
    id: uuid(),
    frequency: 'daily' as const,
    active: 1 as const,
    deleted: 0 as const,
    updatedAt: now,
    ...h,
  }))
  await db.habits.bulkAdd(habits)

  // Backdate a few logs so streaks render.
  const logs = []
  for (let d = 1; d <= 5; d++) {
    const date = todayStr(new Date(Date.now() - d * 86400_000))
    for (const h of habits.slice(1, 3)) {
      logs.push({ id: uuid(), habitId: h.id, date, count: 1, deleted: 0 as const, updatedAt: now })
    }
  }
  await db.habitLogs.bulkAdd(logs)

  await db.meta.put({ key: 'seeded', value: '1' })
}
