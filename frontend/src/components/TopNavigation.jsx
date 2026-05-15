import { useLocation } from 'react-router-dom'
import { AtlasIcon } from './AtlasBrand'
import { DatasetPill } from './CompactUI'
import { useAtlas } from '../context/AtlasContext'

const ROUTE_TITLES = {
  '/': 'Dashboard',
  '/dataset': 'Upload',
  '/profiling': 'Profile',
  '/cleaning': 'Clean',
  '/analysis': 'Analyze',
  '/visualization': 'Visualize',
}

const WORKFLOW_ROUTES = ['/dataset', '/profiling', '/cleaning', '/analysis', '/visualization']

function TopNavigation({ onStartTour, isPreparingTour = false }) {
  const { fileName } = useAtlas()
  const location = useLocation()
  const title = ROUTE_TITLES[location.pathname] ?? 'Dashboard'
  const activeIndex = WORKFLOW_ROUTES.findIndex((route) => route === location.pathname)

  return (
    <header className="top-nav">
      <div className="top-nav__inner">
        <div className="top-nav__title-group">
          <p className="top-nav__eyebrow">ATLAS Workspace</p>
          <h1>{title}</h1>
        </div>

        <div className="top-nav__right">
          <label className="top-nav__search">
            <AtlasIcon name="search" />
            <span className="sr-only">Search workspace</span>
            <input type="search" placeholder="Search..." aria-label="Search workspace" />
          </label>

          {activeIndex >= 0 ? (
            <span className="top-nav__progress">{activeIndex + 1}/{WORKFLOW_ROUTES.length}</span>
          ) : null}

          <button
            type="button"
            className={isPreparingTour ? 'top-nav__icon-button top-nav__icon-button--busy' : 'top-nav__icon-button'}
            data-tour="take-tour"
            onClick={onStartTour}
            disabled={isPreparingTour}
            title={isPreparingTour ? 'Preparing sample tour' : 'Take a tour'}
            aria-label={isPreparingTour ? 'Preparing sample tour' : 'Take a tour'}
          >
            <AtlasIcon name="help" />
          </button>

          <span className="top-nav__icon-button" aria-hidden="true">
            <AtlasIcon name="bell" />
          </span>

          <DatasetPill name={fileName} className="top-nav__dataset" />

          <span className="top-nav__avatar" aria-label="ATLAS profile">A</span>
        </div>
      </div>
    </header>
  )
}

export default TopNavigation
