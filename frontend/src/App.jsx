import { Navigate, Route, Routes, useNavigate } from 'react-router-dom'
import { useState } from 'react'
import { BabyAtlasTour } from './components/CompactUI'
import Sidebar from './components/Sidebar'
import TopNavigation from './components/TopNavigation'
import { AtlasProvider, useAtlas } from './context/AtlasContext'
import AnalysisPage from './pages/AnalysisPage'
import CleaningPage from './pages/CleaningPage'
import HomePage from './pages/HomePage'
import ProfilingPage from './pages/ProfilingPage'
import UploadPage from './pages/UploadPage'
import VisualizationPage from './pages/VisualizationPage'
import './App.css'

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
  const navigate = useNavigate()
  const [tourRestartToken, setTourRestartToken] = useState(0)
  const [tourMode, setTourMode] = useState('standard')
  const [isPreparingTour, setIsPreparingTour] = useState(false)

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

  return (
    <div className="app-shell">
      <Sidebar />
      <div className="app-content">
        <TopNavigation onStartTour={startDemoTour} isPreparingTour={isPreparingTour} />

        <main className="app-main" data-tour="main-workspace">
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/dataset" element={<UploadPage />} />
            <Route path="/profiling" element={<ProtectedPage requirement="uploaded"><ProfilingPage /></ProtectedPage>} />
            <Route path="/cleaning" element={<ProtectedPage requirement="profiled"><CleaningPage /></ProtectedPage>} />
            <Route path="/analysis" element={<ProtectedPage requirement="cleaned"><AnalysisPage /></ProtectedPage>} />
            <Route path="/visualization" element={<ProtectedPage requirement="analyzed"><VisualizationPage /></ProtectedPage>} />

            <Route path="/upload" element={<Navigate to="/dataset" replace />} />
            <Route path="/insights" element={<Navigate to="/analysis" replace />} />
            <Route path="/dashboard-builder" element={<Navigate to="/visualization" replace />} />
            <Route path="/reports" element={<Navigate to="/analysis" replace />} />

            <Route path="*" element={<Navigate to="/dataset" replace />} />
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
