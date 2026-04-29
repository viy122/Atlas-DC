import { Navigate, Route, Routes } from 'react-router-dom'
import Sidebar from './components/Sidebar'
import TopNavigation from './components/TopNavigation'
import { AtlasProvider } from './context/AtlasContext'
import AnalysisPage from './pages/AnalysisPage'
import DashboardPage from './pages/DashboardPage'
import ReportsPage from './pages/ReportsPage'
import UploadPage from './pages/UploadPage'
import './App.css'

function App() {
  return (
    <AtlasProvider>
      <div className="app-shell">
        <Sidebar />

        <div className="app-content">
          <TopNavigation />

          <main className="app-main">
            <Routes>
              <Route path="/" element={<Navigate to="/dataset" replace />} />
              <Route path="/dataset" element={<UploadPage />} />
              <Route path="/dashboard-builder" element={<DashboardPage />} />
              <Route path="/insights" element={<AnalysisPage />} />
              <Route path="/reports" element={<ReportsPage />} />

              <Route path="/upload" element={<Navigate to="/dataset" replace />} />
              <Route path="/profiling" element={<Navigate to="/dataset" replace />} />
              <Route path="/cleaning" element={<Navigate to="/dataset" replace />} />
              <Route path="/analysis" element={<Navigate to="/insights" replace />} />
              <Route path="/visualization" element={<Navigate to="/dashboard-builder" replace />} />

              <Route path="*" element={<Navigate to="/dataset" replace />} />
            </Routes>
          </main>
        </div>
      </div>
    </AtlasProvider>
  )
}

export default App
