/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'

function resolveApiBase() {
  if (import.meta.env.VITE_API_BASE_URL) {
    return import.meta.env.VITE_API_BASE_URL
  }

  if (typeof window !== 'undefined') {
    const { protocol, hostname } = window.location
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      return `${protocol}//${hostname}:8000`
    }
  }

  return 'http://127.0.0.1:8000'
}

const API_BASE = resolveApiBase()
const AtlasContext = createContext(null)
const LAST_DATASET_STORAGE_KEY = 'atlas:lastDatasetId'
const WORKFLOW_STEPS = ['uploaded', 'profiled', 'cleaned', 'analyzed', 'visualized']

function createInitialWorkflowProgress() {
  return {
    uploaded: false,
    profiled: false,
    cleaned: false,
    analyzed: false,
    visualized: false,
  }
}

function getStoredDatasetId() {
  if (typeof window === 'undefined') {
    return ''
  }

  return window.localStorage.getItem(LAST_DATASET_STORAGE_KEY) ?? ''
}

function storeDatasetId(datasetId) {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.setItem(LAST_DATASET_STORAGE_KEY, datasetId)
}

function clearStoredDatasetId() {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.removeItem(LAST_DATASET_STORAGE_KEY)
}

async function fetchJson(path, options = {}) {
  let response

  try {
    response = await fetch(`${API_BASE}${path}`, options)
  } catch {
    throw new Error(
      `Unable to reach the ATLAS backend at ${API_BASE}. Make sure the FastAPI server is running and CORS is configured for this frontend origin.`,
    )
  }

  const payload = await response.json().catch(() => ({}))

  if (!response.ok) {
    throw new Error(payload?.detail ?? 'Request failed')
  }

  return payload
}

function getFilenameFromContentDisposition(headerValue, fallback) {
  const match = headerValue?.match(/filename="?([^"]+)"?/i)
  return match?.[1] ?? fallback
}

