import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'

export type Lang = 'en' | 'zh'
export const LANGS: { value: Lang; label: string; native: string }[] = [
  { value: 'en', label: 'English', native: 'English' },
  { value: 'zh', label: 'Chinese', native: '中文' },
]

const KEY = 'planner_lang'

export function getLang(): Lang {
  const v = localStorage.getItem(KEY)
  if (v === 'en' || v === 'zh') return v
  // First run: follow the browser if it's Chinese.
  return navigator.language?.toLowerCase().startsWith('zh') ? 'zh' : 'en'
}

// Only user-facing chrome is translated; the user's own content (task titles,
// goal names, notes) is never touched.
type Dict = Record<string, string>
const en: Dict = {
  // nav / shell
  'nav.today': 'Today', 'nav.plan': 'Plan', 'nav.goals': 'Goals', 'nav.reviews': 'Review',
  'nav.stats': 'Stats', 'nav.settings': 'Settings', 'brand': 'Planner',
  'sync.idle': 'Synced', 'sync.syncing': 'Syncing…', 'sync.offline': 'Offline — changes queued',
  'sync.local': 'Local only', 'sync.error': 'Sync error — retrying',
  // login
  'login.tagline': 'Plan the year. Win the day.',
  'login.subSignin': 'Daily tasks roll up to yearly goals — synced to your ServiceNow instance.',
  'login.subRegister': 'Pick any username and password — your account lives in your own instance.',
  'login.username': 'Username', 'login.password': 'Password',
  'login.signin': 'Sign in', 'login.create': 'Create account', 'login.working': 'Working…',
  'login.toRegister': 'New here? Create an account', 'login.toSignin': 'Have an account? Sign in',
  'login.or': 'or', 'login.offline': 'Explore offline with sample data',
  'login.failed': 'Something went wrong — try again.',
  // today
  'today.morning': 'Good morning', 'today.afternoon': 'Good afternoon', 'today.evening': 'Good evening',
  'today.blocks': '{n} blocks planned', 'today.block': '{n} block planned',
  'today.briefing': 'Briefing', 'today.habits': 'Habits', 'today.tasks': "Today's tasks",
  'today.noHabits': 'No habits yet', 'today.addFirstHabit': 'Add your first habit', 'today.add': 'Add',
  'today.emptyTasks': "Nothing planned yet — what's the one thing that would make today a win?",
  'today.addFirstTask': '+ Add your first task', 'today.anytime': 'anytime', 'today.mit': 'MIT',
  'brief.cleanSlate': 'A clean slate. Add your first task with the + button — small starts count.',
  'brief.allDone': 'All {n} done — that\'s a full sweep. Enjoy the win! 🎉',
  'brief.momentum': '{done} down, {left} to go — good momentum.',
  'brief.planned': '{n} planned today. One block at a time.',
  'brief.mit': 'Your most important task: {title}.',
  'brief.next': 'Next block at {time}.',
  // task form
  'task.titlePh': 'Add a task… e.g. “gym 6am” or “report 2h”',
  'task.due': 'Due date', 'task.timeBlock': 'Time block (optional)', 'task.start': 'Start', 'task.end': 'End',
  'task.tapToSet': 'Tap to set', 'task.clearTime': 'Clear time block',
  'task.goal': 'Counts toward goal (optional)', 'task.noGoal': 'No goal link', 'task.mitFull': 'Most Important Task',
  'task.on': '· on', 'task.save': 'Save task', 'task.addTask': 'Add task',
  'task.deleteConfirm': 'Delete "{title}"? It disappears everywhere after sync.',
  // habit
  'habit.namePh': 'Habit name… e.g. “Drink water”', 'habit.icon': 'Icon',
  'habit.perDay': 'Times per day (water = 8, most habits = 1)',
  'habit.save': 'Save habit', 'habit.add': 'Add habit',
  'habit.deleteConfirm': 'Delete habit "{name}"? Its logged history stays saved.',
  // common
  'common.cancel': 'Cancel', 'common.delete': 'Delete', 'common.today': 'today',
  // goals
  'goals.title': 'Goals', 'goals.sub': 'Vision → Year → Quarter → Month → Week — progress rolls up. Tap a goal to edit.',
  'goals.add': '+ Goal', 'goals.empty': 'No goals yet — add a Year goal to anchor everything.',
  'goals.titlePh': 'Goal title… e.g. “Increase portfolio by 20%”',
  'goals.level': 'Level', 'goals.status': 'Status', 'goals.parent': 'Part of (parent goal)',
  'goals.noParent': 'No parent', 'goals.targetDate': 'Target date', 'goals.progress': 'Progress %',
  'goals.hint': 'Progress you type here is kept until tasks are linked — once tasks (or child goals) exist, it\'s calculated from them automatically.',
  'goals.save': 'Save goal', 'goals.addGoal': 'Add goal',
  'goals.deleteConfirm': 'Delete "{title}"? It disappears everywhere after sync.',
  'level.vision': 'Vision', 'level.year': 'Year goals', 'level.quarter': 'Quarter goals',
  'level.month': 'Month goals', 'level.week': 'Week goals',
  'status.not_started': 'not started', 'status.in_progress': 'in progress', 'status.at_risk': 'at risk',
  'status.completed': 'completed', 'status.abandoned': 'abandoned',
  // plan
  'plan.title': 'Plan', 'plan.sub': '{month} — month goals and your week, day by day.',
  'plan.monthGoals': 'Month goals', 'plan.addTask': '+ add task', 'plan.backToWeek': '↩ Back to this week',
  'plan.thisWeek': 'This week', 'plan.lastWeek': 'Last week', 'plan.nextWeek': 'Next week',
  'plan.weeksAgo': '{n} weeks ago', 'plan.inWeeks': 'In {n} weeks', 'plan.done': 'done',
  // reviews
  'rev.title': 'Reviews', 'rev.sub': 'Reflect on facts, not memory — the numbers are pre-filled.',
  'rev.daily': 'Daily', 'rev.weekly': 'Weekly', 'rev.monthly': 'Monthly', 'rev.yearly': 'Yearly',
  'rev.inNumbers': '{period}, in numbers', 'rev.wins': 'What went well?', 'rev.winsPh': 'Wins, big or small…',
  'rev.fails': "What didn't?", 'rev.failsPh': 'What failed or slipped…',
  'rev.lesson': 'Biggest lesson', 'rev.lessonPh': 'One thing to carry forward…',
  'rev.moodEnergy': 'Mood · Energy', 'rev.nextDaily': "Tomorrow's priorities", 'rev.nextOther': 'Next period priorities',
  'rev.nextPh': 'Top things to focus on next…', 'rev.save': 'Save review', 'rev.update': 'Update review',
  'rev.saved': 'Saved ✓', 'rev.past': 'Past reviews',
  'rev.statsEmpty': 'Nothing logged in this period yet.',
  'rev.statLine': '{done} of {total} tasks done · {checkins} habit check-in',
  'rev.statLinePlural': '{done} of {total} tasks done · {checkins} habit check-ins',
  // analytics
  'an.title': 'Analytics', 'an.sub': "Your momentum, from the data you're already logging.",
  'an.loading': 'Crunching your numbers…',
  'an.empty': 'No stats yet — complete a few tasks and log some habits, and your trends will appear here.',
  'an.weekDone': 'This week done', 'an.tasks': 'tasks', 'an.bestStreak': 'Best streak 🔥',
  'an.consecutive': 'consecutive days', 'an.activeGoals': 'Active goals', 'an.avgDone': 'avg {n}% done',
  'an.reviews': 'Reviews', 'an.reflections': 'reflections logged',
  'an.taskCompletion': 'Task completion · last 14 days', 'an.completed': 'Completed', 'an.planned': 'Planned',
  'an.habitConsistency': 'Habit consistency · last 30 days', 'an.moodEnergy': 'Mood & energy · recent reviews',
  // settings
  'set.title': 'Settings', 'set.sub': 'Appearance, language, account, and sync.',
  'set.appearance': 'Appearance', 'set.themeSystem': 'System', 'set.themeSystemHint': 'follow device',
  'set.themeLight': 'Light', 'set.themeLightHint': 'warm paper', 'set.themeDark': 'Dark', 'set.themeDarkHint': 'deep night',
  'set.language': 'Language', 'set.account': 'Account', 'set.offlineDemo': 'Offline demo',
  'set.signedInAs': 'Signed in to dev405150.service-now.com',
  'set.demoDesc': 'Exploring with sample data — nothing leaves this device.',
  'set.logout': 'Log out', 'set.exitDemo': 'Exit demo', 'set.sync': 'Sync',
  'set.syncIdle': 'Synced with ServiceNow', 'set.syncSyncing': 'Syncing…',
  'set.syncOffline': 'Offline — changes queued locally', 'set.syncLocal': 'Local only — not signed in to sync',
  'set.syncError': 'Sync error — retrying automatically',
  'set.pending': '{n} change waiting to sync', 'set.pendingPlural': '{n} changes waiting to sync',
  'set.allSaved': 'Everything saved', 'set.syncNow': 'Sync now',
  'set.about': 'Planner · offline-first · your data lives in your own ServiceNow instance',
  'set.logoutUnsynced': 'You have {n} change not yet synced — they will be lost. Log out anyway?',
  'set.logoutUnsyncedPlural': 'You have {n} changes not yet synced — they will be lost. Log out anyway?',
  'set.exitConfirm': 'Exit demo mode? Local demo data will be cleared.',
  'set.logoutConfirm': 'Log out? Local data is cleared; it syncs back next time you sign in.',
}

