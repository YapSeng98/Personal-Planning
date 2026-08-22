import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { db, type Task, type Goal, type DrawingNote } from '../db/db'
import { useLang } from '../lib/i18n'

const RESULT_CAP = 6

interface Props {
  onClose: () => void
  onOpenTask: (task: Task) => void
}

export default function SearchModal({ onClose, onOpenTask }: Props) {
  const [query, setQuery] = useState('')
  const [tasks, setTasks] = useState<Task[]>([])
  const [goals, setGoals] = useState<Goal[]>([])
  const [sketches, setSketches] = useState<DrawingNote[]>([])
  const inputRef = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()
  const { t } = useLang()

  useEffect(() => {
    db.tasks.filter((x) => !x.deleted).toArray().then(setTasks)
    db.goals.filter((x) => !x.deleted).toArray().then(setGoals)
    db.drawings.toArray().then(setSketches)
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
    ? sketches.filter((x) => (x.title ?? '').toLowerCase().includes(q) || (x.text ?? '').toLowerCase().includes(q))
        .sort((a, b) => b.updatedAt - a.updatedAt).slice(0, RESULT_CAP)
    : []
  const totalResults = matchTasks.length + matchGoals.length + matchSketches.length

  function openTask(task: Task) {
    onClose()
    onOpenTask(task)
  }

  function openGoal(goal: Goal) {
    onClose()
    navigate(`/goals?edit=${goal.id}`)
  }

  function openSketch(sketch: DrawingNote) {
    onClose()
    navigate(`/sketches/${sketch.id}`)
  }

  function onInputKeyDown(e: React.KeyboardEvent) {
    if (e.key !== 'Enter') return
    if (matchTasks[0]) openTask(matchTasks[0])
    else if (matchGoals[0]) openGoal(matchGoals[0])
    else if (matchSketches[0]) openSketch(matchSketches[0])
  }

  return (
    <div className="search-backdrop" onClick={onClose}>
      <div className="search-modal" onClick={(e) => e.stopPropagation()}>
        <div className="search-input-row">
          <span aria-hidden>🔍</span>
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
            </>
          )}
        </div>
      </div>
    </div>
  )
}
