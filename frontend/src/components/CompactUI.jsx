import { useEffect, useMemo, useState } from 'react'
import { AtlasIcon, IconButtonContent } from './AtlasBrand'

const TOUR_STORAGE_KEY = 'atlas:compact-tour-complete'

function DatasetPill({ name, fallback = 'No dataset', className = '' }) {
  return (
    <span className={['dataset-pill', className].filter(Boolean).join(' ')} title={name || fallback}>
      <AtlasIcon name="profile" />
      <span>{name || fallback}</span>
    </span>
  )
}

function CompactMetric({ label, value, hint, icon = 'analyze' }) {
  const displayValue = value === null || value === undefined || value === '' ? '-' : value

  return (
    <article className="compact-metric-card">
      <span className="compact-metric-card__icon">
        <AtlasIcon name={icon} />
      </span>
      <div>
        <span>{label}</span>
        <strong>{displayValue}</strong>
        {hint ? <small>{hint}</small> : null}
      </div>
    </article>
  )
}

function CompactWorkspaceBar({ title, datasetName, status, actions, children }) {
  return (
    <section className="compact-workspace-bar">
      <div className="compact-workspace-bar__title">
        <strong>{title}</strong>
        <DatasetPill name={datasetName} />
        {status ? <span className="compact-status-pill">{status}</span> : null}
      </div>
      {children ? <div className="compact-workspace-bar__middle">{children}</div> : null}
      {actions ? <div className="compact-workspace-bar__actions">{actions}</div> : null}
    </section>
  )
}

function EmptyStateMascot({ title, description, action }) {
  const [showMascot, setShowMascot] = useState(true)

  return (
    <div className="compact-empty-state">
      {showMascot ? (
        <img src="/assets/baby-atlas.png" alt="" onError={() => setShowMascot(false)} />
      ) : (
        <span className="compact-empty-state__icon">
          <AtlasIcon name="upload" />
        </span>
      )}
      <h2>{title}</h2>
      <p>{description}</p>
      {action}
    </div>
  )
}

function BabyAtlasTour({ restartToken = 0 }) {
  const steps = useMemo(
    () => [
      {
        title: 'Welcome to ATLAS',
        text: 'Move from upload to dashboard without leaving the workflow.',
        selector: '.top-nav__brand',
      },
      {
        title: 'Upload Dataset',
        text: 'Start with a CSV or Excel file, then inspect the editable table.',
        selector: '[data-tour-step="upload"]',
      },
      {
        title: 'Profile Data',
        text: 'Check types, missing values, uniqueness, and basic statistics.',
        selector: '[data-tour-step="profile"]',
      },
      {
        title: 'Clean Data',
        text: 'Choose compact cleaning rules and run the pipeline.',
        selector: '[data-tour-step="clean"]',
      },
      {
        title: 'Analyze Insights',
        text: 'Generate readable summaries from computed dataset results.',
        selector: '[data-tour-step="analyze"]',
      },
      {
        title: 'Visualize Dashboard',
        text: 'Build KPI cards, charts, and dashboard layouts.',
        selector: '[data-tour-step="visualize"]',
      },
    ],
    [],
  )
  const [isOpen, setIsOpen] = useState(() => (
    typeof window !== 'undefined' && window.localStorage.getItem(TOUR_STORAGE_KEY) !== 'true'
  ))
  const [stepIndex, setStepIndex] = useState(0)
  const [targetRect, setTargetRect] = useState(null)
  const [showMascot, setShowMascot] = useState(true)

  useEffect(() => {
    if (restartToken > 0) {
      const timer = window.setTimeout(() => {
        setStepIndex(0)
        setIsOpen(true)
      }, 0)

      return () => window.clearTimeout(timer)
    }

    return undefined
  }, [restartToken])

  useEffect(() => {
    if (!isOpen) {
      return undefined
    }

    function updateTargetRect() {
      const target = document.querySelector(steps[stepIndex]?.selector)
      if (!target) {
        setTargetRect(null)
        return
      }

      const rect = target.getBoundingClientRect()
      setTargetRect({
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
      })
    }

    updateTargetRect()
    window.addEventListener('resize', updateTargetRect)
    window.addEventListener('scroll', updateTargetRect, true)

    return () => {
      window.removeEventListener('resize', updateTargetRect)
      window.removeEventListener('scroll', updateTargetRect, true)
    }
  }, [isOpen, stepIndex, steps])

  if (!isOpen) {
    return null
  }

  const currentStep = steps[stepIndex]
  const isLastStep = stepIndex === steps.length - 1
  const tooltipStyle = targetRect
    ? {
        top: Math.min(window.innerHeight - 238, targetRect.top + targetRect.height + 12),
        left: Math.min(window.innerWidth - 340, Math.max(14, targetRect.left)),
      }
    : { top: 88, left: 16 }

  function finishTour() {
    window.localStorage.setItem(TOUR_STORAGE_KEY, 'true')
    setIsOpen(false)
  }

  return (
    <div className="baby-tour-overlay" role="dialog" aria-modal="true" aria-label="ATLAS guided tour">
      <div className="baby-tour-overlay__scrim" />
      {targetRect ? (
        <div
          className="baby-tour-overlay__highlight"
          style={{
            top: targetRect.top - 5,
            left: targetRect.left - 5,
            width: targetRect.width + 10,
            height: targetRect.height + 10,
          }}
        />
      ) : null}
      <article className="baby-tour-tooltip" style={tooltipStyle}>
        {showMascot ? (
          <img src="/assets/baby-atlas.png" alt="" onError={() => setShowMascot(false)} />
        ) : null}
        <div>
          <span>Step {stepIndex + 1} of {steps.length}</span>
          <h2>{currentStep.title}</h2>
          <p>{currentStep.text}</p>
        </div>
        <footer>
          <button type="button" className="ghost-button" onClick={finishTour}>Skip</button>
          <button
            type="button"
            className="ghost-button"
            onClick={() => setStepIndex((current) => Math.max(0, current - 1))}
            disabled={stepIndex === 0}
          >
            Back
          </button>
          <button
            type="button"
            className="primary-button"
            onClick={() => (isLastStep ? finishTour() : setStepIndex((current) => current + 1))}
          >
            <IconButtonContent icon={isLastStep ? 'save' : 'plus'} label={isLastStep ? 'Done' : 'Next'} showLabel />
          </button>
        </footer>
      </article>
    </div>
  )
}

export {
  BabyAtlasTour,
  CompactMetric,
  CompactWorkspaceBar,
  DatasetPill,
  EmptyStateMascot,
}
