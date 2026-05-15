import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { AtlasIcon, IconButtonContent } from './AtlasBrand'

const TOUR_STORAGE_KEY = 'atlas:compact-tour-complete'
const TOUR_TARGET_PADDING = 8
const TOUR_RENDER_DELAY = 140

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

function EmptyStateMascot({ title, description, action, tourId }) {
  return (
    <div className="compact-empty-state" data-tour={tourId}>
      <span className="compact-empty-state__icon">
        <AtlasIcon name="upload" />
      </span>
      <h2>{title}</h2>
      <p>{description}</p>
      {action}
    </div>
  )
}

function BabyAtlasTour({ restartToken = 0, mode = 'standard', onClose }) {
  const location = useLocation()
  const navigate = useNavigate()
  const isDemoMode = mode === 'demo'
  const steps = useMemo(
    () => [
      {
        title: 'Welcome to ATLAS',
        text: 'ATLAS guides you from raw spreadsheet upload to cleaned analytics and dashboard outputs.',
        path: '/dataset',
        selector: '[data-tour="workflow-nav"], [data-tour="main-workspace"]',
      },
      {
        title: 'Upload Dataset',
        text: 'Start by importing a CSV or Excel file. Your dataset will appear in the table preview.',
        path: '/dataset',
        selector: '[data-tour="import-dataset"]',
      },
      {
        title: 'Dataset Table',
        text: 'Review your raw data here. You can inspect rows, columns, data types, and missing values.',
        path: '/dataset',
        selector: '[data-tour="dataset-table"]',
      },
      {
        title: 'Profile Data',
        text: 'Profile checks data types, missing values, uniqueness, and basic statistics.',
        path: '/profiling',
        selector: '[data-tour="column-diagnostics"]',
      },
      {
        title: 'Clean Data',
        text: 'Select cleaning rules to handle missing values, duplicates, invalid formats, and data type issues.',
        path: '/cleaning',
        selector: '[data-tour="cleaning-rules"]',
      },
      {
        title: 'Run Cleaning Pipeline',
        text: 'Run the cleaning pipeline to generate a cleaned version of your dataset.',
        path: '/cleaning',
        selector: '[data-tour="run-cleaning"]',
      },
      {
        title: 'Analyze Insights',
        text: 'Generate readable insights, trends, data quality notes, and recommendations.',
        path: '/analysis',
        selector: '[data-tour="generate-ai-insights"], [data-tour="ai-insights"]',
      },
      {
        title: 'Visualize Dashboard',
        text: 'Build KPI cards, charts, and dashboard outputs using the cleaned dataset.',
        path: '/visualization',
        selector: '[data-tour="dashboard-canvas"]',
      },
      {
        title: 'Add Chart or KPI',
        text: 'Add charts and KPI cards to customize your dashboard.',
        path: '/visualization',
        selector: '[data-tour="add-chart"], [data-tour="add-kpi"]',
      },
      {
        title: isDemoMode ? 'Try it yourself' : 'Finish',
        text: isDemoMode
          ? 'This tour used the sample dataset so you could see the full flow. Click Try It Yourself to clear the demo and import your own file.'
          : "You're ready to use ATLAS. You can restart this tour anytime from Take a Tour.",
        path: '/visualization',
        selector: '[data-tour="dashboard-canvas"], [data-tour="workflow-nav"]',
      },
    ],
    [isDemoMode],
  )
  const [isOpen, setIsOpen] = useState(false)
  const [stepIndex, setStepIndex] = useState(0)
  const [targetRect, setTargetRect] = useState(null)
  const [showMascot, setShowMascot] = useState(true)
  const activeTargetRef = useRef(null)
  const currentStep = steps[stepIndex]
  const isLastStep = stepIndex === steps.length - 1

  const clearActiveTarget = useCallback(() => {
    activeTargetRef.current?.removeAttribute('data-atlas-tour-active')
    activeTargetRef.current = null
  }, [])

  const findTarget = useCallback(() => {
    if (!currentStep?.selector || typeof document === 'undefined') {
      return null
    }

    const targets = [...document.querySelectorAll(currentStep.selector)]
    return targets.find((target) => {
      const rect = target.getBoundingClientRect()
      const style = window.getComputedStyle(target)

      return (
        rect.width > 0
        && rect.height > 0
        && style.visibility !== 'hidden'
        && style.display !== 'none'
      )
    }) ?? null
  }, [currentStep])

  const updateTargetRect = useCallback(() => {
    const target = findTarget()

    if (!target) {
      clearActiveTarget()
      setTargetRect(null)
      return
    }

    if (activeTargetRef.current !== target) {
      clearActiveTarget()
      target.setAttribute('data-atlas-tour-active', 'true')
      activeTargetRef.current = target
    }

    const rect = target.getBoundingClientRect()
    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight
    const left = Math.max(6, rect.left - TOUR_TARGET_PADDING)
    const top = Math.max(6, rect.top - TOUR_TARGET_PADDING)
    const right = Math.min(viewportWidth - 6, rect.right + TOUR_TARGET_PADDING)
    const bottom = Math.min(viewportHeight - 6, rect.bottom + TOUR_TARGET_PADDING)

    setTargetRect({
      top,
      left,
      width: Math.max(0, right - left),
      height: Math.max(0, bottom - top),
    })
  }, [clearActiveTarget, findTarget])

  useEffect(() => {
    if (restartToken > 0) {
      const timer = window.setTimeout(() => {
        clearActiveTarget()
        setTargetRect(null)
        setStepIndex(0)
        setIsOpen(true)
      }, 0)

      return () => window.clearTimeout(timer)
    }

    return undefined
  }, [clearActiveTarget, restartToken])

  useEffect(() => {
    if (!isOpen) {
      clearActiveTarget()
      return undefined
    }

    const targetPath = currentStep?.path
    if (targetPath && location.pathname !== targetPath) {
      clearActiveTarget()
      const timer = window.setTimeout(() => setTargetRect(null), 0)
      navigate(targetPath)
      return () => window.clearTimeout(timer)
    }

    const timers = []
    timers.push(window.setTimeout(() => {
      const target = findTarget()

      if (target) {
        target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' })
      }

      timers.push(window.setTimeout(updateTargetRect, TOUR_RENDER_DELAY))
    }, TOUR_RENDER_DELAY))

    return () => {
      timers.forEach((timer) => window.clearTimeout(timer))
    }
  }, [
    clearActiveTarget,
    currentStep,
    findTarget,
    isOpen,
    location.pathname,
    navigate,
    updateTargetRect,
  ])

  useEffect(() => {
    if (!isOpen) {
      return undefined
    }

    window.addEventListener('resize', updateTargetRect)
    window.addEventListener('scroll', updateTargetRect, true)

    return () => {
      window.removeEventListener('resize', updateTargetRect)
      window.removeEventListener('scroll', updateTargetRect, true)
    }
  }, [isOpen, updateTargetRect])

  useEffect(() => () => clearActiveTarget(), [clearActiveTarget])

  if (!isOpen) {
    return null
  }

  const tooltipStyle = getTooltipStyle(targetRect)

  function closeTour({ completed = false } = {}) {
    if (completed) {
      window.localStorage.setItem(TOUR_STORAGE_KEY, 'true')
    }

    clearActiveTarget()
    setTargetRect(null)
    setIsOpen(false)
    onClose?.({ completed, mode })
  }

  function goToStep(nextIndex) {
    clearActiveTarget()
    setTargetRect(null)
    setStepIndex(Math.min(Math.max(nextIndex, 0), steps.length - 1))
  }

  return (
    <div className="baby-tour-overlay" role="dialog" aria-modal="true" aria-label="ATLAS guided tour">
      {targetRect ? (
        <>
          <div className="baby-tour-overlay__scrim baby-tour-overlay__scrim--top" style={{ height: targetRect.top }} />
          <div
            className="baby-tour-overlay__scrim baby-tour-overlay__scrim--bottom"
            style={{ top: targetRect.top + targetRect.height }}
          />
          <div
            className="baby-tour-overlay__scrim baby-tour-overlay__scrim--left"
            style={{
              top: targetRect.top,
              width: targetRect.left,
              height: targetRect.height,
            }}
          />
          <div
            className="baby-tour-overlay__scrim baby-tour-overlay__scrim--right"
            style={{
              top: targetRect.top,
              left: targetRect.left + targetRect.width,
              height: targetRect.height,
            }}
          />
        </>
      ) : (
        <div className="baby-tour-overlay__scrim baby-tour-overlay__scrim--full" />
      )}
      {targetRect ? (
        <div
          className="baby-tour-overlay__highlight"
          style={{
            top: targetRect.top,
            left: targetRect.left,
            width: targetRect.width,
            height: targetRect.height,
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
          <button type="button" className="ghost-button" onClick={() => closeTour()}>Skip</button>
          <button
            type="button"
            className="ghost-button"
            onClick={() => goToStep(stepIndex - 1)}
            disabled={stepIndex === 0}
          >
            Back
          </button>
          <button
            type="button"
            className="primary-button"
            onClick={() => (isLastStep ? closeTour({ completed: true }) : goToStep(stepIndex + 1))}
          >
            <IconButtonContent
              icon={isLastStep && isDemoMode ? 'upload' : isLastStep ? 'save' : 'next'}
              label={isLastStep && isDemoMode ? 'Try It Yourself' : isLastStep ? 'Done' : 'Next'}
              showLabel
            />
          </button>
        </footer>
      </article>
    </div>
  )
}

function getTooltipStyle(targetRect) {
  if (!targetRect || typeof window === 'undefined') {
    return {
      top: '50%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
    }
  }

  const margin = 14
  const gap = 14
  const tooltipWidth = Math.min(360, window.innerWidth - margin * 2)
  const estimatedHeight = 230
  const maxLeft = Math.max(margin, window.innerWidth - tooltipWidth - margin)
  const centeredLeft = targetRect.left + (targetRect.width / 2) - (tooltipWidth / 2)
  const canFitBelow = targetRect.top + targetRect.height + gap + estimatedHeight <= window.innerHeight - margin
  const top = canFitBelow
    ? targetRect.top + targetRect.height + gap
    : Math.max(margin, targetRect.top - estimatedHeight - gap)
  const left = Math.min(Math.max(margin, centeredLeft), maxLeft)

  return {
    top,
    left,
    transform: 'none',
  }
}

export {
  BabyAtlasTour,
  CompactMetric,
  CompactWorkspaceBar,
  DatasetPill,
  EmptyStateMascot,
}
