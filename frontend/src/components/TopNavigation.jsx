import { NavLink, useLocation } from 'react-router-dom'
import { AtlasLogo } from './AtlasBrand'
import { DatasetPill } from './CompactUI'
import { useAtlas } from '../context/AtlasContext'

const LINKS = [
  { to: '/dataset', label: 'Upload' },
  { to: '/profiling', label: 'Profile' },
  { to: '/cleaning', label: 'Clean' },
  { to: '/analysis', label: 'Analyze' },
  { to: '/visualization', label: 'Visualize' },
]

function TopNavigation({ onStartTour }) {
  const { fileName } = useAtlas()
  const location = useLocation()
  const isWelcomePage = location.pathname === '/'
  const activeIndex = LINKS.findIndex((link) => link.to === location.pathname)

  return (
    <header className="top-nav">
      <div className="top-nav__inner">
        <NavLink to="/" className="top-nav__brand">
          <AtlasLogo compact />
          <span className="top-nav__brand-name">ATLAS</span>
        </NavLink>

        {!isWelcomePage ? (
          <nav className="top-nav__links" aria-label="Workflow">
            {LINKS.map((link, index) => (
              <NavLink
                key={link.to}
                to={link.to}
                data-tour-step={link.label.toLowerCase()}
                className={({ isActive }) =>
                  isActive ? 'top-nav__link top-nav__link--active' : 'top-nav__link'
                }
              >
                <span className="top-nav__step-dot">{index + 1}</span>
                {link.label}
              </NavLink>
            ))}
          </nav>
        ) : (
          <div className="top-nav__welcome">Enterprise Data Workbench</div>
        )}

        <div className="top-nav__right">
          {!isWelcomePage && activeIndex >= 0 ? (
            <span className="top-nav__progress">{activeIndex + 1}/{LINKS.length}</span>
          ) : null}
          <button type="button" className="top-nav__tour-button" onClick={onStartTour}>
            Take a Tour
          </button>
          <DatasetPill name={fileName} className="top-nav__dataset" />
        </div>
      </div>
    </header>
  )
}

export default TopNavigation
