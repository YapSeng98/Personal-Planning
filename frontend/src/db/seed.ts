import { db, uuid, todayStr, type Goal } from './db'

/** Demo data for offline/first-run exploration.
    Versioned: v1 seeded basics; v2 adds the full goal hierarchy chain.
    Runs the missing part only, so upgraded devices get topped up. */
export async function seedIfEmpty() {
  const seeded = await db.meta.get('seeded')
  if (seeded?.value === '2') return
  const now = Date.now()
  const today = todayStr()
  const year = new Date().getFullYear()
  const quarter = Math.ceil((new Date().getMonth() + 1) / 3)
  const monthName = new Date().toLocaleDateString(undefined, { month: 'long' })

  // --- goal hierarchy: Year → Quarter → Month → Week ---
  let yearGoal = await db.goals.filter((g) => g.type === 'year').first()
  if (!yearGoal) {
    yearGoal = {
      id: uuid(),
      title: 'Increase investment portfolio by 20%',
      type: 'year',
      lifeArea: 'Finance',
      whyItMatters: 'Compound growth toward financial independence.',
      progress: 62,
      status: 'in_progress',
      targetDate: `${year}-12-31`,
      deleted: 0,
      updatedAt: now,
    }
    await db.goals.add(yearGoal)
  }

  const mkGoal = (g: Partial<Goal> & Pick<Goal, 'title' | 'type'>): Goal => ({
    id: uuid(),
    progress: 0,
    status: 'in_progress',
    deleted: 0,
    updatedAt: now,
    ...g,
  })

  const hasChain = await db.goals.filter((g) => g.type === 'quarter').count()
  let weekGoalId: string | undefined
  if (hasChain === 0) {
    const q = mkGoal({
      title: `Q${quarter}: rebalance portfolio + automate savings`,
      type: 'quarter',
      parentId: yearGoal.id,
      lifeArea: 'Finance',
      progress: 55,
    })
    const m = mkGoal({
      title: `${monthName}: complete portfolio review`,
      type: 'month',
      parentId: q.id,
      lifeArea: 'Finance',
      progress: 40,
    })
    const w = mkGoal({
      title: 'This week: rebalance + set auto-transfer',
      type: 'week',
      parentId: m.id,
      lifeArea: 'Finance',
      progress: 33,
    })
    const m2 = mkGoal({
      title: `${monthName}: run 40km total`,
      type: 'month',
      lifeArea: 'Health',
      progress: 65,
    })
    await db.goals.bulkAdd([q, m, w, m2])
    weekGoalId = w.id
  }

  // --- v1 basics: only when nothing was ever seeded ---
  if (!seeded) {
    await db.tasks.bulkAdd([
      {
        id: uuid(), title: 'Morning gym', state: 'done', priority: 3, due: today,
        timeBlockStart: `${today}T06:00`, timeBlockEnd: `${today}T07:00`,
        deleted: 0, updatedAt: now,
      },
      {
        id: uuid(), title: 'Q3 portfolio rebalance', state: 'open', priority: 1, due: today,
        isMit: true, estimatedHours: 2, goalId: weekGoalId ?? yearGoal.id,
        timeBlockStart: `${today}T09:00`, timeBlockEnd: `${today}T11:00`,
        deleted: 0, updatedAt: now,
      },
      {
        id: uuid(), title: 'Daily review + journal', state: 'open', priority: 3, due: today,
        timeBlockStart: `${today}T20:00`, timeBlockEnd: `${today}T21:00`,
        deleted: 0, updatedAt: now,
      },
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

    // Backdate a few logs so streaks and week momentum render.
    const logs = []
    for (let d = 1; d <= 5; d++) {
      const date = todayStr(new Date(Date.now() - d * 86400_000))
      for (const h of habits.slice(1, 3)) {
        logs.push({ id: uuid(), habitId: h.id, date, count: 1, deleted: 0 as const, updatedAt: now })
      }
    }
    await db.habitLogs.bulkAdd(logs)

    // A few completed tasks earlier this week, so the momentum bars have shape.
    const past = []
    for (let d = 1; d <= 4; d++) {
      const date = todayStr(new Date(Date.now() - d * 86400_000))
      for (let k = 0; k <= (d % 3); k++) {
        past.push({
          id: uuid(), title: 'Done earlier this week', state: 'done' as const,
          priority: 3, due: date, deleted: 0 as const, updatedAt: now,
        })
      }
    }
    await db.tasks.bulkAdd(past)
  }

  await db.meta.put({ key: 'seeded', value: '2' })
}
