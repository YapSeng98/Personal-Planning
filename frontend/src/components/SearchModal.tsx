import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { db, cleanEmoji, OPEN_PROJECT, type Task, type Goal, type SketchFolder, type Habit, type Project } from '../db/db'
import { noteText } from '../lib/noteHtml'
import { compareNames } from '../lib/folders'
import { useLang } from '../lib/i18n'
import Icon from './Icon'

const RESULT_CAP = 6

/** A note as search sees it: its title and its words only (no markup, no
    pictures — a pasted picture is a long run of encoded text that used to
    match short searches), lower-cased once. The note itself (often MBs of
    pictures) isn't kept. */
interface NoteHit { id: string; title: string; kind?: 'draw' | 'text'; words: string; updatedAt: number }

interface Props {
  onClose: () => void
  onOpenTask: (task: Task) => void
}

export default function SearchModal({ onClose, onOpenTask }: Props) {
  const [query, setQuery] = useState('')
  const [tasks, setTasks] = useState<Task[]>([])
  const [goals, setGoals] = useState<Goal[]>([])
  const [sketches, setSketches] = useState<NoteHit[]>([])
  const [folders, setFolders] = useState<SketchFolder[]>([])
  const [habits, setHabits] = useState<Habit[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const inputRef = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()
  const { t } = useLang()

  useEffect(() => {
    db.tasks.filter((x) => !x.deleted).toArray().then(setTasks)
    db.goals.filter((x) => !x.deleted).toArray().then(setGoals)
    // deleted notes aren't found (they used to be)
    db.drawings.filter((x) => !x.deleted).toArray().then((list) => setSketches(list.map((d) => ({
      id: d.id, title: d.title ?? '', kind: d.kind, updatedAt: d.updatedAt,
      words: d.kind === 'text' ? noteText(d.text ?? '', d.format === 'html').toLowerCase() : '',
    }))))
    db.folders.filter((x) => !x.deleted).toArray().then(setFolders)
    db.habits.filter((x) => !x.deleted).toArray().then(setHabits)
    // (archived projects aren't on the Board)
    db.projects.filter((x) => !x.deleted && !x.archived).toArray().then(setProjects)
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const q = query.trim().toLowerCase()
  const matchTasks = q
    ? tasks.filter((x) => x.title.toLowerCase().includes(q) || (x.notes ?? '').toLowerCase().includes(q))
        .sort((a, b) => b.updatedAt - a.updatedAt).slice(0, RESULT_CAP)
    : []
  const matchGoals = q
    ? goals.filter((x) => x.title.toLowerCase().includes(q))
        .sort((a, b) => b.updatedAt - a.updatedAt).slice(0, RESULT_CAP)
    : []
  const matchSketches = q
    ? sketches.filter((x) => x.title.toLowerCase().includes(q) || x.words.includes(q))
        .sort((a, b) => b.updatedAt - a.updatedAt).slice(0, RESULT_CAP)
    : []
  const byName = <T,>(list: T[], name: (x: T) => string) => (q
    ? list.filter((x) => name(x).toLowerCase().includes(q)).sort((a, b) => compareNames(name(a), name(b))).slice(0, RESULT_CAP)
    : [])
  const matchFolders = byName(folders, (f) => f.name)
  const matchHabits = byName(habits, (h) => h.name)
  const matchProjects = byName(projects, (p) => p.title)
  const totalResults = matchTasks.length + matchGoals.length + matchSketches.length + matchFolders.length + matchHabits.length + matchProjects.length

  function openTask(task: Task) {
    onClose()
    onOpenTask(task)
  }

  function openGoal(goal: Goal) {
    onClose()
    navigate(`/goals?edit=${goal.id}`)
  }

  function openSketch(sketch: NoteHit) {
    onClose()
    navigate(`/sketches/${sketch.id}`)
  }

  function openFolder(f: SketchFolder) {
    onClose()
    navigate(`/sketches/folder/${f.id}`)
  }

  function openHabit(h: Habit) {
    onClose()
    navigate(`/habits/${h.id}`)
  }

  function openProject(p: Project) {
    onClose()
    try { localStorage.setItem('planner_board_project', p.id) } catch { /* the Board picks its own */ }
    window.dispatchEvent(new CustomEvent(OPEN_PROJECT, { detail: p.id }))
    navigate('/board')
  }

  function onInputKeyDown(e: React.KeyboardEvent) {
    if (e.key !== 'Enter') return
    if (matchTasks[0]) openTask(matchTasks[0])
    else if (matchGoals[0]) openGoal(matchGoals[0])
    else if (matchSketches[0]) openSketch(matchSketches[0])
    else if (matchFolders[0]) openFolder(matchFolders[0])
    else if (matchHabits[0]) openHabit(matchHabits[0])
    else if (matchProjects[0]) openProject(matchProjects[0])
  }

  return (
    <div className="search-backdrop" onClick={onClose}>
      <div className="search-modal" onClick={(e) => e.stopPropagation()}>
        <div className="search-input-row">
          <span aria-hidden className="search-ico"><Icon name="search" size={18} /></span>
          <input
            ref={inputRef}
            type="text"
            className="search-input"
            placeholder={t('search.placeholder')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onInputKeyDown}
            aria-label={t('search.placeholder')}
          />
        </div>
        <div className="search-results">
          {!q ? (
            <div className="search-empty">{t('search.hint')}</div>
          ) : totalResults === 0 ? (
            <div className="search-empty">{t('search.empty')}</div>
          ) : (
            <>
              {matchTasks.length > 0 && (
                <>
                  <div className="search-group-label">{t('search.tasks')}</div>
                  {matchTasks.map((task) => (
                    <button key={task.id} type="button" className="search-result-row" onClick={() => openTask(task)}>
                      <span aria-hidden>{task.state === 'done' ? '✅' : '☐'}</span>
                      <span className="search-result-title">{task.title}</span>
                    </button>
                  ))}
                </>
              )}
              {matchGoals.length > 0 && (
                <>
                  <div className="search-group-label">{t('search.goals')}</div>
                  {matchGoals.map((goal) => (
                    <button key={goal.id} type="button" className="search-result-row" onClick={() => openGoal(goal)}>
                      <span aria-hidden>🎯</span>
                      <span className="search-result-title">{goal.title}</span>
                    </button>
                  ))}
                </>
              )}
              {matchSketches.length > 0 && (
                <>
                  <div className="search-group-label">{t('search.sketches')}</div>
                  {matchSketches.map((sketch) => (
                    <button key={sketch.id} type="button" className="search-result-row" onClick={() => openSketch(sketch)}>
                      <span aria-hidden>{sketch.kind === 'text' ? '⌨️' : '✏️'}</span>
                      <span className="search-result-title">{sketch.title || t('sketch.untitled')}</span>
                    </button>
                  ))}
                </>
              )}
              {matchFolders.length > 0 && (
                <>
                  <div className="search-group-label">{t('search.folders')}</div>
                  {matchFolders.map((f) => (
                    <button key={f.id} type="button" className="search-result-row" onClick={() => openFolder(f)}>
                      <span aria-hidden>📁</span>
                      <span className="search-result-title">{f.name}</span>
                    </button>
                  ))}
                </>
              )}
              {matchHabits.length > 0 && (
                <>
                  <div className="search-group-label">{t('search.habits')}</div>
                  {matchHabits.map((h) => (
                    <button key={h.id} type="button" className="search-result-row" onClick={() => openHabit(h)}>
                      <span aria-hidden>{cleanEmoji(h.emoji, h.name)}</span>
                      <span className="search-result-title">{h.name}</span>
                    </button>
                  ))}
                </>
              )}
              {matchProjects.length > 0 && (
                <>
                  <div className="search-group-label">{t('search.projects')}</div>
                  {matchProjects.map((pr) => (
                    <button key={pr.id} type="button" className="search-result-row" onClick={() => openProject(pr)}>
                      <span aria-hidden>🗂️</span>
                      <span className="search-result-title">{pr.title}</span>
                    </button>
                  ))}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
