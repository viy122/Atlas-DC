import { Link } from 'react-router-dom'
import { AtlasLogo, IconButtonContent } from '../components/AtlasBrand'
import heroImage from '../assets/hero.png'
import { useAtlas } from '../context/AtlasContext'

const FEATURES = [
  {
    title: 'Editable Dataset Workspace',
    body: 'Import CSV or Excel files, rename the active file, edit rows, and keep the working copy ready for profiling.',
  },
  {
    title: 'Data Quality Profiling',
    body: 'Review missing values, detected data types, uniqueness, and simplified statistics before making cleaning decisions.',
  },
  {
    title: 'Configurable Cleaning',
    body: 'Choose cleaning rules, run the full pipeline, and compare original data beside the cleaned result.',
  },
  {
    title: 'Analysis and Dashboards',
    body: 'Turn cleaned records into human-readable insights and customizable chart workspaces.',
  },
]

const HOW_IT_WORKS = [
  ['Upload', 'Bring in CSV or Excel data and rename the workspace file if needed.'],
  ['Profile', 'Check structure, quality, missing values, and simple numeric summaries.'],
  ['Clean', 'Select rules, apply Clean All, then compare original and cleaned records.'],
  ['Analyze', 'Read concise summaries for categories, correlations, and cleaning impact.'],
  ['Visualize', 'Build a chart sheet with filters, custom widgets, and export-ready dashboards.'],
]

const TUTORIALS = [
  {
    title: 'First Dataset Walkthrough',
    steps: 'Upload a file, save edits, profile columns, then run Clean All with the recommended rules.',
  },
  {
    title: 'Quality Review Guide',
    steps: 'Use Profile metrics and Cleaning comparison to verify what changed before presenting results.',
  },
  {
    title: 'Dashboard Builder Guide',
    steps: 'Open Visualize, choose chart types, apply filters, add notes or KPIs, then finalize the dashboard.',
  },
]

function HomePage() {
  const { workflow, fileName } = useAtlas()

  return (
    <div className="landing-page">
      <section className="landing-hero" style={{ '--landing-hero-image': `url(${heroImage})` }}>
        <div className="landing-hero__overlay">
          <AtlasLogo />
          <p className="landing-kicker">Data Cleaning and Analytics System</p>
          <h1>ATLAS</h1>
          <p className="landing-hero__copy">
            A guided workspace for preparing messy spreadsheets, explaining data quality decisions,
            and building polished dashboard outputs from cleaned datasets.
          </p>
          <div className="landing-actions">
            <Link to="/dataset" className="primary-button">
              <IconButtonContent icon="upload" label="Start with a dataset" showLabel />
            </Link>
            <Link to="/visualization" className={workflow.uploaded ? 'ghost-button landing-ghost-button' : 'ghost-button landing-ghost-button disabled-link'}>
              <IconButtonContent icon="visualize" label="Open dashboard" showLabel />
            </Link>
          </div>
        </div>
      </section>

      <section className="landing-overview">
        <article>
          <span>System Overview</span>
          <h2>One workflow from raw file to presentation-ready output.</h2>
          <p>
            ATLAS keeps upload, profiling, cleaning, analysis, visualization, and reporting in one
            connected flow so each step uses the same active dataset context.
          </p>
        </article>
        <aside className="landing-workspace-card">
          <span>Current Workspace</span>
          <strong>{fileName || 'No dataset loaded'}</strong>
          <div>
            <em className={workflow.uploaded ? 'is-ready' : ''}>Uploaded</em>
            <em className={workflow.cleaned ? 'is-ready' : ''}>Cleaned</em>
            <em className={workflow.dashboardReady ? 'is-ready' : ''}>Dashboard</em>
          </div>
        </aside>
      </section>

      <section className="landing-section">
        <div className="landing-section__head">
          <span>Features</span>
          <h2>Built for repeatable data preparation.</h2>
        </div>
        <div className="landing-feature-grid">
          {FEATURES.map((feature) => (
            <article key={feature.title}>
              <h3>{feature.title}</h3>
              <p>{feature.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="landing-section landing-section--band">
        <div className="landing-section__head">
          <span>How It Works</span>
          <h2>Follow the workflow, then export the result.</h2>
        </div>
        <div className="landing-steps">
          {HOW_IT_WORKS.map(([title, body], index) => (
            <article key={title}>
              <em>{String(index + 1).padStart(2, '0')}</em>
              <h3>{title}</h3>
              <p>{body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="landing-section">
        <div className="landing-section__head">
          <span>Tutorials</span>
          <h2>Quick walkthroughs for onboarding.</h2>
        </div>
        <div className="landing-tutorial-grid">
          {TUTORIALS.map((tutorial) => (
            <article key={tutorial.title}>
              <h3>{tutorial.title}</h3>
              <p>{tutorial.steps}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="landing-cta">
        <div>
          <span>Ready To Begin</span>
          <h2>Load a dataset and let ATLAS guide the preparation flow.</h2>
        </div>
        <Link to="/dataset" className="primary-button">
          <IconButtonContent icon="upload" label="Import data" showLabel />
        </Link>
      </section>
    </div>
  )
}

export default HomePage
