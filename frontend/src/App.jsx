import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { useState } from 'react'
import { BabyAtlasTour } from './components/CompactUI'
import Sidebar from './components/Sidebar'
import TopNavigation from './components/TopNavigation'
import { AtlasProvider, useAtlas } from './context/AtlasContext'
import AnalysisPage from './pages/AnalysisPage'
import CleaningPage from './pages/CleaningPage'
import HomePage from './pages/HomePage'
import LandingPage from './pages/LandingPage'
import ProfilingPage from './pages/ProfilingPage'
import UploadPage from './pages/UploadPage'
import VisualizationPage from './pages/VisualizationPage'
import './App.css'

const AUTH_STORAGE_KEY = 'atlas:local-session'

function getStoredSession() {
  if (typeof window === 'undefined') {
    return null
  }

  const rawSession = window.localStorage.getItem(AUTH_STORAGE_KEY)
  if (!rawSession) {
    return null
  }

  try {
    return JSON.parse(rawSession)
  } catch {
    window.localStorage.removeItem(AUTH_STORAGE_KEY)
    return null
  }
}

function storeSession(session) {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session))
}

function clearSession() {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.removeItem(AUTH_STORAGE_KEY)
}

function getWorkflowFallbackPath(workflow) {
  if (workflow.analyzed) {
    return '/visualization'
  }

  if (workflow.cleaned) {
    return '/analysis'
  }

  if (workflow.profiled) {
    return '/cleaning'
  }

  if (workflow.uploaded) {
    return '/profiling'
  }

  return '/dataset'
}

function ProtectedPage({ requirement, children }) {
  const { workflow } = useAtlas()

  if (!workflow[requirement]) {
    return <Navigate to={getWorkflowFallbackPath(workflow)} replace />
  }

  return children
}

function AppWorkspace() {
  const { resetWorkspace, runAutoClean, uploadDataset } = useAtlas()
  const location = useLocation()
  const navigate = useNavigate()
  const [session, setSession] = useState(() => getStoredSession())
  const [tourRestartToken, setTourRestartToken] = useState(0)
  const [tourMode, setTourMode] = useState('standard')
  const [isPreparingTour, setIsPreparingTour] = useState(false)
  const isLoggedIn = Boolean(session)

  async function loadSampleTourDataset() {
    const response = await fetch('/sample_sales_dataset.csv')
    if (!response.ok) {
      throw new Error('Sample dataset is unavailable.')
    }

    const blob = await response.blob()
    return new File([blob], 'sample_sales_dataset.csv', {
      type: blob.type || 'text/csv',
    })
  }

  async function startDemoTour() {
    if (isPreparingTour) {
      return
    }

    setIsPreparingTour(true)
    setTourMode('demo')

    try {
      resetWorkspace()
      const sampleFile = await loadSampleTourDataset()
      const sampleDatasetId = await uploadDataset(sampleFile)

      if (!sampleDatasetId) {
        setTourMode('standard')
        navigate('/dataset')
        return
      }

      await runAutoClean({}, sampleDatasetId)
      setTourRestartToken((current) => current + 1)
    } catch {
      setTourMode('standard')
      navigate('/dataset')
    } finally {
      setIsPreparingTour(false)
    }
  }

  function finishDemoTour() {
    if (tourMode === 'demo') {
      resetWorkspace()
      navigate('/dataset')
      setTourMode('standard')
    }
  }

  function handleLogin(nextSession) {
    const normalizedSession = {
      name: nextSession.name || 'ATLAS User',
      email: nextSession.email || '',
      loggedInAt: new Date().toISOString(),
    }

    storeSession(normalizedSession)
    setSession(normalizedSession)
    navigate('/dashboard')
  }

  function handleLogout() {
    clearSession()
    setSession(null)
    resetWorkspace()
    navigate('/')
  }

  if (location.pathname === '/') {
    return (
      <LandingPage
        isLoggedIn={isLoggedIn}
        userName={session?.name ?? ''}
        onLogin={handleLogin}
        onLogout={handleLogout}
        onOpenApp={() => navigate(isLoggedIn ? '/dashboard' : '/')}
      />
    )
  }

  if (!isLoggedIn) {
    return <Navigate to="/" replace />
  }

  return (
    <div className="app-shell">
      <Sidebar userName={session?.name ?? 'ATLAS User'} />
      <div className="app-content">
        <TopNavigation
          onLogout={handleLogout}
          onStartTour={startDemoTour}
          isPreparingTour={isPreparingTour}
          userName={session?.name ?? 'ATLAS User'}
        />

        <main className="app-main" data-tour="main-workspace">
          <Routes>
            <Route path="/dashboard" element={<HomePage />} />
            <Route path="/dataset" element={<UploadPage />} />
            <Route path="/profiling" element={<ProtectedPage requirement="uploaded"><ProfilingPage /></ProtectedPage>} />
            <Route path="/cleaning" element={<ProtectedPage requirement="profiled"><CleaningPage /></ProtectedPage>} />
            <Route path="/analysis" element={<ProtectedPage requirement="cleaned"><AnalysisPage /></ProtectedPage>} />
            <Route path="/visualization" element={<ProtectedPage requirement="analyzed"><VisualizationPage /></ProtectedPage>} />

            <Route path="/upload" element={<Navigate to="/dataset" replace />} />
            <Route path="/home" element={<Navigate to="/dashboard" replace />} />
            <Route path="/insights" element={<Navigate to="/analysis" replace />} />
            <Route path="/dashboard-builder" element={<Navigate to="/visualization" replace />} />
            <Route path="/reports" element={<Navigate to="/analysis" replace />} />

            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </main>
        <BabyAtlasTour restartToken={tourRestartToken} mode={tourMode} onClose={finishDemoTour} />
      </div>
    </div>
  )
}

function App() {
  return (
    <AtlasProvider>
      <AppWorkspace />
    </AtlasProvider>
  )
}

export default App
