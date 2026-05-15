import { Link } from 'react-router-dom'
import { AtlasIcon, IconButtonContent } from '../components/AtlasBrand'
import { useAtlas } from '../context/AtlasContext'
import { formatValue, totalMissing } from '../utils/formatters'

const WORKFLOW_STEPS = [
  {
    key: 'uploaded',
    title: 'Upload dataset',
    label: 'Dataset',
    route: '/dataset',
    description: 'Import a CSV or Excel file and inspect the table.',
  },
  {
    key: 'profiled',
    title: 'Profile columns',
    label: 'Profile',
    route: '/profiling',
    description: 'Review data types, missing cells, and field quality.',
  },
  {
    key: 'cleaned',
    title: 'Clean records',
    label: 'Clean',
    route: '/cleaning',
    description: 'Apply cleaning rules and compare raw vs cleaned rows.',
  },
  {
    key: 'analyzed',
    title: 'Analyze insights',
    label: 'Analyze',
    route: '/analysis',
    description: 'Generate summaries, patterns, and data quality notes.',
  },
  {
    key: 'visualized',
    title: 'Build dashboard',
    label: 'Visualize',
    route: '/visualization',
    description: 'Create KPI cards, charts, and presentation outputs.',
  },
]

function getNextStep(workflow) {
  return WORKFLOW_STEPS.find((step) => !workflow[step.key]) ?? WORKFLOW_STEPS.at(-1)
}

function getStepAvailable(step, workflow) {
  if (step.key === 'uploaded') {
    return true
  }

  const stepIndex = WORKFLOW_STEPS.findIndex((item) => item.key === step.key)
  const previousStep = WORKFLOW_STEPS[stepIndex - 1]
  return Boolean(previousStep && workflow[previousStep.key])
}

function HomePage() {
  const {
    datasetId,
    fileName,
    uploadedDataset,
    rawProfile,
    cleanedProfile,
    workflow,
  } = useAtlas()

  const completedCount = WORKFLOW_STEPS.filter((step) => workflow[step.key]).length
  const readinessScore = Math.round((completedCount / WORKFLOW_STEPS.length) * 100)
  const rows = rawProfile?.rows ?? uploadedDataset.rows.length
  const columns = rawProfile?.columns_count ?? uploadedDataset.columns.length
  const missingCells = rawProfile?.column_profiles?.length ? totalMissing(rawProfile.column_profiles) : 0
  const nextStep = getNextStep(workflow)
  const statusText = datasetId
    ? `${fileName || 'Dataset'} is active`
    : 'Import a dataset to begin'

  const metrics = [
    {
      label: 'Rows',
      value: rows ? formatValue(rows) : '-',
      hint: datasetId ? 'active dataset' : 'no file yet',
      tone: 'teal',
    },
    {
      label: 'Columns',
      value: columns ? formatValue(columns) : '-',
      hint: 'detected fields',
      tone: 'cyan',
    },
    {
      label: 'Missing Cells',
      value: datasetId ? formatValue(missingCells) : '-',
      hint: cleanedProfile ? 'after cleaning' : 'raw profile',
      tone: 'blue',
    },
    {
      label: 'Readiness Score',
      value: `${readinessScore}%`,
      hint: `${completedCount} of ${WORKFLOW_STEPS.length} steps`,
      tone: 'violet',
    },
  ]

  return (
    <div className="dashboard-page">
      <section className="dashboard-welcome-card">
        <div className="dashboard-welcome-copy">
          <h2>Workspace overview</h2>
          <p>{statusText}. Monitor preparation status, data quality, and the next required workflow action.</p>
          <div className="dashboard-welcome-actions">
            <Link to="/dataset" className="dashboard-hero-button dashboard-hero-button--dark">
              <IconButtonContent icon="upload" label={datasetId ? 'Replace Dataset' : 'Import Dataset'} showLabel />
            </Link>
            <Link
              to={nextStep.route}
              className={getStepAvailable(nextStep, workflow) ? 'dashboard-hero-button' : 'dashboard-hero-button disabled-link'}
            >
              <IconButtonContent icon={nextStep.key === 'visualized' ? 'visualize' : 'next'} label={nextStep.label} showLabel />
            </Link>
          </div>
        </div>
        <div className="dashboard-welcome-art" aria-hidden="true">
          <AtlasIcon name="database" />
        </div>
      </section>

      <section className="dashboard-section-head">
        <div>
          <h2>Workflow status</h2>
          <p>Track dataset preparation and move through each workspace in order.</p>
        </div>
      </section>

      <section className="dashboard-metric-grid" aria-label="Dataset summary">
        {metrics.map((metric) => (
          <article key={metric.label} className={`dashboard-metric-card dashboard-metric-card--${metric.tone}`}>
            <span className="dashboard-metric-art">
              <AtlasIcon name={metric.tone === 'violet' ? 'spark' : metric.tone === 'blue' ? 'clean' : 'database'} />
            </span>
            <div>
              <small>{metric.hint}</small>
              <strong>{metric.value}</strong>
              <span>{metric.label}</span>
            </div>
          </article>
        ))}
      </section>

      <section className="dashboard-lower-grid">
        <article className="dashboard-panel dashboard-recommend-panel">
          <header>
            <h2>Workflow queue</h2>
            <Link to={nextStep.route} className={getStepAvailable(nextStep, workflow) ? 'dashboard-view-button' : 'dashboard-view-button disabled-link'}>
              View
            </Link>
          </header>

          <div className="dashboard-recommend-list">
            {WORKFLOW_STEPS.map((step, index) => {
              const isDone = workflow[step.key]
              const isAvailable = getStepAvailable(step, workflow)
              const className = [
                'dashboard-task-card',
                isDone ? 'dashboard-task-card--done' : '',
                !isAvailable ? 'dashboard-task-card--locked' : '',
              ].filter(Boolean).join(' ')

              return (
                <article key={step.key} className={className}>
                  <span className="dashboard-task-icon">{String(index + 1).padStart(2, '0')}</span>
                  <div>
                    <h3>{step.title}</h3>
                    <p>{step.description}</p>
                    <div className="dashboard-task-tags">
                      <span>{isDone ? 'Done' : isAvailable ? 'Available' : 'Locked'}</span>
                      <span>{step.label}</span>
                    </div>
                  </div>
                  <Link to={step.route} className={isAvailable ? 'dashboard-task-action' : 'dashboard-task-action disabled-link'}>
                    {isDone ? 'Review' : 'Open'}
                  </Link>
                </article>
              )
            })}
          </div>
        </article>

        <aside className="dashboard-panel dashboard-completeness-panel">
          <h2>Workflow Completeness</h2>
          <div className="dashboard-score-ring" style={{ '--score': `${readinessScore}%` }}>
            <strong>{readinessScore}%</strong>
          </div>
          <div className="dashboard-check-list">
            {WORKFLOW_STEPS.map((step) => (
              <div key={`check-${step.key}`} className={workflow[step.key] ? 'is-complete' : ''}>
                <span />
                {step.label}
              </div>
            ))}
          </div>
        </aside>
      </section>
    </div>
  )
}

export default HomePage
