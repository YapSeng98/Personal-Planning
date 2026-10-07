import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useEffect } from 'react'
import Shell from './components/Shell'
import Today from './pages/Today'
import Login from './pages/Login'
import Plan from './pages/Plan'
import Board from './pages/Board'
import Goals from './pages/Goals'
import HabitDetail from './pages/HabitDetail'
import Reviews from './pages/Reviews'
import Sketches from './pages/Sketches'
import SketchDetail from './pages/SketchDetail'
import Analytics from './pages/Analytics'
import Settings from './pages/Settings'
import { isAuthed, accountDevice } from './sync/api'
import { startSyncLoop, syncNow } from './sync/engine'
import { seedIfEmpty } from './db/seed'
import { compactImages } from './lib/compact'
import { startRecurringLoop } from './db/db'
import { LangProvider } from './lib/i18n'

function Guard({ children }: { children: React.ReactNode }) {
  if (isAuthed()) return <>{children}</>
  // A device that has an account's data and lost its sign-in signs in
  // again (nothing on it is lost) — it must never fall back to the demo's
  // "local only" and silently stop syncing. Only a device that has never
  // signed in can be the offline demo.
  if (accountDevice()) return <Navigate to="/login?signedout=1" replace />
  return localStorage.getItem('offline_mode') === '1' ? <>{children}</> : <Navigate to="/login" replace />
}

export default function App() {
  useEffect(() => {
    // A demo flag left from before this device signed in is stale: it used
    // to keep a signed-out device in "local only" instead of asking to
    // sign in again.
    if (accountDevice()) localStorage.removeItem('offline_mode')
    // Demo users get seed top-ups (new demo content) at startup, not only
    // on the login button they'll never press again.
    if (localStorage.getItem('offline_mode') === '1') seedIfEmpty()
    startRecurringLoop()
    startSyncLoop()
    // Shrink oversized old images so they stop blocking the sync; push the
    // smaller copies right away if anything changed.
    compactImages().then((n) => { if (n) syncNow() }).catch(() => {})
  }, [])

  return (
    <LangProvider>
    <HashRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          element={
            <Guard>
              <Shell />
            </Guard>
          }
        >
          <Route path="/" element={<Today />} />
          <Route path="/plan" element={<Plan />} />
          <Route path="/board" element={<Board />} />
          <Route path="/goals" element={<Goals />} />
          <Route path="/habits/:id" element={<HabitDetail />} />
          <Route path="/reviews" element={<Reviews />} />
          <Route path="/sketches" element={<Sketches />} />
          <Route path="/sketches/folder/:folderId" element={<Sketches />} />
          <Route path="/sketches/:id" element={<SketchDetail />} />
          <Route path="/analytics" element={<Analytics />} />
          <Route path="/settings" element={<Settings />} />
        </Route>
      </Routes>
    </HashRouter>
    </LangProvider>
  )
}