const zh: Dict = {
  'nav.today': '今天', 'nav.plan': '规划', 'nav.goals': '目标', 'nav.reviews': '回顾',
  'nav.stats': '统计', 'nav.settings': '设置', 'brand': '规划器',
  'sync.idle': '已同步', 'sync.syncing': '同步中…', 'sync.offline': '离线 — 更改已排队',
  'sync.local': '仅本地', 'sync.error': '同步错误 — 重试中',
  'login.tagline': '规划全年，赢得每一天。',
  'login.subSignin': '每日任务汇聚成年度目标 — 同步到你的 ServiceNow 实例。',
  'login.subRegister': '任选用户名和密码 — 账户保存在你自己的实例中。',
  'login.username': '用户名', 'login.password': '密码',
  'login.signin': '登录', 'login.create': '创建账户', 'login.working': '处理中…',
  'login.toRegister': '新用户？创建账户', 'login.toSignin': '已有账户？登录',
  'login.or': '或', 'login.offline': '使用示例数据离线体验',
  'login.failed': '出了点问题 — 请重试。',
  'today.morning': '早上好', 'today.afternoon': '下午好', 'today.evening': '晚上好',
  'today.blocks': '已规划 {n} 个时段', 'today.block': '已规划 {n} 个时段',
  'today.briefing': '简报', 'today.habits': '习惯', 'today.tasks': '今日任务',
  'today.noHabits': '还没有习惯', 'today.addFirstHabit': '添加第一个习惯', 'today.add': '添加',
  'today.emptyTasks': '还没有安排 — 今天做哪一件事会让你觉得很值得？',
  'today.addFirstTask': '+ 添加第一个任务', 'today.anytime': '随时', 'today.mit': '要务',
  'brief.cleanSlate': '全新的一天。用 + 按钮添加第一个任务 — 小小的开始也算数。',
  'brief.allDone': '{n} 项全部完成 — 大满贯！好好享受吧！🎉',
  'brief.momentum': '已完成 {done} 项，还剩 {left} 项 — 势头不错。',
  'brief.planned': '今天规划了 {n} 项。一次专注一个时段。',
  'brief.mit': '你的首要任务：{title}。',
  'brief.next': '下一个时段：{time}。',
  'task.titlePh': '添加任务… 例如“健身 6am”或“报告 2h”',
  'task.due': '截止日期', 'task.timeBlock': '时间段（可选）', 'task.start': '开始', 'task.end': '结束',
  'task.tapToSet': '点击设置', 'task.clearTime': '清除时间段',
  'task.goal': '计入目标（可选）', 'task.noGoal': '不关联目标', 'task.mitFull': '首要任务',
  'task.on': '· 开', 'task.save': '保存任务', 'task.addTask': '添加任务',
  'task.deleteConfirm': '删除“{title}”？同步后会在所有设备上消失。',
  'habit.namePh': '习惯名称… 例如“喝水”', 'habit.icon': '图标',
  'habit.perDay': '每天次数（喝水 = 8，多数习惯 = 1）',
  'habit.save': '保存习惯', 'habit.add': '添加习惯',
  'habit.deleteConfirm': '删除习惯“{name}”？已记录的历史会保留。',
  'common.cancel': '取消', 'common.delete': '删除', 'common.today': '今天',
  'goals.title': '目标', 'goals.sub': '愿景 → 年 → 季 → 月 → 周 — 进度自动汇总。点击目标可编辑。',
  'goals.add': '+ 目标', 'goals.empty': '还没有目标 — 添加一个年度目标作为基石。',
  'goals.titlePh': '目标名称… 例如“投资组合增长 20%”',
  'goals.level': '层级', 'goals.status': '状态', 'goals.parent': '所属（上级目标）',
  'goals.noParent': '无上级', 'goals.targetDate': '目标日期', 'goals.progress': '进度 %',
  'goals.hint': '在此输入的进度会保留，直到关联任务 — 一旦有任务（或子目标），进度将自动计算。',
  'goals.save': '保存目标', 'goals.addGoal': '添加目标',
  'goals.deleteConfirm': '删除“{title}”？同步后会在所有设备上消失。',
  'level.vision': '愿景', 'level.year': '年度目标', 'level.quarter': '季度目标',
  'level.month': '月度目标', 'level.week': '每周目标',
  'status.not_started': '未开始', 'status.in_progress': '进行中', 'status.at_risk': '有风险',
  'status.completed': '已完成', 'status.abandoned': '已放弃',
  'plan.title': '规划', 'plan.sub': '{month} — 月度目标与你的一周，按天安排。',
  'plan.monthGoals': '月度目标', 'plan.addTask': '+ 添加任务', 'plan.backToWeek': '↩ 回到本周',
  'plan.thisWeek': '本周', 'plan.lastWeek': '上周', 'plan.nextWeek': '下周',
  'plan.weeksAgo': '{n} 周前', 'plan.inWeeks': '{n} 周后', 'plan.done': '完成',
  'rev.title': '回顾', 'rev.sub': '基于事实回顾，而非记忆 — 数据已预填。',
  'rev.daily': '每日', 'rev.weekly': '每周', 'rev.monthly': '每月', 'rev.yearly': '每年',
  'rev.inNumbers': '{period} 数据', 'rev.wins': '哪些做得好？', 'rev.winsPh': '大大小小的收获…',
  'rev.fails': '哪些没做好？', 'rev.failsPh': '哪些失败或落下了…',
  'rev.lesson': '最大的收获', 'rev.lessonPh': '一件要带到下一步的事…',
  'rev.moodEnergy': '心情 · 精力', 'rev.nextDaily': '明天的优先事项', 'rev.nextOther': '下一阶段的优先事项',
  'rev.nextPh': '接下来要专注的重点…', 'rev.save': '保存回顾', 'rev.update': '更新回顾',
  'rev.saved': '已保存 ✓', 'rev.past': '过往回顾',
  'rev.statsEmpty': '这个阶段还没有记录。',
  'rev.statLine': '完成 {total} 项任务中的 {done} 项 · {checkins} 次习惯打卡',
  'rev.statLinePlural': '完成 {total} 项任务中的 {done} 项 · {checkins} 次习惯打卡',
  'an.title': '统计', 'an.sub': '来自你日常记录的数据，看见你的势头。',
  'an.loading': '正在计算…',
  'an.empty': '还没有统计 — 完成一些任务、记录一些习惯，趋势就会出现在这里。',
  'an.weekDone': '本周完成', 'an.tasks': '任务', 'an.bestStreak': '最长连续 🔥',
  'an.consecutive': '连续天数', 'an.activeGoals': '进行中的目标', 'an.avgDone': '平均完成 {n}%',
  'an.reviews': '回顾', 'an.reflections': '条反思记录',
  'an.taskCompletion': '任务完成 · 近 14 天', 'an.completed': '已完成', 'an.planned': '已规划',
  'an.habitConsistency': '习惯坚持度 · 近 30 天', 'an.moodEnergy': '心情与精力 · 最近的回顾',
  'set.title': '设置', 'set.sub': '外观、语言、账户与同步。',
  'set.appearance': '外观', 'set.themeSystem': '跟随系统', 'set.themeSystemHint': '跟随设备',
  'set.themeLight': '浅色', 'set.themeLightHint': '暖纸', 'set.themeDark': '深色', 'set.themeDarkHint': '深夜',
  'set.language': '语言', 'set.account': '账户', 'set.offlineDemo': '离线体验',
  'set.signedInAs': '已登录 dev405150.service-now.com',
  'set.demoDesc': '正在使用示例数据 — 数据不会离开此设备。',
  'set.logout': '退出登录', 'set.exitDemo': '退出体验', 'set.sync': '同步',
  'set.syncIdle': '已与 ServiceNow 同步', 'set.syncSyncing': '同步中…',
  'set.syncOffline': '离线 — 更改已在本地排队', 'set.syncLocal': '仅本地 — 未登录同步',
  'set.syncError': '同步错误 — 正在自动重试',
  'set.pending': '{n} 项更改待同步', 'set.pendingPlural': '{n} 项更改待同步',
  'set.allSaved': '全部已保存', 'set.syncNow': '立即同步',
  'set.about': '规划器 · 离线优先 · 你的数据保存在你自己的 ServiceNow 实例中',
  'set.logoutUnsynced': '你有 {n} 项更改尚未同步 — 它们将丢失。仍要退出吗？',
  'set.logoutUnsyncedPlural': '你有 {n} 项更改尚未同步 — 它们将丢失。仍要退出吗？',
  'set.exitConfirm': '退出体验模式？本地示例数据将被清除。',
  'set.logoutConfirm': '退出登录？本地数据将被清除；下次登录时会重新同步。',
}

const DICTS: Record<Lang, Dict> = { en, zh }

function interpolate(s: string, params?: Record<string, string | number>): string {
  if (!params) return s
  return s.replace(/\{(\w+)\}/g, (_, k) => String(params[k] ?? `{${k}}`))
}

export type TFn = (key: string, params?: Record<string, string | number>) => string

interface LangCtx { lang: Lang; setLang: (l: Lang) => void; t: TFn }
const Ctx = createContext<LangCtx>({ lang: 'en', setLang: () => {}, t: (k) => k })

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(getLang())
  const t = useCallback<TFn>(
    (key, params) => interpolate(DICTS[lang][key] ?? en[key] ?? key, params),
    [lang],
  )
  const setLang = useCallback((l: Lang) => {
    localStorage.setItem(KEY, l)
    setLangState(l)
    document.documentElement.lang = l === 'zh' ? 'zh-CN' : 'en'
  }, [])
  return <Ctx.Provider value={{ lang, setLang, t }}>{children}</Ctx.Provider>
}

export function useLang() {
  return useContext(Ctx)
}