export function AtlasProvider({ children }) {
  const [datasetId, setDatasetId] = useState('')
  const [fileName, setFileName] = useState('')
  const [datasetMeta, setDatasetMeta] = useState({ sizeBytes: 0, uploadedAt: '' })
  const [uploadedDataset, setUploadedDataset] = useState({ columns: [], rows: [] })

  const [rawProfile, setRawProfile] = useState(null)
  const [cleanedProfile, setCleanedProfile] = useState(null)
  const [cleaningSummary, setCleaningSummary] = useState(null)
  const [comparison, setComparison] = useState(null)

  const [analysis, setAnalysis] = useState(null)
  const [charts, setCharts] = useState(null)
  const [workflowProgress, setWorkflowProgress] = useState(createInitialWorkflowProgress)

  const [busyAction, setBusyAction] = useState('idle')
  const [errorMessage, setErrorMessage] = useState('')

  function resetWorkspace() {
    clearStoredDatasetId()
    setDatasetId('')
    setFileName('')
    setDatasetMeta({ sizeBytes: 0, uploadedAt: '' })
    setUploadedDataset({ columns: [], rows: [] })
    setRawProfile(null)
    setCleanedProfile(null)
    setCleaningSummary(null)
    setComparison(null)
    setAnalysis(null)
    setCharts(null)
    setWorkflowProgress(createInitialWorkflowProgress())
    setErrorMessage('')
    setBusyAction('idle')
  }

  function clearError() {
    setErrorMessage('')
  }

  const loadLatestOutputs = useCallback(async (targetDatasetId) => {
    const [analysisPayload, chartsPayload] = await Promise.all([
      fetchJson(`/datasets/${targetDatasetId}/analyze?stage=latest`),
      fetchJson(`/datasets/${targetDatasetId}/visualize?stage=latest`),
    ])

    setAnalysis(analysisPayload.analysis)
    setCharts(chartsPayload.charts)
  }, [])

  async function uploadDataset(file) {
    if (!file) {
      setErrorMessage('Select a file before uploading.')
      return
    }

    setBusyAction('uploading')
    setErrorMessage('')

    try {
      const formData = new FormData()
      formData.append('file', file)

      const uploadPayload = await fetchJson('/upload', {
        method: 'POST',
        body: formData,
      })

      const nextDatasetId = uploadPayload.dataset_id
      storeDatasetId(nextDatasetId)

      setDatasetId(nextDatasetId)
      setFileName(uploadPayload.filename ?? file.name)
      setDatasetMeta({
        sizeBytes: file.size ?? 0,
        uploadedAt: new Date().toISOString(),
      })
      setUploadedDataset({
        columns: uploadPayload.columns ?? [],
        rows: uploadPayload.rows ?? [],
      })
      setRawProfile(uploadPayload.profile ?? null)
      setCleanedProfile(null)
      setCleaningSummary(null)
      setComparison(null)
      setAnalysis(null)
      setCharts(null)
      setWorkflowProgress({
        uploaded: true,
        profiled: false,
        cleaned: false,
        analyzed: false,
        visualized: false,
      })

      await loadLatestOutputs(nextDatasetId)
      return nextDatasetId
    } catch (error) {
      setErrorMessage(error.message)
      return ''
    } finally {
      setBusyAction('idle')
    }
  }

  async function runAutoClean(options = {}, targetDatasetId = datasetId) {
    if (!targetDatasetId) {
      setErrorMessage('Upload a dataset before running cleaning.')
      return
    }

    setBusyAction('cleaning')
    setErrorMessage('')

    try {
      const cleanPayload = await fetchJson(`/datasets/${targetDatasetId}/clean`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(options),
      })

      setCleaningSummary(cleanPayload.cleaning_summary)

      const [statePayload, rawPayload, cleanedPayload, comparisonPayload] = await Promise.all([
        fetchJson(`/datasets/${targetDatasetId}/state?preview_rows=20`),
        fetchJson(`/datasets/${targetDatasetId}/profile?stage=raw&preview_rows=20`),
        fetchJson(`/datasets/${targetDatasetId}/profile?stage=cleaned&preview_rows=20`),
        fetchJson(`/datasets/${targetDatasetId}/compare?limit=60`),
      ])

      setUploadedDataset({
        columns: statePayload.columns ?? [],
        rows: statePayload.rows ?? [],
      })
      setDatasetMeta((previous) => ({
        ...previous,
        sizeBytes: Number(statePayload.approx_size_bytes) || previous.sizeBytes,
      }))

      setRawProfile(rawPayload.profile)
      setCleanedProfile(cleanedPayload.profile)
      setComparison(comparisonPayload.comparison ?? null)
      await loadLatestOutputs(targetDatasetId)
      setWorkflowProgress((currentProgress) => ({
        ...currentProgress,
        uploaded: true,
        profiled: true,
        cleaned: true,
        analyzed: false,
        visualized: false,
      }))
    } catch (error) {
      setErrorMessage(error.message)
    } finally {
      setBusyAction('idle')
    }
  }

  async function resetCleaning() {
    if (!datasetId) {
      setErrorMessage('Upload a dataset before resetting cleaning.')
      return
    }

    setBusyAction('resetting-cleaning')
    setErrorMessage('')

    try {
      const payload = await fetchJson(`/datasets/${datasetId}/clean`, {
        method: 'DELETE',
      })

      setUploadedDataset({
        columns: payload.columns ?? [],
        rows: payload.rows ?? [],
      })
      setRawProfile(payload.profile ?? rawProfile)
      setCleanedProfile(null)
      setCleaningSummary(null)
      setComparison(null)
      setAnalysis(null)
      setCharts(null)
      setDatasetMeta((previous) => ({
        ...previous,
        sizeBytes: Number(payload.approx_size_bytes) || previous.sizeBytes,
      }))
      setWorkflowProgress((currentProgress) => ({
        ...currentProgress,
        uploaded: true,
        profiled: true,
        cleaned: false,
        analyzed: false,
        visualized: false,
      }))
    } catch (error) {
      setErrorMessage(error.message)
    } finally {
      setBusyAction('idle')
    }
  }

  async function saveDatasetEdits({ columns, rows, columnTypeOverrides = {} }) {
    if (!datasetId) {
      setErrorMessage('Upload a dataset before saving edits.')
      return
    }

    setBusyAction('saving')
    setErrorMessage('')

    try {
      const payload = await fetchJson(`/datasets/${datasetId}/raw`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          columns,
          rows,
          column_type_overrides: columnTypeOverrides,
        }),
      })

      setUploadedDataset({
        columns: payload.columns ?? [],
        rows: payload.rows ?? [],
      })
      setRawProfile(payload.profile ?? null)
      setCleanedProfile(null)
      setCleaningSummary(null)
      setComparison(null)
      setAnalysis(null)
      setCharts(null)
      setWorkflowProgress({
        uploaded: true,
        profiled: false,
        cleaned: false,
        analyzed: false,
        visualized: false,
      })
      setDatasetMeta((previous) => ({
        ...previous,
        sizeBytes: Number(payload.approx_size_bytes) || previous.sizeBytes,
      }))

      await loadLatestOutputs(datasetId)
    } catch (error) {
      setErrorMessage(error.message)
      throw error
    } finally {
      setBusyAction('idle')
    }
  }

  async function renameDatasetFile(filename) {
    if (!datasetId) {
      setErrorMessage('Upload a dataset before renaming it.')
      return
    }

    const nextFilename = String(filename || '').trim()
    if (!nextFilename) {
      setErrorMessage('File name cannot be empty.')
      return
    }

    setBusyAction('renaming')
    setErrorMessage('')

    try {
      const payload = await fetchJson(`/datasets/${datasetId}/filename`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ filename: nextFilename }),
      })

      setFileName(payload.filename ?? nextFilename)
    } catch (error) {
      setErrorMessage(error.message)
      throw error
    } finally {
      setBusyAction('idle')
    }
  }

  async function generateDashboard() {
    if (!datasetId) {
      setErrorMessage('Upload a dataset before generating dashboard outputs.')
      return
    }

    setBusyAction('dashboarding')
    setErrorMessage('')

    try {
      await loadLatestOutputs(datasetId)
    } catch (error) {
      setErrorMessage(error.message)
    } finally {
      setBusyAction('idle')
    }
  }

  const visualizeDatasetRows = useCallback(async ({ columns = [], rows = [], override = null } = {}) => {
    return fetchJson('/api/visualize', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ columns, rows, override }),
    })
  }, [])

  const filterDatasetRows = useCallback(
    async ({ columns = [], rows = [], filters = [], override = null, chartOverrides = [] } = {}) => {
      return fetchJson('/api/filter', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          columns,
          rows,
          filters,
          override,
          chart_overrides: chartOverrides,
        }),
      })
    },
    [],
  )

  const fetchDatasetTable = useCallback(async ({ stage = 'raw', page = 1, pageSize = 50 } = {}) => {
    if (!datasetId) {
      throw new Error('No dataset available yet.')
    }

    return fetchJson(
      `/datasets/${datasetId}/table?stage=${stage}&page=${page}&page_size=${pageSize}`,
    )
  }, [datasetId])

  const fetchComparison = useCallback(async ({ limit = 60 } = {}) => {
    if (!datasetId) {
      throw new Error('No dataset available yet.')
    }

    const payload = await fetchJson(`/datasets/${datasetId}/compare?limit=${limit}`)
    setComparison(payload.comparison ?? null)
    return payload
  }, [datasetId])

  const downloadDataset = useCallback(
    async ({ stage = 'cleaned' } = {}) => {
      if (!datasetId) {
        setErrorMessage('No dataset available yet.')
        return
      }

      setBusyAction('exporting')
      setErrorMessage('')

      try {
        const response = await fetch(`${API_BASE}/datasets/${datasetId}/export?stage=${stage}`)
        if (!response.ok) {
          const payload = await response.json().catch(() => ({}))
          throw new Error(payload?.detail ?? 'Export failed')
        }

        const blob = await response.blob()
        const filename = getFilenameFromContentDisposition(
          response.headers.get('Content-Disposition'),
          `${fileName || 'atlas_dataset'}_${stage}.csv`,
        )
        const exportUrl = URL.createObjectURL(blob)
        const link = document.createElement('a')

        link.href = exportUrl
        link.download = filename
        document.body.append(link)
        link.click()
        link.remove()
        URL.revokeObjectURL(exportUrl)
      } catch (error) {
        setErrorMessage(error.message)
      } finally {
        setBusyAction('idle')
      }
    },
    [datasetId, fileName],
  )

  const generateChartData = useCallback(
    async ({
      chartType = 'bar',
      stage = 'latest',
      dimension = '',
      measure = '',
      aggregation = 'count',
    } = {}) => {
      if (!datasetId) {
        throw new Error('No dataset available yet.')
      }

      const searchParams = new URLSearchParams({
        chart_type: chartType,
        stage,
        aggregation,
      })

      if (dimension) {
        searchParams.set('dimension', dimension)
      }

      if (measure) {
        searchParams.set('measure', measure)
      }

      return fetchJson(`/datasets/${datasetId}/chart?${searchParams.toString()}`)
    },
    [datasetId],
  )

  const generateAiInsights = useCallback(
    async ({ stage = 'latest', refresh = false } = {}) => {
      if (!datasetId) {
        throw new Error('No dataset available yet.')
      }

      const searchParams = new URLSearchParams({ stage })

      if (refresh) {
        searchParams.set('refresh', 'true')
      }

      return fetchJson(`/datasets/${datasetId}/ai-insights?${searchParams.toString()}`, {
        method: 'POST',
      })
    },
    [datasetId],
  )

  useEffect(() => {
    const storedDatasetId = getStoredDatasetId()
    if (!storedDatasetId) {
      return
    }

    let cancelled = false

    async function restoreDataset() {
      setBusyAction('loading')
      setErrorMessage('')

      try {
        const statePayload = await fetchJson(`/datasets/${storedDatasetId}/state?preview_rows=20`)

        const [analysisPayload, chartsPayload, comparisonPayload] = await Promise.all([
          fetchJson(`/datasets/${storedDatasetId}/analyze?stage=latest`),
          fetchJson(`/datasets/${storedDatasetId}/visualize?stage=latest`),
          statePayload.cleaned_profile
            ? fetchJson(`/datasets/${storedDatasetId}/compare?limit=60`)
            : Promise.resolve(null),
        ])

        if (cancelled) {
          return
        }

        setDatasetId(storedDatasetId)
        setFileName(statePayload.filename ?? '')
        setDatasetMeta({
          sizeBytes: Number(statePayload.approx_size_bytes) || 0,
          uploadedAt: statePayload.uploaded_at ?? '',
        })
        setUploadedDataset({
          columns: statePayload.columns ?? [],
          rows: statePayload.rows ?? [],
        })
        setRawProfile(statePayload.raw_profile ?? null)
        setCleanedProfile(statePayload.cleaned_profile ?? null)
        setCleaningSummary(statePayload.cleaning_summary ?? null)
        setComparison(comparisonPayload?.comparison ?? null)
        setAnalysis(analysisPayload.analysis ?? null)
        setCharts(chartsPayload.charts ?? null)
        setWorkflowProgress({
          uploaded: Boolean(statePayload.raw_profile),
          profiled: Boolean(statePayload.cleaned_profile),
          cleaned: Boolean(statePayload.cleaned_profile),
          analyzed: false,
          visualized: false,
        })
      } catch {
        if (!cancelled) {
          clearStoredDatasetId()
          setDatasetId('')
          setFileName('')
          setDatasetMeta({ sizeBytes: 0, uploadedAt: '' })
          setUploadedDataset({ columns: [], rows: [] })
          setRawProfile(null)
          setCleanedProfile(null)
          setCleaningSummary(null)
          setComparison(null)
          setAnalysis(null)
          setCharts(null)
          setWorkflowProgress(createInitialWorkflowProgress())
          setErrorMessage('')
        }
      } finally {
        if (!cancelled) {
          setBusyAction('idle')
        }
      }
    }

    restoreDataset()

    return () => {
      cancelled = true
    }
  }, [])

  const activeProfile = cleanedProfile ?? rawProfile

  const markWorkflowStep = useCallback((step) => {
    const stepIndex = WORKFLOW_STEPS.indexOf(step)
    if (stepIndex === -1) {
      return
    }

    setWorkflowProgress((currentProgress) => {
      const nextProgress = { ...currentProgress }
      WORKFLOW_STEPS.slice(0, stepIndex + 1).forEach((workflowStep) => {
        nextProgress[workflowStep] = true
      })
      return nextProgress
    })
  }, [])

  const workflow = useMemo(
    () => ({
      uploaded: Boolean(rawProfile) && workflowProgress.uploaded,
      profiled: Boolean(rawProfile) && workflowProgress.profiled,
      cleaned: Boolean(cleanedProfile) && workflowProgress.cleaned,
      analyzed: Boolean(cleanedProfile) && workflowProgress.analyzed,
      visualized: Boolean(cleanedProfile) && workflowProgress.visualized,
      dashboardReady: Boolean(analysis) && Boolean(charts),
    }),
    [rawProfile, cleanedProfile, analysis, charts, workflowProgress],
  )

  const value = {
    datasetId,
    fileName,
    datasetMeta,
    uploadedDataset,
    rawProfile,
    cleanedProfile,
    activeProfile,
    cleaningSummary,
    comparison,
    analysis,
    charts,
    workflow,
    busyAction,
    errorMessage,
    uploadDataset,
    saveDatasetEdits,
    renameDatasetFile,
    runAutoClean,
    resetCleaning,
    generateDashboard,
    visualizeDatasetRows,
    filterDatasetRows,
    fetchDatasetTable,
    fetchComparison,
    downloadDataset,
    generateChartData,
    generateAiInsights,
    markWorkflowStep,
    clearError,
    resetWorkspace,
  }

  return <AtlasContext.Provider value={value}>{children}</AtlasContext.Provider>
}

export function useAtlas() {
  const context = useContext(AtlasContext)
  if (!context) {
    throw new Error('useAtlas must be used inside AtlasProvider')
  }
  return context
}
