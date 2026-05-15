import { useState } from 'react'
import { AtlasIcon, AtlasLogo, IconButtonContent } from '../components/AtlasBrand'

const LANDING_FEATURES = [
  {
    title: 'Guided workflow from upload to dashboard',
    text: 'ATLAS keeps the next step locked until the current one is ready, so the workflow stays clean and defensible.',
    icon: 'next',
  },
  {
    title: 'Profile issues before cleaning',
    text: 'See missing cells, data types, uniqueness, and risk signals before applying any transformation.',
    icon: 'profile',
  },
  {
    title: 'Build outputs from cleaned data',
    text: 'Generate charts, KPI cards, comparisons, and dashboard-ready views from the same prepared dataset.',
    icon: 'visualize',
  },
]

const MINI_STEPS = ['Upload', 'Profile', 'Clean', 'Analyze', 'Visualize']
const PROOF_POINTS = [
  ['5-step', 'workflow'],
  ['CSV/XLSX', 'ingestion'],
  ['Dashboards', 'outputs'],
]

function LandingPage({ isLoggedIn, userName, onLogin, onLogout, onOpenApp }) {
  const [isLoginOpen, setIsLoginOpen] = useState(false)
  const [name, setName] = useState(userName || '')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [keepSignedIn, setKeepSignedIn] = useState(true)

  function handleSubmit(event) {
    event.preventDefault()
    onLogin({
      name: name.trim() || 'ATLAS User',
      email: email.trim(),
    })
    setPassword('')
    setIsLoginOpen(false)
  }

  function handleDemoLogin() {
    setName('ATLAS Analyst')
    setEmail('analyst@atlas.local')
    setPassword('')
    onLogin({
      name: 'ATLAS Analyst',
      email: 'analyst@atlas.local',
    })
    setIsLoginOpen(false)
  }

  return (
    <main className="landing-shell">
      <nav className="landing-nav" aria-label="Landing navigation">
        <button type="button" className="landing-brand-button" onClick={onOpenApp} aria-label="Open ATLAS">
          <AtlasLogo compact />
          <span>ATLAS</span>
        </button>

        <div className="landing-nav__links">
          <a href="#features">Features</a>
          <a href="#workflow">Workflow</a>
          <a href="#preview">Preview</a>
        </div>

        <div className="landing-nav__actions">
          {isLoggedIn ? (
            <>
              <button type="button" className="landing-login-chip" onClick={onOpenApp}>
                <span>{getInitials(userName)}</span>
                {userName || 'Dashboard'}
              </button>
              <button type="button" className="landing-nav-button" onClick={onLogout}>
                <IconButtonContent icon="logout" label="Logout" showLabel />
              </button>
            </>
          ) : (
            <button type="button" className="landing-nav-button" onClick={() => setIsLoginOpen(true)}>
              <IconButtonContent icon="login" label="Login" showLabel />
            </button>
          )}
        </div>
      </nav>

      <section className="landing-hero-page">
        <div className="landing-hero-copy">
          <span className="landing-status-pill">Data Cleaning and Analytics Workspace</span>
          <h1>Prepare clean, trusted analytics dashboards.</h1>
          <p>
            ATLAS helps teams profile, clean, analyze, and visualize spreadsheet data in a structured
            workflow built for reliable reporting.
          </p>

          <div className="landing-hero-actions">
            {isLoggedIn ? (
              <button type="button" className="landing-primary-button" onClick={onOpenApp}>
                <IconButtonContent icon="home" label="Open Dashboard" showLabel />
              </button>
            ) : (
              <button type="button" className="landing-primary-button" onClick={() => setIsLoginOpen(true)}>
                <IconButtonContent icon="login" label="Start Now" showLabel />
              </button>
            )}
            <a href="#preview" className="landing-secondary-button">
              <IconButtonContent icon="visualize" label="View Preview" showLabel />
            </a>
          </div>

          <div className="landing-proof-strip" aria-label="ATLAS highlights">
            {PROOF_POINTS.map(([value, label]) => (
              <div key={value}>
                <strong>{value}</strong>
                <span>{label}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="landing-preview-stage" id="preview" aria-label="ATLAS dashboard preview">
          <div className="landing-preview-window">
            <div className="landing-preview-window__bar">
              <span />
              <span />
              <span />
              <strong>sample_sales_dataset.csv</strong>
            </div>
            <div className="landing-preview-banner">
              <div>
                <small>Workflow readiness</small>
                <strong>80%</strong>
              </div>
              <AtlasIcon name="database" />
            </div>
            <div className="landing-preview-grid">
              <article>
                <span>Rows</span>
                <strong>1,200</strong>
              </article>
              <article>
                <span>Missing</span>
                <strong>84</strong>
              </article>
              <article>
                <span>Charts</span>
                <strong>6</strong>
              </article>
            </div>
            <div className="landing-preview-bars" aria-hidden="true">
              <span style={{ '--bar-height': '38%' }} />
              <span style={{ '--bar-height': '68%' }} />
              <span style={{ '--bar-height': '51%' }} />
              <span style={{ '--bar-height': '86%' }} />
              <span style={{ '--bar-height': '74%' }} />
            </div>
            <div className="landing-preview-pipeline">
              {MINI_STEPS.map((step, index) => (
                <span key={`hero-${step}`}>
                  <em>{index + 1}</em>
                  {step}
                </span>
              ))}
            </div>
          </div>

        </div>
      </section>

      <section className="landing-feature-section" id="features">
        <div className="landing-section-heading">
          <span>Features</span>
          <h2>Designed around the actual work of cleaning data.</h2>
        </div>
        <div className="landing-feature-cards landing-feature-cards--bento">
          <article className="landing-feature-card-large">
            <span>
              <AtlasIcon name="database" />
            </span>
            <h3>See the whole dataset journey in one place.</h3>
            <p>
              The dashboard keeps dataset progress, quality state, and next actions visible so users
              always know what to do next.
            </p>
            <div className="landing-mini-dashboard">
              <div>
                <small>Rows</small>
                <strong>1,200</strong>
              </div>
              <div>
                <small>Missing</small>
                <strong>84</strong>
              </div>
              <div>
                <small>Ready</small>
                <strong>80%</strong>
              </div>
            </div>
          </article>
          {LANDING_FEATURES.map((feature) => (
            <article key={feature.title}>
              <span>
                <AtlasIcon name={feature.icon} />
              </span>
              <h3>{feature.title}</h3>
              <p>{feature.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="landing-workflow-band" id="workflow">
        <div>
          <span>Workflow</span>
          <h2>One clear path from raw file to dashboard.</h2>
        </div>
        <div className="landing-workflow-track">
          {MINI_STEPS.map((step, index) => (
            <div key={step}>
              <em>{index + 1}</em>
              <strong>{step}</strong>
            </div>
          ))}
        </div>
      </section>

      <section className="landing-final-cta">
        <div>
          <span>Workspace Ready</span>
          <h2>Sign in and continue from upload to dashboard in one guided flow.</h2>
        </div>
        {isLoggedIn ? (
          <button type="button" className="landing-primary-button" onClick={onOpenApp}>
            <IconButtonContent icon="home" label="Go to Dashboard" showLabel />
          </button>
        ) : (
          <button type="button" className="landing-primary-button" onClick={() => setIsLoginOpen(true)}>
            <IconButtonContent icon="login" label="Login to Continue" showLabel />
          </button>
        )}
      </section>

      {isLoginOpen ? (
        <div className="landing-login-modal" role="dialog" aria-modal="true" aria-label="Login to ATLAS">
          <button type="button" className="landing-login-backdrop" onClick={() => setIsLoginOpen(false)} aria-label="Close login" />
          <section className="landing-login-card">
            <button type="button" className="landing-login-close" onClick={() => setIsLoginOpen(false)} aria-label="Close login">
              <AtlasIcon name="close" />
            </button>

            <form className="landing-login-form-panel" onSubmit={handleSubmit}>
              <div className="landing-login-logo-row">
                <AtlasLogo compact />
                <strong>ATLAS</strong>
                <span>Analytics Workspace</span>
              </div>

              <div className="landing-login-heading">
                <span>Workspace Sign In</span>
                <h2>Sign in to your analytics workspace.</h2>
                <p>Access data preparation, quality checks, analysis, and dashboard outputs from one structured workspace.</p>
              </div>

              <div className="landing-login-field-grid">
                <label className="landing-login-field">
                  <span>Display name</span>
                  <div className="landing-login-input-shell">
                    <AtlasIcon name="profile" />
                    <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Your name" autoFocus />
                  </div>
                </label>

                <label className="landing-login-field">
                  <span>Email address</span>
                  <div className="landing-login-input-shell">
                    <AtlasIcon name="profile" />
                    <input
                      type="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      placeholder="you@example.com"
                      autoComplete="email"
                    />
                  </div>
                </label>

                <label className="landing-login-field">
                  <span>Password</span>
                  <div className="landing-login-input-shell">
                    <AtlasIcon name="login" />
                    <input
                      type="password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      placeholder="Enter your password"
                      autoComplete="current-password"
                    />
                  </div>
                </label>
              </div>

              <div className="landing-login-options">
                <label className="landing-login-checkbox">
                  <input
                    type="checkbox"
                    checked={keepSignedIn}
                    onChange={(event) => setKeepSignedIn(event.target.checked)}
                  />
                  <span>Keep me signed in</span>
                </label>
                <span className="landing-login-muted">Remember workspace</span>
              </div>

              <div className="landing-login-actions">
                <button type="submit" className="landing-login-submit">
                  <IconButtonContent icon="login" label="Sign In" showLabel />
                </button>
                <button type="button" className="landing-login-demo-button" onClick={handleDemoLogin}>
                  Continue to Workspace
                </button>
              </div>
            </form>

            <aside className="landing-login-data-panel" aria-label="ATLAS workspace preview">
              <div className="landing-login-data-top">
                <span>Workspace Overview</span>
                <strong>sample_sales_dataset.csv</strong>
              </div>

              <div className="landing-login-scan-card">
                <div>
                  <span>Readiness</span>
                  <strong>80%</strong>
                </div>
                <AtlasIcon name="spark" />
              </div>

              <div className="landing-login-metric-row">
                <div>
                  <span>Rows</span>
                  <strong>1,200</strong>
                </div>
                <div>
                  <span>Missing</span>
                  <strong>84</strong>
                </div>
                <div>
                  <span>Charts</span>
                  <strong>6</strong>
                </div>
              </div>

              <div className="landing-login-table-preview" aria-hidden="true">
                <div>
                  <span>category</span>
                  <span>sales</span>
                  <span>status</span>
                </div>
                <div>
                  <span>Retail</span>
                  <span>42,120</span>
                  <span>Clean</span>
                </div>
                <div>
                  <span>Online</span>
                  <span>38,940</span>
                  <span>Review</span>
                </div>
                <div>
                  <span>Wholesale</span>
                  <span>28,300</span>
                  <span>Clean</span>
                </div>
              </div>

              <div className="landing-login-mini-steps">
                {MINI_STEPS.map((step, index) => (
                  <span key={`login-${step}`} className={index < 3 ? 'is-ready' : ''}>
                    <em>{index + 1}</em>
                    {step}
                  </span>
                ))}
              </div>
            </aside>
          </section>
        </div>
      ) : null}
    </main>
  )
}

function getInitials(name = '') {
  const parts = String(name || 'A').trim().split(/\s+/).filter(Boolean)
  return parts.slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'A'
}

export default LandingPage
