import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useEffect } from 'react'
import Shell from './components/Shell'
import Today from './pages/Today'
import Login from './pages/Login'
import { Plan, Goals, Reviews } from './pages/Stub'
import { isAuthed } from './sync/api'
import { startSyncLoop } from './sync/engine'

function Guard({ children }: { children: React.ReactNode }) {
  const allowed = isAuthed() || localStorage.getItem('offline_mode') === '1'
  return allowed ? <>{children}</> : <Navigate to="/login" replace />
}

export default function App() {
  useEffect(() => {
    startSyncLoop()
  }, [])

  return (
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
          <Route path="/goals" element={<Goals />} />
          <Route path="/reviews" element={<Reviews />} />
        </Route>
      </Routes>
    </HashRouter>
  )
}
