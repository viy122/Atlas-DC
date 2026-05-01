import html2canvas from 'html2canvas'
import { jsPDF } from 'jspdf'
import { useEffect, useMemo, useRef, useState } from 'react'
import Chart from 'react-apexcharts'
import { Link } from 'react-router-dom'
import { useAtlas } from '../context/AtlasContext'
import { formatValue } from '../utils/formatters'

const CHART_TYPE_OPTIONS = [
  { value: 'bar', label: 'Bar' },
  { value: 'line', label: 'Line' },
  { value: 'area', label: 'Area' },
  { value: 'pie', label: 'Pie' },
  { value: 'donut', label: 'Donut' },
  { value: 'scatter', label: 'Scatter' },
  { value: 'histogram', label: 'Histogram' },
]

const AGGREGATION_OPTIONS = [
  { value: 'count', label: 'Count' },
  { value: 'sum', label: 'Sum' },
  { value: 'average', label: 'Average' },
  { value: 'min', label: 'Min' },
  { value: 'max', label: 'Max' },
]

const APEX_TYPES = new Set(['line', 'area', 'bar', 'pie', 'donut', 'scatter'])
const SAVED_DASHBOARD_PREFIX = 'atlas:finalizedDashboard:'
const DATA_TABLE_PAGE_SIZE = 25

function normalizeChartType(chart) {
  return chart?.chart_type === 'histogram' ? 'histogram' : chart?.chart_type || chart?.type || 'bar'
}

function normalizeAggregation(value) {
  if (!value || value === 'none' || value === 'mean') {
    return value === 'mean' ? 'average' : 'count'
  }

  return value
}

function buildDefaultSettings(chart, columns, numericColumns) {
  return {
    chart_type: normalizeChartType(chart),
    x_axis: chart?.x_axis || columns[0] || '',
    y_axis: chart?.y_axis || numericColumns[0] || '',
    aggregation: normalizeAggregation(chart?.aggregation),
  }
}

function getKpiTextKey(kpi, index) {
  return `${kpi.type || 'kpi'}:${kpi.label || index}`
}

function getSavedDashboardKey(datasetId) {
  return `${SAVED_DASHBOARD_PREFIX}${datasetId || 'workspace'}`
}

function getSavedDashboard(datasetId) {
  if (typeof window === 'undefined' || !datasetId) {
    return null
  }

  const rawValue = window.localStorage.getItem(getSavedDashboardKey(datasetId))
  if (!rawValue) {
    return null
  }

  try {
    return JSON.parse(rawValue)
  } catch {
    return null
  }
}

function saveDashboardConfig(datasetId, config) {
  if (typeof window === 'undefined' || !datasetId) {
    return
  }

  window.localStorage.setItem(getSavedDashboardKey(datasetId), JSON.stringify(config))
}

function KpiCard({
  label,
  value,
  hint,
  textKey,
  textOverride = {},
  isFinalized,
  onEditText,
  onRemove,
}) {
  const displayLabel = textOverride.title || label
  const displayHint = textOverride.subtitle || hint

  return (
    <article className="visual-kpi-card">
      <span>{displayLabel}</span>
      <strong title={String(value ?? 'N/A')}>{value ?? 'N/A'}</strong>
      <small>{displayHint}</small>

      {!isFinalized ? (
        <div className="visual-kpi-actions">
          <button
            type="button"
            className="visual-card-edit-button"
            onClick={() => onEditText(textKey, { label, value, hint })}
          >
            Edit
          </button>
          <button
            type="button"
            className="visual-card-remove-button"
            onClick={() => onRemove(textKey)}
          >
            Remove
          </button>
        </div>
      ) : null}
    </article>
  )
}

