import { useLocation } from 'react-router-dom'
import { useAtlas } from '../context/AtlasContext'

const ROUTE_TITLES = {
  '/dataset': 'Dataset',
  '/dashboard-builder': 'Dashboard Builder',
  '/insights': 'Insights',
  '/reports': 'Reports',
}

function TopNavigation() {
  const location = useLocation()
  const { fileName } = useAtlas()
  const title = ROUTE_TITLES[location.pathname] ?? 'ATLAS Workspace'

  return (
    <header className="top-nav">
      <div className="top-nav__inner">
        <div className="top-nav__title-block">
          <p className="top-nav__eyebrow">Workspace</p>
          <h1>{title}</h1>
        </div>

        <div className="top-nav__actions">
          <div className="top-nav__search">
            <input
              type="text"
              placeholder={fileName ? `Search in ${fileName}` : 'Search workspace'}
              aria-label="Search"
            />
          </div>

          <button type="button" className="top-nav__icon-button" aria-label="Notifications">
            <span className="top-nav__notification-dot" />
            <span aria-hidden="true">N</span>
          </button>

          <div className="top-nav__avatar" aria-label="User profile">
            JD
          </div>
        </div>
      </div>
    </header>
  )
}

export default TopNavigation
