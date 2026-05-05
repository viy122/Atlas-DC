import { Navigate, Route, Routes } from 'react-router-dom'
import { useState } from 'react'
import { BabyAtlasTour } from './components/CompactUI'
import TopNavigation from './components/TopNavigation'
import { AtlasProvider } from './context/AtlasContext'
import AnalysisPage from './pages/AnalysisPage'
import CleaningPage from './pages/CleaningPage'
import HomePage from './pages/HomePage'
import ProfilingPage from './pages/ProfilingPage'
import UploadPage from './pages/UploadPage'
import VisualizationPage from './pages/VisualizationPage'
import './App.css'

function App() {
  const [tourRestartToken, setTourRestartToken] = useState(0)

  return (
    <AtlasProvider>
      <div className="app-shell">
        <div className="app-content">
          <TopNavigation onStartTour={() => setTourRestartToken((current) => current + 1)} />

          <main className="app-main">
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/dataset" element={<UploadPage />} />
              <Route path="/profiling" element={<ProfilingPage />} />
              <Route path="/cleaning" element={<CleaningPage />} />
              <Route path="/analysis" element={<AnalysisPage />} />
              <Route path="/visualization" element={<VisualizationPage />} />

              <Route path="/upload" element={<Navigate to="/dataset" replace />} />
              <Route path="/insights" element={<Navigate to="/analysis" replace />} />
              <Route path="/dashboard-builder" element={<Navigate to="/visualization" replace />} />
              <Route path="/reports" element={<Navigate to="/analysis" replace />} />

              <Route path="*" element={<Navigate to="/dataset" replace />} />
            </Routes>
          </main>
          <BabyAtlasTour restartToken={tourRestartToken} />
        </div>
      </div>
    </AtlasProvider>
  )
}

export default App