function ChartCard({
  chart,
  isFinalized,
  isMenuOpen,
  onToggleMenu,
  onCustomize,
  onEditText,
  onRemove,
  isDragging,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  textOverride = {},
}) {
  const apexType = APEX_TYPES.has(chart?.type) ? chart.type : 'bar'
  const series = Array.isArray(chart?.series) ? chart.series : []
  const sourceOptions = chart?.options ?? {}
  const options = {
    ...sourceOptions,
    chart: {
      ...(sourceOptions.chart ?? {}),
      toolbar: { show: false },
    },
    title: { text: '' },
    subtitle: { text: '' },
  }
  const displayTitle = textOverride.title || chart?.title || 'Auto Chart'
  const displayDescription = textOverride.subtitle || ''
  const displayCaption = textOverride.caption || ''

  return (
    <article
      className={
        isDragging ? 'visual-chart-card visual-chart-card--dragging' : 'visual-chart-card'
      }
      draggable={!isFinalized}
      onDragStart={isFinalized ? undefined : onDragStart}
      onDragOver={isFinalized ? undefined : onDragOver}
      onDrop={isFinalized ? undefined : onDrop}
      onDragEnd={isFinalized ? undefined : onDragEnd}
    >
      <header className="visual-chart-head">
        <div>
          <h3>{displayTitle}</h3>
          {displayDescription ? <p>{displayDescription}</p> : null}
        </div>
        {!isFinalized ? (
          <div className="visual-card-menu">
            <button
              type="button"
              className="visual-menu-button"
              aria-label="Chart options"
              onClick={onToggleMenu}
            >
              ...
            </button>
            {isMenuOpen ? (
              <div className="visual-card-popover">
                <button type="button" onClick={onCustomize}>
                  Customize
                </button>
                <button type="button" onClick={onEditText}>
                  Edit text
                </button>
                <button type="button" onClick={onRemove}>
                  Remove
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
      </header>

      <div className="visual-chart-body">
        {chart?.empty ? (
          <div className="visual-chart-empty">{chart.description}</div>
        ) : (
          <Chart options={options} series={series} type={apexType} height={210} width="100%" />
        )}
      </div>

      {displayCaption ? <p className="visual-chart-caption">{displayCaption}</p> : null}
    </article>
  )
}

function ManualChartBuilder({
  columns,
  numericColumns,
  settings,
  isOpen,
  isRendering,
  onToggle,
  onSettingChange,
  onRender,
}) {
  return (
    <section
      className={
        isOpen ? 'visual-builder-panel visual-builder-panel--open' : 'visual-builder-panel'
      }
    >
      <header className="visual-section-title">
        <div>
          <h2>Create New Chart</h2>
          <p>{isOpen ? 'Choose fields, then add the chart to the dashboard.' : 'Manual builder is collapsed.'}</p>
        </div>
        <button
          type="button"
          className="visual-secondary-button"
          onClick={onToggle}
        >
          {isOpen ? 'Close Builder' : '+ Create New Chart'}
        </button>
      </header>

      {isOpen ? (
        <div className="visual-builder-grid">
          <label>
            <span>Chart type</span>
            <select
              value={settings.chart_type}
              onChange={(event) => onSettingChange('chart_type', event.target.value)}
            >
              {CHART_TYPE_OPTIONS.map((option) => (
                <option key={`manual-${option.value}`} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span>X-axis</span>
            <select
              value={settings.x_axis}
              onChange={(event) => onSettingChange('x_axis', event.target.value)}
            >
              <option value="">None</option>
              {columns.map((column) => (
                <option key={`manual-x-${column}`} value={column}>
                  {column}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span>Y-axis</span>
            <select
              value={settings.y_axis}
              onChange={(event) => onSettingChange('y_axis', event.target.value)}
            >
              <option value="">Record count</option>
              {numericColumns.map((column) => (
                <option key={`manual-y-${column}`} value={column}>
                  {column}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span>Aggregation</span>
            <select
              value={settings.aggregation}
              onChange={(event) => onSettingChange('aggregation', event.target.value)}
            >
              {AGGREGATION_OPTIONS.map((option) => (
                <option key={`manual-${option.value}`} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <button
            type="button"
            className="visual-apply-button"
            onClick={onRender}
            disabled={isRendering || columns.length === 0}
          >
            {isRendering ? 'Adding...' : 'Add Chart'}
          </button>
        </div>
      ) : null}
    </section>
  )
}

function buildFilterPayload(filterState, filterMetadata) {
  return filterMetadata
    .map((filter) => {
      const state = filterState[filter.column] ?? {}

      if (filter.type === 'datetime') {
        return {
          column: filter.column,
          type: filter.type,
          start: state.start || null,
          end: state.end || null,
        }
      }

      if (filter.type === 'numeric') {
        return {
          column: filter.column,
          type: filter.type,
          min: state.min ?? null,
          max: state.max ?? null,
        }
      }

      return {
        column: filter.column,
        type: filter.type,
        values: state.values ?? [],
      }
    })
    .filter((filter) => {
      if (filter.type === 'datetime') {
        return Boolean(filter.start || filter.end)
      }

      if (filter.type === 'numeric') {
        return filter.min !== null || filter.max !== null
      }

      return filter.values.length > 0
    })
}

function filterHasValue(filterState, filter) {
  const state = filterState[filter.column] ?? {}

  if (filter.type === 'datetime') {
    return Boolean(state.start || state.end)
  }

  if (filter.type === 'numeric') {
    return state.min !== undefined || state.max !== undefined
  }

  return (state.values ?? []).length > 0
}

function GlobalFilterPanel({
  filters,
  filterState,
  activeFilters,
  disabled,
  onFilterChange,
  onClearFilters,
}) {
  if (!filters.length) {
    return null
  }

  return (
    <section className="visual-filter-panel">
      <header className="visual-section-title">
        <div>
          <h2>Global Filters</h2>
          <p>{activeFilters.length ? `${activeFilters.length} active filters` : 'No filters applied'}</p>
        </div>
        <button
          type="button"
          className="visual-secondary-button"
          onClick={onClearFilters}
          disabled={disabled || activeFilters.length === 0}
        >
          Clear All
        </button>
      </header>

      <div className="visual-filter-grid">
        {filters.map((filter) => {
          const state = filterState[filter.column] ?? {}

          if (filter.type === 'datetime') {
            return (
              <div className="visual-filter-control" key={`filter-${filter.column}`}>
                <span>{filter.column}</span>
                <div className="visual-filter-range">
                  <input
                    type="date"
                    value={state.start ?? ''}
                    min={filter.start ?? undefined}
                    max={filter.end ?? undefined}
                    onChange={(event) =>
                      onFilterChange(filter.column, {
                        ...state,
                        start: event.target.value,
                      })
                    }
                    disabled={disabled}
                  />
                  <input
                    type="date"
                    value={state.end ?? ''}
                    min={filter.start ?? undefined}
                    max={filter.end ?? undefined}
                    onChange={(event) =>
                      onFilterChange(filter.column, {
                        ...state,
                        end: event.target.value,
                      })
                    }
                    disabled={disabled}
                  />
                </div>
              </div>
            )
          }

          if (filter.type === 'numeric') {
            const minValue = Number(filter.min ?? 0)
            const maxValue = Number(filter.max ?? minValue)
            const lowerValue = Number(state.min ?? minValue)
            const upperValue = Number(state.max ?? maxValue)

            return (
              <div className="visual-filter-control" key={`filter-${filter.column}`}>
                <span>{filter.column}</span>
                <div className="visual-filter-range-values">
                  <small>{formatValue(lowerValue)}</small>
                  <small>{formatValue(upperValue)}</small>
                </div>
                <input
                  type="range"
                  min={minValue}
                  max={maxValue}
                  step="any"
                  value={lowerValue}
                  onChange={(event) =>
                    onFilterChange(filter.column, {
                      ...state,
                      min: Math.min(Number(event.target.value), upperValue),
                    })
                  }
                  disabled={disabled || minValue === maxValue}
                />
                <input
                  type="range"
                  min={minValue}
                  max={maxValue}
                  step="any"
                  value={upperValue}
                  onChange={(event) =>
                    onFilterChange(filter.column, {
                      ...state,
                      max: Math.max(Number(event.target.value), lowerValue),
                    })
                  }
                  disabled={disabled || minValue === maxValue}
                />
              </div>
            )
          }

          return (
            <label className="visual-filter-control" key={`filter-${filter.column}`}>
              <span>{filter.column}</span>
              <select
                value={(state.values ?? [])[0] ?? ''}
                onChange={(event) =>
                  onFilterChange(
                    filter.column,
                    event.target.value ? { values: [event.target.value] } : {},
                  )
                }
                disabled={disabled}
              >
                <option value="">All values</option>
                {(filter.options ?? []).map((option) => (
                  <option key={`${filter.column}-${option.label}`} value={option.label}>
                    {option.label} ({option.count})
                  </option>
                ))}
              </select>
            </label>
          )
        })}
      </div>

      {activeFilters.length ? (
        <div className="visual-filter-chips">
          {activeFilters.map((filter) => (
            <button
              type="button"
              key={`${filter.column}-${filter.label}`}
              onClick={() => onFilterChange(filter.column, {})}
              disabled={disabled}
            >
              {filter.label}
            </button>
          ))}
        </div>
      ) : null}
    </section>
  )
}

function FilteredDataTable({ columns, rows }) {
  const [page, setPage] = useState(1)
  const totalPages = Math.max(1, Math.ceil(rows.length / DATA_TABLE_PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const startIndex = (safePage - 1) * DATA_TABLE_PAGE_SIZE
  const visibleRows = rows.slice(startIndex, startIndex + DATA_TABLE_PAGE_SIZE)

  return (
    <section className="visual-table-panel">
      <header className="visual-table-head">
        <div>
          <h3>Filtered Data Table</h3>
          <p>{formatValue(rows.length)} matching rows</p>
        </div>
      </header>

      {columns.length && rows.length ? (
        <div className="visual-table-scroll">
          <table className="visual-data-table">
            <thead>
              <tr>
                {columns.map((column) => (
                  <th key={`visual-table-${column}`}>{column}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row, rowIndex) => (
                <tr key={`filtered-row-${startIndex + rowIndex}`}>
                  {columns.map((column) => (
                    <td key={`${column}-${startIndex + rowIndex}`}>
                      {formatValue(row?.[column], { empty: '' })}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="visual-table-empty">No data available for the active filters.</div>
      )}

      <footer className="visual-table-footer">
        <span>
          Showing {rows.length === 0 ? 0 : startIndex + 1}-{Math.min(startIndex + DATA_TABLE_PAGE_SIZE, rows.length)}
        </span>
        <div>
          <button
            type="button"
            className="visual-small-button"
            onClick={() => setPage((current) => Math.max(1, current - 1))}
            disabled={safePage <= 1}
          >
            Previous
          </button>
          <strong>
            {safePage} / {totalPages}
          </strong>
          <button
            type="button"
            className="visual-small-button"
            onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
            disabled={safePage >= totalPages}
          >
            Next
          </button>
        </div>
      </footer>
    </section>
  )
}

function DashboardEditorPanel({
  editor,
  chart,
  kpi,
  columns,
  numericColumns,
  settings,
  chartText,
  kpiText,
  isApplying,
  onClose,
  onSettingChange,
  onApplyChart,
  onChartTextChange,
  onKpiTextChange,
}) {
  if (!editor) {
    return null
  }

  if (editor.type === 'kpi') {
    const title = kpiText?.title || kpi?.label || ''
    const subtitle = kpiText?.subtitle || kpi?.hint || ''

    return (
      <aside className="visual-side-panel">
        <header>
          <div>
            <span>Presentation Text</span>
            <h2>Edit KPI Card</h2>
          </div>
          <button type="button" className="visual-small-button" onClick={onClose}>
            Close
          </button>
        </header>
        <label>
          <span>Title</span>
          <input
            type="text"
            value={title}
            onChange={(event) => onKpiTextChange(editor.textKey, 'title', event.target.value)}
          />
        </label>
        <label>
          <span>Subtitle</span>
          <input
            type="text"
            value={subtitle}
            onChange={(event) => onKpiTextChange(editor.textKey, 'subtitle', event.target.value)}
          />
        </label>
      </aside>
    )
  }

  if (!chart) {
    return null
  }

  const title = chartText?.title || chart.title || ''
  const subtitle = chartText?.subtitle || chart.description || ''
  const caption = chartText?.caption || ''

  return (
    <aside className="visual-side-panel">
      <header>
        <div>
          <span>{editor.mode === 'text' ? 'Presentation Text' : 'Chart Setup'}</span>
          <h2>{editor.mode === 'text' ? 'Edit Chart Text' : 'Customize Chart'}</h2>
        </div>
        <button type="button" className="visual-small-button" onClick={onClose}>
          Close
        </button>
      </header>

      {editor.mode === 'text' ? (
        <>
          <label>
            <span>Title</span>
            <input
              type="text"
              value={title}
              onChange={(event) => onChartTextChange(chart.id, 'title', event.target.value)}
            />
          </label>
          <label>
            <span>Subtitle</span>
            <input
              type="text"
              value={subtitle}
              onChange={(event) => onChartTextChange(chart.id, 'subtitle', event.target.value)}
            />
          </label>
          <label>
            <span>Caption</span>
            <textarea
              value={caption}
              maxLength={180}
              onChange={(event) => onChartTextChange(chart.id, 'caption', event.target.value)}
            />
          </label>
        </>
      ) : (
        <>
          <label>
            <span>Chart type</span>
            <select
              value={settings.chart_type}
              onChange={(event) => onSettingChange(chart.id, 'chart_type', event.target.value)}
            >
              {CHART_TYPE_OPTIONS.map((option) => (
                <option key={`panel-${option.value}`} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span>X-axis</span>
            <select
              value={settings.x_axis}
              onChange={(event) => onSettingChange(chart.id, 'x_axis', event.target.value)}
            >
              <option value="">None</option>
              {columns.map((column) => (
                <option key={`panel-x-${column}`} value={column}>
                  {column}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span>Y-axis</span>
            <select
              value={settings.y_axis}
              onChange={(event) => onSettingChange(chart.id, 'y_axis', event.target.value)}
            >
              <option value="">Record count</option>
              {numericColumns.map((column) => (
                <option key={`panel-y-${column}`} value={column}>
                  {column}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span>Aggregation</span>
            <select
              value={settings.aggregation}
              onChange={(event) => onSettingChange(chart.id, 'aggregation', event.target.value)}
            >
              {AGGREGATION_OPTIONS.map((option) => (
                <option key={`panel-agg-${option.value}`} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <button
            type="button"
            className="visual-apply-button"
            onClick={() => onApplyChart(chart.id)}
            disabled={isApplying}
          >
            {isApplying ? 'Applying...' : 'Apply Changes'}
          </button>
        </>
      )}
    </aside>
  )
}

function VisualizationPage() {
  const {
    datasetId,
    fileName,
    uploadedDataset,
    cleanedProfile,
    activeProfile,
    charts: storedCharts,
    errorMessage,
    visualizeDatasetRows,
    filterDatasetRows,
  } = useAtlas()

  const [localDashboard, setLocalDashboard] = useState(null)
  const [dashboardError, setDashboardError] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [applyingChartId, setApplyingChartId] = useState('')
  const [isManualRendering, setIsManualRendering] = useState(false)
  const [settingsById, setSettingsById] = useState({})
  const [manualSettings, setManualSettings] = useState({
    chart_type: 'bar',
    x_axis: '',
    y_axis: '',
    aggregation: 'count',
  })
  const [manualCharts, setManualCharts] = useState([])
  const [customChartsById, setCustomChartsById] = useState({})
  const [hiddenChartIds, setHiddenChartIds] = useState([])
  const [hiddenKpiKeys, setHiddenKpiKeys] = useState([])
  const [chartOrder, setChartOrder] = useState([])
  const [draggingChartId, setDraggingChartId] = useState('')
  const [isFinalized, setIsFinalized] = useState(false)
  const [finalizedDashboard, setFinalizedDashboard] = useState(null)
  const [isExporting, setIsExporting] = useState(false)
  const [isFiltering, setIsFiltering] = useState(false)
  const [filterState, setFilterState] = useState({})
  const [filterMetadata, setFilterMetadata] = useState([])
  const [kpiTextByKey, setKpiTextByKey] = useState({})
  const [chartTextById, setChartTextById] = useState({})
  const [activeEditor, setActiveEditor] = useState(null)
  const [openChartMenuId, setOpenChartMenuId] = useState('')
  const [isBuilderOpen, setIsBuilderOpen] = useState(false)
  const dashboardCaptureRef = useRef(null)

  const dashboard = localDashboard ?? storedCharts
  const sourceColumns = useMemo(() => uploadedDataset.columns ?? [], [uploadedDataset.columns])
  const sourceRows = useMemo(() => uploadedDataset.rows ?? [], [uploadedDataset.rows])
  const tableColumns = dashboard?.table?.columns?.length ? dashboard.table.columns : sourceColumns
  const tableRows = dashboard?.table?.rows ?? sourceRows
  const numericColumns = useMemo(() => {
    if (dashboard?.column_types?.numeric?.length) {
      return dashboard.column_types.numeric
    }

    return (activeProfile?.column_profiles ?? [])
      .filter((column) => String(column.dtype).toLowerCase().includes('int') || String(column.dtype).toLowerCase().includes('float'))
      .map((column) => column.name)
  }, [activeProfile, dashboard])
  const chartConfigs = useMemo(() => dashboard?.chart_configs ?? [], [dashboard])
  const renderedCharts = chartConfigs.map((chart) => customChartsById[chart.id] ?? chart)
  const summary = dashboard?.summary ?? {}
  const insightKpis = Array.isArray(dashboard?.insight_kpis)
    ? dashboard.insight_kpis
    : Array.isArray(dashboard?.kpis)
      ? dashboard.kpis
      : []
  const fallbackKpis = [
    {
      label: 'Total Records',
      value: formatValue(summary.total_rows ?? tableRows.length),
      hint: 'Rows in the cleaned dataset',
    },
  ]
  const kpiCards = insightKpis.length > 0 ? insightKpis : fallbackKpis
  const hasDatasetPayload = sourceColumns.length > 0 || sourceRows.length > 0
  const hiddenChartIdSet = useMemo(() => new Set(hiddenChartIds), [hiddenChartIds])
  const hiddenKpiKeySet = useMemo(() => new Set(hiddenKpiKeys), [hiddenKpiKeys])
  const dashboardCharts = useMemo(
    () => [...renderedCharts, ...manualCharts],
    [manualCharts, renderedCharts],
  )
  const visibleKpiCards = useMemo(
    () => kpiCards.filter((kpi, index) => !hiddenKpiKeySet.has(getKpiTextKey(kpi, index))),
    [hiddenKpiKeySet, kpiCards],
  )
  const visibleCharts = useMemo(() => {
    const availableCharts = dashboardCharts.filter((chart) => !hiddenChartIdSet.has(chart.id))
    const chartById = new Map(availableCharts.map((chart) => [chart.id, chart]))
    const orderedCharts = chartOrder
      .map((chartId) => chartById.get(chartId))
      .filter(Boolean)
    const unorderedCharts = availableCharts.filter((chart) => !chartOrder.includes(chart.id))

    return [...orderedCharts, ...unorderedCharts]
  }, [chartOrder, dashboardCharts, hiddenChartIdSet])
  const presentationKpis = isFinalized && finalizedDashboard?.kpis ? finalizedDashboard.kpis : visibleKpiCards
  const presentationCharts = isFinalized && finalizedDashboard?.charts ? finalizedDashboard.charts : visibleCharts
  const presentationKpiText = isFinalized && finalizedDashboard?.kpiTextByKey
    ? finalizedDashboard.kpiTextByKey
    : kpiTextByKey
  const presentationChartText = isFinalized && finalizedDashboard?.chartTextById
    ? finalizedDashboard.chartTextById
    : chartTextById
  const filterPayload = useMemo(
    () => buildFilterPayload(filterState, filterMetadata),
    [filterMetadata, filterState],
  )
  const chartOverridePayload = useMemo(() => {
    const customizedAutoCharts = Object.keys(customChartsById)
      .map((chartId) => ({
        id: chartId,
        source: 'auto',
        ...(settingsById[chartId] ?? {}),
      }))
      .filter((override) => override.chart_type)

    const manualChartOverrides = manualCharts
      .map((chart) => ({
        id: chart.id,
        source: 'manual',
        ...(chart.settings ?? {}),
      }))
      .filter((override) => override.chart_type)

    return [...customizedAutoCharts, ...manualChartOverrides]
  }, [customChartsById, manualCharts, settingsById])
  const filterPayloadJson = useMemo(() => JSON.stringify(filterPayload), [filterPayload])
  const chartOverridePayloadJson = useMemo(
    () => JSON.stringify(chartOverridePayload),
    [chartOverridePayload],
  )
  const activeFilters = useMemo(() => {
    return filterMetadata
      .filter((filter) => filterHasValue(filterState, filter))
      .map((filter) => {
        const state = filterState[filter.column] ?? {}
        if (filter.type === 'datetime') {
          return {
            column: filter.column,
            label: `${filter.column}: ${state.start || 'start'} to ${state.end || 'end'}`,
          }
        }

        if (filter.type === 'numeric') {
          return {
            column: filter.column,
            label: `${filter.column}: ${state.min ?? filter.min} to ${state.max ?? filter.max}`,
          }
        }

        return {
          column: filter.column,
          label: `${filter.column}: ${(state.values ?? []).join(', ')}`,
        }
      })
  }, [filterMetadata, filterState])
  const savedAtLabel = finalizedDashboard?.savedAt
    ? new Intl.DateTimeFormat(undefined, {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      }).format(new Date(finalizedDashboard.savedAt))
    : ''
  const effectiveManualSettings = {
    chart_type: manualSettings.chart_type || 'bar',
    x_axis: manualSettings.x_axis || tableColumns[0] || '',
    y_axis: manualSettings.y_axis || numericColumns[0] || '',
    aggregation: manualSettings.aggregation || 'count',
  }
  const activeChart = activeEditor?.type === 'chart'
    ? dashboardCharts.find((chart) => chart.id === activeEditor.chartId)
    : null
  const activeChartSettings = activeChart
    ? settingsById[activeChart.id] ?? buildDefaultSettings(activeChart, tableColumns, numericColumns)
    : null

  useEffect(() => {
    if (!datasetId || !hasDatasetPayload) {
      return
    }

    let cancelled = false

    async function buildDashboard() {
      setIsLoading(true)
      setDashboardError('')

      try {
        const payload = await visualizeDatasetRows({
          columns: sourceColumns,
          rows: sourceRows,
        })
        if (!cancelled) {
          setLocalDashboard(payload)
          setCustomChartsById({})
          setManualCharts([])
          setHiddenChartIds([])
          setHiddenKpiKeys([])
          setChartOrder((payload.chart_configs ?? []).map((chart) => chart.id))
          setFilterMetadata(payload.filters ?? [])
          setFilterState({})
          setIsFinalized(false)
          setFinalizedDashboard(null)
          setActiveEditor(null)
          setOpenChartMenuId('')
          setIsBuilderOpen(false)
        }
      } catch (error) {
        if (!cancelled) {
          setDashboardError(error.message)
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false)
        }
      }
    }

    buildDashboard()

    return () => {
      cancelled = true
    }
  }, [datasetId, hasDatasetPayload, sourceColumns, sourceRows, visualizeDatasetRows])

  useEffect(() => {
    if (!hasDatasetPayload || isFinalized || filterMetadata.length === 0) {
      return
    }

    let cancelled = false

    async function applyFilters() {
      setIsFiltering(true)
      setDashboardError('')

      try {
        const filters = JSON.parse(filterPayloadJson)
        const chartOverrides = JSON.parse(chartOverridePayloadJson)
        const payload = await filterDatasetRows({
          columns: sourceColumns,
          rows: sourceRows,
          filters,
          chartOverrides,
        })

        if (cancelled) {
          return
        }

        setLocalDashboard(payload)

        const refreshedCharts = payload.custom_charts ?? []
        if (refreshedCharts.length) {
          const refreshedById = new Map(refreshedCharts.map((chart) => [chart.id, chart]))

          setCustomChartsById((previous) => {
            const next = { ...previous }
            for (const [chartId, chart] of refreshedById.entries()) {
              if (chart.source !== 'manual') {
                next[chartId] = chart
              }
            }
            return next
          })

          setManualCharts((previous) =>
            previous.map((chart) => {
              const refreshedChart = refreshedById.get(chart.id)
              return refreshedChart
                ? { ...refreshedChart, id: chart.id, source: 'manual', settings: chart.settings }
                : chart
            }),
          )
        }
      } catch (error) {
        if (!cancelled) {
          setDashboardError(error.message)
        }
      } finally {
        if (!cancelled) {
          setIsFiltering(false)
        }
      }
    }

    applyFilters()

    return () => {
      cancelled = true
    }
  }, [
    chartOverridePayloadJson,
    filterDatasetRows,
    filterMetadata.length,
    filterPayloadJson,
    hasDatasetPayload,
    isFinalized,
    sourceColumns,
    sourceRows,
  ])

  async function regenerateDashboard() {
    if (!hasDatasetPayload) {
      return
    }

    setIsLoading(true)
    setDashboardError('')

    try {
      const payload = await visualizeDatasetRows({
        columns: sourceColumns,
        rows: sourceRows,
      })
      setLocalDashboard(payload)
      setCustomChartsById({})
      setManualCharts([])
      setHiddenChartIds([])
      setHiddenKpiKeys([])
      setChartOrder((payload.chart_configs ?? []).map((chart) => chart.id))
      setFilterMetadata(payload.filters ?? [])
      setFilterState({})
      setIsFinalized(false)
      setFinalizedDashboard(null)
      setActiveEditor(null)
      setOpenChartMenuId('')
      setIsBuilderOpen(false)
    } catch (error) {
      setDashboardError(error.message)
    } finally {
      setIsLoading(false)
    }
  }

  function updateSetting(chartId, field, value) {
    setSettingsById((previous) => ({
      ...previous,
      [chartId]: {
        ...buildDefaultSettings(
          dashboardCharts.find((chart) => chart.id === chartId),
          tableColumns,
          numericColumns,
        ),
        ...(previous[chartId] ?? {}),
        [field]: value,
      },
    }))
  }

  function updateManualSetting(field, value) {
    setManualSettings((previous) => ({
      ...previous,
      [field]: value,
    }))
  }

  async function renderManualChart() {
    if (!hasDatasetPayload) {
      return
    }

    setIsManualRendering(true)
    setDashboardError('')

    try {
      const payload = await visualizeDatasetRows({
        columns: sourceColumns,
        rows: sourceRows,
        override: effectiveManualSettings,
      })
      const customChart = payload.custom_chart
      if (customChart) {
        const manualChartId = `manual-${Date.now()}`
        setManualCharts((previous) => [
          ...previous,
          {
            ...customChart,
            id: manualChartId,
            title: customChart.title || 'Manual Chart',
            description: customChart.description || 'Created from the manual chart builder.',
            source: 'manual',
            settings: { ...effectiveManualSettings },
          },
        ])
        setChartOrder((previous) => [...previous, manualChartId])
        setIsBuilderOpen(false)
      }
    } catch (error) {
      setDashboardError(error.message)
    } finally {
      setIsManualRendering(false)
    }
  }

  function removeChart(chartId) {
    setHiddenChartIds((previous) => (previous.includes(chartId) ? previous : [...previous, chartId]))
    setManualCharts((previous) => previous.filter((chart) => chart.id !== chartId))
    setChartOrder((previous) => previous.filter((id) => id !== chartId))
    setActiveEditor((current) => (current?.chartId === chartId ? null : current))
    setOpenChartMenuId((current) => (current === chartId ? '' : current))
  }

  function removeKpi(textKey) {
    setHiddenKpiKeys((previous) => (previous.includes(textKey) ? previous : [...previous, textKey]))
    setActiveEditor((current) => (current?.type === 'kpi' && current.textKey === textKey ? null : current))
  }

  function moveChart(sourceId, targetId) {
    if (!sourceId || !targetId || sourceId === targetId) {
      return
    }

    const visibleIds = visibleCharts.map((chart) => chart.id)
    setChartOrder((previous) => {
      const mergedIds = [
        ...previous.filter((chartId) => visibleIds.includes(chartId)),
        ...visibleIds.filter((chartId) => !previous.includes(chartId)),
      ]
      const sourceIndex = mergedIds.indexOf(sourceId)
      const targetIndex = mergedIds.indexOf(targetId)

      if (sourceIndex < 0 || targetIndex < 0) {
        return previous
      }

      const nextIds = [...mergedIds]
      const [movedId] = nextIds.splice(sourceIndex, 1)
      nextIds.splice(targetIndex, 0, movedId)
      return nextIds
    })
  }

  function handleDragStart(chartId, event) {
    setDraggingChartId(chartId)
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', chartId)
  }

  function handleDrop(targetChartId, event) {
    event.preventDefault()
    const sourceChartId = event.dataTransfer.getData('text/plain') || draggingChartId
    moveChart(sourceChartId, targetChartId)
    setDraggingChartId('')
  }

  function buildFinalizedConfig() {
    return {
      version: 1,
      datasetId,
      fileName,
      savedAt: new Date().toISOString(),
      kpis: visibleKpiCards,
      charts: visibleCharts,
      chartOrder: visibleCharts.map((chart) => chart.id),
      settingsById,
      hiddenChartIds,
      hiddenKpiKeys,
      manualCharts,
      customChartsById,
      filterState,
      filterMetadata,
      kpiTextByKey,
      chartTextById,
    }
  }

  function finalizeDashboard() {
    const config = buildFinalizedConfig()
    saveDashboardConfig(datasetId, config)
    setFinalizedDashboard(config)
    setIsFinalized(true)
    setActiveEditor(null)
    setOpenChartMenuId('')
    setIsBuilderOpen(false)
    setDraggingChartId('')
  }

  function loadSavedDashboard() {
    const savedDashboard = getSavedDashboard(datasetId)
    if (!savedDashboard) {
      setDashboardError('No saved finalized dashboard configuration was found for this dataset.')
      return
    }

    setManualCharts(savedDashboard.manualCharts ?? [])
    setCustomChartsById(savedDashboard.customChartsById ?? {})
    setHiddenChartIds(savedDashboard.hiddenChartIds ?? [])
    setHiddenKpiKeys(savedDashboard.hiddenKpiKeys ?? [])
    setChartOrder(savedDashboard.chartOrder ?? savedDashboard.charts?.map((chart) => chart.id) ?? [])
    setSettingsById(savedDashboard.settingsById ?? {})
    setFilterState(savedDashboard.filterState ?? {})
    setFilterMetadata(savedDashboard.filterMetadata ?? filterMetadata)
    setKpiTextByKey(savedDashboard.kpiTextByKey ?? {})
    setChartTextById(savedDashboard.chartTextById ?? {})
    setFinalizedDashboard(savedDashboard)
    setIsFinalized(true)
    setDashboardError('')
  }

  function returnToEditMode() {
    setIsFinalized(false)
    setDashboardError('')
    setActiveEditor(null)
    setOpenChartMenuId('')
  }

  function updateGlobalFilter(column, value) {
    setFilterState((previous) => {
      const next = { ...previous }
      if (!value || Object.keys(value).length === 0) {
        delete next[column]
      } else {
        next[column] = value
      }
      return next
    })
  }

  function clearAllFilters() {
    setFilterState({})
  }

  function updateKpiText(textKey, field, value) {
    setKpiTextByKey((previous) => ({
      ...previous,
      [textKey]: {
        ...(previous[textKey] ?? {}),
        [field]: value,
      },
    }))
  }

  function updateChartText(chartId, field, value) {
    setChartTextById((previous) => ({
      ...previous,
      [chartId]: {
        ...(previous[chartId] ?? {}),
        [field]: value,
      },
    }))
  }

  async function captureDashboard() {
    if (!dashboardCaptureRef.current) {
      throw new Error('Dashboard view is not ready to export.')
    }

    return html2canvas(dashboardCaptureRef.current, {
      backgroundColor: '#f7f8f6',
      scale: 2,
      useCORS: true,
    })
  }

  async function exportDashboardPng() {
    setIsExporting(true)
    setDashboardError('')

    try {
      const canvas = await captureDashboard()
      const link = document.createElement('a')
      link.href = canvas.toDataURL('image/png')
      link.download = `${fileName || 'atlas-dashboard'}-dashboard.png`
      document.body.append(link)
      link.click()
      link.remove()
    } catch (error) {
      setDashboardError(error.message)
    } finally {
      setIsExporting(false)
    }
  }

  async function exportDashboardPdf() {
    setIsExporting(true)
    setDashboardError('')

    try {
      const canvas = await captureDashboard()
      const imageData = canvas.toDataURL('image/png')
      const pdf = new jsPDF({
        orientation: canvas.width >= canvas.height ? 'landscape' : 'portrait',
        unit: 'px',
        format: [canvas.width, canvas.height],
      })

      pdf.addImage(imageData, 'PNG', 0, 0, canvas.width, canvas.height)
      pdf.save(`${fileName || 'atlas-dashboard'}-dashboard.pdf`)
    } catch (error) {
      setDashboardError(error.message)
    } finally {
      setIsExporting(false)
    }
  }

  async function applyCustomization(chartId) {
    const chart = dashboardCharts.find((item) => item.id === chartId)
    const settings = settingsById[chartId] ?? buildDefaultSettings(chart, tableColumns, numericColumns)
    if (!settings || !hasDatasetPayload) {
      return
    }

    setApplyingChartId(chartId)
    setDashboardError('')

    try {
      const payload = await visualizeDatasetRows({
        columns: sourceColumns,
        rows: sourceRows,
        override: settings,
      })
      const customChart = payload.custom_chart
      if (customChart) {
        if (chart?.source === 'manual') {
          setManualCharts((previous) =>
            previous.map((item) =>
              item.id === chartId
                ? { ...customChart, id: chartId, source: 'manual', settings }
                : item,
            ),
          )
        } else {
          setCustomChartsById((previous) => ({
            ...previous,
            [chartId]: {
              ...customChart,
              id: chartId,
              settings,
            },
          }))
        }
        setActiveEditor(null)
      }
    } catch (error) {
      setDashboardError(error.message)
    } finally {
      setApplyingChartId('')
    }
  }

  if (!datasetId) {
    return (
      <div className="page-grid">
        <section className="panel empty-panel">
          <h2>No dataset available</h2>
          <p>Upload your file first before generating visualizations.</p>
          <Link to="/dataset" className="action-button">
            Go to Upload
          </Link>
        </section>
      </div>
    )
  }

  return (
    <div
      className={
        isFinalized
          ? 'visualization-workbench visualization-workbench--finalized'
          : 'visualization-workbench'
      }
    >
      <header className="visual-toolbar">
        <div>
          <span>
            {isFinalized
              ? 'Finalized dashboard'
              : cleanedProfile
                ? 'Edit mode / cleaned visualization'
                : 'Edit mode / latest visualization'}
          </span>
          <strong>{fileName || datasetId}</strong>
          {isFinalized && savedAtLabel ? <small>Saved {savedAtLabel}</small> : null}
        </div>
        <div className="visual-toolbar__actions">
          {isFinalized ? (
            <>
              <button
                type="button"
                className="visual-secondary-button"
                onClick={exportDashboardPng}
                disabled={isExporting || presentationCharts.length === 0}
              >
                {isExporting ? 'Exporting...' : 'Export PNG'}
              </button>
              <button
                type="button"
                className="visual-secondary-button"
                onClick={exportDashboardPdf}
                disabled={isExporting || presentationCharts.length === 0}
              >
                Export PDF
              </button>
              <button type="button" className="visual-secondary-button" onClick={returnToEditMode}>
                Back to Edit Mode
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="visual-apply-button"
                onClick={finalizeDashboard}
                disabled={visibleCharts.length === 0}
              >
                Finalize Dashboard
              </button>
              <button type="button" className="visual-secondary-button" onClick={loadSavedDashboard}>
                Load Saved
              </button>
              <button
                type="button"
                className="visual-secondary-button"
                onClick={regenerateDashboard}
                disabled={isLoading || !hasDatasetPayload}
              >
                {isLoading ? 'Generating...' : 'Regenerate'}
              </button>
              <Link to="/cleaning" className="visual-secondary-button">
                Back to Clean
              </Link>
            </>
          )}
        </div>
      </header>

      {errorMessage || dashboardError ? (
        <p className="visual-error-banner">{dashboardError || errorMessage}</p>
      ) : null}

      {!isFinalized ? (
        <GlobalFilterPanel
          filters={filterMetadata}
          filterState={filterState}
          activeFilters={activeFilters}
          disabled={isFiltering}
          onFilterChange={updateGlobalFilter}
          onClearFilters={clearAllFilters}
        />
      ) : null}

      <div ref={dashboardCaptureRef} className="visual-dashboard-capture">
        <section className="visual-kpi-grid">
          {presentationKpis.map((kpi, index) => (
            <KpiCard
              key={`${kpi.label}-${index}`}
              label={kpi.label}
              value={kpi.value}
              hint={kpi.hint}
              textKey={getKpiTextKey(kpi, index)}
              textOverride={presentationKpiText[getKpiTextKey(kpi, index)]}
              isFinalized={isFinalized}
              onEditText={(textKey, selectedKpi) =>
                setActiveEditor({ type: 'kpi', textKey, kpi: selectedKpi })
              }
              onRemove={removeKpi}
            />
          ))}
        </section>

        <main className="visual-dashboard-body">
          <section className="visual-chart-section">
            {!isFinalized ? (
              <div className="visual-section-title">
                <div>
                  <h2>Dashboard Charts</h2>
                  <p>{presentationCharts.length} visible charts</p>
                </div>
                {dashboard?.warnings?.length ? <span>{dashboard.warnings[0]}</span> : null}
              </div>
            ) : null}

            {presentationCharts.length > 0 ? (
              <div className="visual-chart-grid">
                {presentationCharts.map((chart) => (
                  <ChartCard
                    key={chart.id}
                    chart={chart}
                    isFinalized={isFinalized}
                    isMenuOpen={openChartMenuId === chart.id}
                    onToggleMenu={() =>
                      setOpenChartMenuId((current) => (current === chart.id ? '' : chart.id))
                    }
                    onCustomize={() => {
                      setActiveEditor({ type: 'chart', chartId: chart.id, mode: 'customize' })
                      setOpenChartMenuId('')
                    }}
                    onEditText={() => {
                      setActiveEditor({ type: 'chart', chartId: chart.id, mode: 'text' })
                      setOpenChartMenuId('')
                    }}
                    onRemove={() => removeChart(chart.id)}
                    isDragging={draggingChartId === chart.id}
                    onDragStart={(event) => handleDragStart(chart.id, event)}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => handleDrop(chart.id, event)}
                    onDragEnd={() => setDraggingChartId('')}
                    textOverride={presentationChartText[chart.id]}
                  />
                ))}
              </div>
            ) : (
              <div className="visual-empty-panel">
                <h3>No visible charts</h3>
                <p>Add a chart from the manual builder or regenerate the dashboard.</p>
              </div>
            )}
          </section>

          {!isFinalized ? (
            <ManualChartBuilder
              columns={tableColumns}
              numericColumns={numericColumns}
              settings={effectiveManualSettings}
              isOpen={isBuilderOpen}
              isRendering={isManualRendering}
              onToggle={() => setIsBuilderOpen((current) => !current)}
              onSettingChange={updateManualSetting}
              onRender={renderManualChart}
            />
          ) : null}

          {!isFinalized ? <FilteredDataTable columns={tableColumns} rows={tableRows} /> : null}
        </main>
      </div>

      {!isFinalized ? (
        <DashboardEditorPanel
          editor={activeEditor}
          chart={activeChart}
          kpi={activeEditor?.type === 'kpi' ? activeEditor.kpi : null}
          columns={tableColumns}
          numericColumns={numericColumns}
          settings={activeChartSettings ?? effectiveManualSettings}
          chartText={activeChart ? chartTextById[activeChart.id] : null}
          kpiText={activeEditor?.type === 'kpi' ? kpiTextByKey[activeEditor.textKey] : null}
          isApplying={activeChart ? applyingChartId === activeChart.id : false}
          onClose={() => setActiveEditor(null)}
          onSettingChange={updateSetting}
          onApplyChart={applyCustomization}
          onChartTextChange={updateChartText}
          onKpiTextChange={updateKpiText}
        />
      ) : null}
    </div>
  )
}

export default VisualizationPage
