import html2canvas from 'html2canvas'
import { jsPDF } from 'jspdf'
import { Component, useEffect, useMemo, useRef, useState } from 'react'
import Chart from 'react-apexcharts'
import { Link } from 'react-router-dom'
import { IconButtonContent } from '../components/AtlasBrand'
import { useAtlas } from '../context/AtlasContext'
import { formatValue } from '../utils/formatters'

const CHART_TYPE_OPTIONS = [
  { value: 'bar', label: 'Bar', icon: 'bar' },
  { value: 'horizontal-bar', label: 'Horizontal Bar', icon: 'horizontal-bar' },
  { value: 'line', label: 'Line', icon: 'line' },
  { value: 'area', label: 'Area', icon: 'area' },
  { value: 'pie', label: 'Pie', icon: 'pie' },
  { value: 'donut', label: 'Donut', icon: 'donut' },
  { value: 'scatter', label: 'Scatter', icon: 'scatter' },
  { value: 'histogram', label: 'Histogram', icon: 'histogram' },
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
const CANVAS_LAYOUT_PREFIX = 'atlas:blankCanvas:'
const DEFAULT_WORKSPACE_WIDGETS = {}
const BLANK_WORKSPACE_WIDGETS = {}
const CANVAS_SIZE = { width: 1440, height: 900 }
const CANVAS_PALETTE = [
  '#0f766e',
  '#2563eb',
  '#f59e0b',
  '#dc2626',
  '#7c3aed',
  '#0891b2',
  '#16a34a',
  '#db2777',
]
const CANVAS_ZOOM_OPTIONS = [
  { value: 'fit', label: 'Fit' },
  { value: '0.5', label: '50%' },
  { value: '0.75', label: '75%' },
  { value: '1', label: '100%' },
]
const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i

const CANVAS_VISUAL_TYPES = [
  { value: 'bar', label: 'Bar chart', icon: 'bar', kind: 'chart' },
  { value: 'horizontal-bar', label: 'Horizontal bar', icon: 'horizontal-bar', kind: 'chart' },
  { value: 'line', label: 'Line chart', icon: 'line', kind: 'chart' },
  { value: 'pie', label: 'Pie chart', icon: 'pie', kind: 'chart' },
  { value: 'donut', label: 'Donut chart', icon: 'donut', kind: 'chart' },
  { value: 'area', label: 'Area chart', icon: 'area', kind: 'chart' },
  { value: 'scatter', label: 'Scatter chart', icon: 'scatter', kind: 'chart' },
  { value: 'histogram', label: 'Histogram', icon: 'histogram', kind: 'chart' },
  { value: 'kpi', label: 'KPI card', icon: 'kpi', kind: 'kpi' },
  { value: 'table', label: 'Table', icon: 'table', kind: 'table' },
  { value: 'text', label: 'Text box', icon: 'text', kind: 'text' },
]

const FONT_FAMILY_OPTIONS = [
  { value: 'Inter, system-ui, sans-serif', label: 'Inter' },
  { value: 'Arial, sans-serif', label: 'Arial' },
  { value: 'Georgia, serif', label: 'Georgia' },
  { value: '"Courier New", monospace', label: 'Courier' },
]

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

function clampValue(value, min, max) {
  return Math.min(Math.max(value, min), max)
}

function normalizeNumber(value, fallback, min = -Infinity, max = Infinity) {
  const numericValue = Number(value)
  if (!Number.isFinite(numericValue)) {
    return fallback
  }

  return clampValue(numericValue, min, max)
}

function normalizeHexColor(value, fallback = '#ffffff') {
  return HEX_COLOR_PATTERN.test(String(value || '')) ? value : fallback
}

function normalizeStringField(value) {
  return typeof value === 'string' ? value : ''
}

function normalizeStringList(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : []
}

function normalizeCanvasChartType(type, fallback = 'bar') {
  return CHART_TYPE_OPTIONS.some((option) => option.value === type) ? type : fallback
}

function getChartTypeLabel(type) {
  return CHART_TYPE_OPTIONS.find((option) => option.value === type)?.label || 'Chart'
}

function normalizeColumnToken(value) {
  return String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_')
}

function isIdentifierLikeField(fieldName) {
  const normalized = normalizeColumnToken(fieldName)
  return normalized === 'id'
    || normalized.endsWith('_id')
    || normalized.endsWith('id')
    || normalized.includes('uuid')
    || normalized.includes('identifier')
}

function getColumnType(column, columns = []) {
  const profile = columns.find((item) => item.name === column)
  return profile?.type || profile?.dtype || ''
}

function getDisplayColumnType(column, columns = []) {
  const rawType = String(getColumnType(column, columns)).toLowerCase()

  if (rawType.includes('date') || rawType.includes('time')) {
    return 'date'
  }

  if (rawType.includes('numeric') || rawType.includes('int') || rawType.includes('float') || rawType.includes('number')) {
    return 'numeric'
  }

  return 'categorical'
}

function getAggregationLabel(aggregation) {
  const option = AGGREGATION_OPTIONS.find((item) => item.value === aggregation)
  return option?.label || 'Count'
}

function getMeasureField(visual) {
  return visual.fields?.y_axis || visual.fields?.values?.[0] || ''
}

function getDimensionField(visual) {
  return visual.fields?.x_axis || visual.fields?.label || ''
}

function getCanvasVisualTitle(visual) {
  if (visual.settings?.titleTouched && visual.settings?.title) {
    return visual.settings.title
  }

  if (visual.kind === 'text') {
    return visual.settings?.title || 'Text Box'
  }

  if (visual.kind === 'table') {
    const columns = Array.isArray(visual.fields?.values) ? visual.fields.values : []
    return columns.length ? `Table of ${columns.slice(0, 3).join(', ')}` : 'Data Table'
  }

  const aggregation = visual.settings?.aggregation || 'count'
  const aggregationLabel = getAggregationLabel(aggregation)
  const measure = getMeasureField(visual)
  const dimension = getDimensionField(visual)
  const chartType = visual.settings?.chart_type || visual.type

  if (chartType === 'histogram') {
    const histogramField = dimension || measure
    return histogramField ? `Distribution of ${histogramField}` : 'Histogram'
  }

  if (measure && dimension) {
    return `${aggregationLabel} of ${measure} by ${dimension}`
  }

  if (measure) {
    return `${aggregationLabel} of ${measure}`
  }

  if (dimension) {
    return `${aggregationLabel} of records by ${dimension}`
  }

  return visual.settings?.title || getVisualDefaults(visual.type).title
}

function getDraggedFieldName(event) {
  const transfer = event?.dataTransfer
  if (!transfer || typeof transfer.getData !== 'function') {
    return ''
  }

  try {
    return transfer.getData('application/x-atlas-field') || transfer.getData('text/plain') || ''
  } catch (error) {
    console.warn('Unable to read dragged field.', error)
    return ''
  }
}

function didLeaveElement(event) {
  const currentTarget = event?.currentTarget
  const relatedTarget = event?.relatedTarget

  if (!currentTarget || !relatedTarget) {
    return true
  }

  try {
    return !currentTarget.contains(relatedTarget)
  } catch {
    return true
  }
}

function getFieldWellWarning(fieldName, acceptedTypes, columnProfiles) {
  if (!fieldName || acceptedTypes.includes('any')) {
    return ''
  }

  const fieldType = getDisplayColumnType(fieldName, columnProfiles)
  if (acceptedTypes.includes(fieldType)) {
    return ''
  }

  const recommended = acceptedTypes.join(' or ')
  return `Recommended: ${recommended}. ${fieldType} is allowed.`
}

function getFieldWellsForVisual(visual) {
  const chartType = visual.settings?.chart_type || visual.type

  if (visual.kind === 'kpi') {
    return [
      { field: 'values', label: 'Value / Measure', acceptedTypes: ['numeric'], multiple: false },
      { field: 'label', label: 'Label / Optional Dimension', acceptedTypes: ['categorical', 'date'], multiple: false },
      { field: 'filters', label: 'Filter', acceptedTypes: ['any'], multiple: true },
    ]
  }

  if (visual.kind === 'table') {
    return [
      { field: 'values', label: 'Columns', acceptedTypes: ['any'], multiple: true },
      { field: 'filters', label: 'Filters', acceptedTypes: ['any'], multiple: true },
    ]
  }

  if (visual.kind !== 'chart') {
    return []
  }

  if (chartType === 'histogram') {
    return [
      { field: 'x_axis', label: 'Value / Bins', acceptedTypes: ['numeric'], multiple: false },
      { field: 'tooltip', label: 'Tooltip', acceptedTypes: ['any'], multiple: true },
      { field: 'filters', label: 'Filters', acceptedTypes: ['any'], multiple: true },
    ]
  }

  if (chartType === 'pie' || chartType === 'donut') {
    return [
      { field: 'x_axis', label: 'Category / Legend', acceptedTypes: ['categorical', 'date'], multiple: false },
      { field: 'y_axis', label: 'Values / Measure', acceptedTypes: ['numeric'], multiple: false },
      { field: 'tooltip', label: 'Tooltip', acceptedTypes: ['any'], multiple: true },
      { field: 'filters', label: 'Filters', acceptedTypes: ['any'], multiple: true },
    ]
  }

  if (chartType === 'line' || chartType === 'area') {
    return [
      { field: 'x_axis', label: 'X-axis / Date or Dimension', acceptedTypes: ['date', 'categorical'], multiple: false },
      { field: 'y_axis', label: 'Y-axis / Measure', acceptedTypes: ['numeric'], multiple: false },
      { field: 'legend', label: 'Legend / Group', acceptedTypes: ['categorical', 'date'], multiple: false },
      { field: 'tooltip', label: 'Tooltip', acceptedTypes: ['any'], multiple: true },
      { field: 'filters', label: 'Filters', acceptedTypes: ['any'], multiple: true },
    ]
  }

  if (chartType === 'scatter') {
    return [
      { field: 'x_axis', label: 'X-axis / Measure', acceptedTypes: ['numeric'], multiple: false },
      { field: 'y_axis', label: 'Y-axis / Measure', acceptedTypes: ['numeric'], multiple: false },
      { field: 'tooltip', label: 'Tooltip', acceptedTypes: ['any'], multiple: true },
      { field: 'filters', label: 'Filters', acceptedTypes: ['any'], multiple: true },
    ]
  }

  return [
    { field: 'x_axis', label: 'X-axis / Dimension', acceptedTypes: ['categorical', 'date'], multiple: false },
    { field: 'y_axis', label: 'Y-axis / Measure', acceptedTypes: ['numeric'], multiple: false },
    { field: 'legend', label: 'Legend / Group', acceptedTypes: ['categorical', 'date'], multiple: false },
    { field: 'tooltip', label: 'Tooltip', acceptedTypes: ['any'], multiple: true },
    { field: 'filters', label: 'Filters', acceptedTypes: ['any'], multiple: true },
  ]
}

function getVisualDefaults(type = 'bar') {
  const safeType = String(type || 'bar')

  if (safeType === 'kpi') {
    return { width: 260, height: 150, title: 'KPI Card' }
  }

  if (safeType === 'table') {
    return { width: 520, height: 280, title: 'Data Table' }
  }

  if (safeType === 'text') {
    return { width: 300, height: 160, title: 'Text Box' }
  }

  return { width: 420, height: 300, title: getChartTypeLabel(safeType) }
}

function createCanvasVisual(type, index = 0) {
  const safeType = CANVAS_VISUAL_TYPES.some((item) => item.value === type) ? type : 'bar'
  const visualType = CANVAS_VISUAL_TYPES.find((item) => item.value === safeType) ?? CANVAS_VISUAL_TYPES[0]
  const defaults = getVisualDefaults(safeType)
  const isChart = visualType.kind === 'chart'
  const isKpi = visualType.kind === 'kpi'

  return {
    id: `canvas-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    kind: visualType.kind,
    type: safeType,
    x: 32 + (index % 5) * 34,
    y: 34 + (index % 5) * 30,
    width: defaults.width,
    height: defaults.height,
    fields: {
      x_axis: '',
      y_axis: '',
      legend: '',
      label: '',
      tooltip: [],
      filters: [],
      filter: '',
      values: [],
    },
    settings: {
      chart_type: isChart ? safeType : 'bar',
      aggregation: isKpi ? 'count' : 'count',
      title: defaults.title,
      titleTouched: false,
      subtitle: '',
      caption: '',
      fontFamily: FONT_FAMILY_OPTIONS[0].value,
      fontSize: isKpi ? 26 : 13,
      color: CANVAS_PALETTE[index % CANVAS_PALETTE.length],
      secondaryColor: CANVAS_PALETTE[(index + 1) % CANVAS_PALETTE.length],
      backgroundColor: '#ffffff',
      borderRadius: 8,
      showLegend: true,
      showLabels: false,
    },
    content: 'Add your note here.',
  }
}

function normalizeCanvasVisual(rawVisual, index = 0) {
  const fallbackKind = rawVisual?.kind || 'chart'
  const rawType = rawVisual?.type || rawVisual?.settings?.chart_type || fallbackKind
  const type = CANVAS_VISUAL_TYPES.some((item) => item.value === rawType) ? rawType : 'bar'
  const visualType = CANVAS_VISUAL_TYPES.find((item) => item.value === type) ?? CANVAS_VISUAL_TYPES[0]
  const defaults = createCanvasVisual(type, index)
  const defaultColor = CANVAS_PALETTE[index % CANVAS_PALETTE.length]
  const defaultSecondaryColor = CANVAS_PALETTE[(index + 1) % CANVAS_PALETTE.length]
  const rawChartType = rawVisual?.settings?.chart_type || defaults.settings.chart_type
  const chartType = visualType.kind === 'chart' ? normalizeCanvasChartType(rawChartType, defaults.settings.chart_type) : 'bar'

  return {
    ...defaults,
    ...rawVisual,
    id: rawVisual?.id || `canvas-${index}`,
    kind: visualType.kind,
    type,
    x: normalizeNumber(rawVisual?.x, defaults.x, 0, CANVAS_SIZE.width - 120),
    y: normalizeNumber(rawVisual?.y, defaults.y, 0, CANVAS_SIZE.height - 90),
    width: normalizeNumber(rawVisual?.width, defaults.width, 160, CANVAS_SIZE.width),
    height: normalizeNumber(rawVisual?.height, defaults.height, 110, CANVAS_SIZE.height),
    fields: {
      ...defaults.fields,
      ...(rawVisual?.fields ?? {}),
      x_axis: normalizeStringField(rawVisual?.fields?.x_axis),
      y_axis: normalizeStringField(rawVisual?.fields?.y_axis),
      legend: normalizeStringField(rawVisual?.fields?.legend),
      label: normalizeStringField(rawVisual?.fields?.label),
      filter: normalizeStringField(rawVisual?.fields?.filter),
      tooltip: normalizeStringList(rawVisual?.fields?.tooltip),
      filters: normalizeStringList(rawVisual?.fields?.filters),
      values: normalizeStringList(rawVisual?.fields?.values),
    },
    settings: {
      ...defaults.settings,
      ...(rawVisual?.settings ?? {}),
      chart_type: chartType,
      aggregation: AGGREGATION_OPTIONS.some((option) => option.value === rawVisual?.settings?.aggregation)
        ? rawVisual.settings.aggregation
        : defaults.settings.aggregation,
      titleTouched: Boolean(rawVisual?.settings?.titleTouched),
      fontFamily: FONT_FAMILY_OPTIONS.some((option) => option.value === rawVisual?.settings?.fontFamily)
        ? rawVisual.settings.fontFamily
        : defaults.settings.fontFamily,
      fontSize: normalizeNumber(rawVisual?.settings?.fontSize, defaults.settings.fontSize, 10, 48),
      color: normalizeHexColor(rawVisual?.settings?.color, defaultColor),
      secondaryColor: normalizeHexColor(rawVisual?.settings?.secondaryColor, defaultSecondaryColor),
      backgroundColor: normalizeHexColor(rawVisual?.settings?.backgroundColor, '#ffffff'),
      borderRadius: normalizeNumber(rawVisual?.settings?.borderRadius, defaults.settings.borderRadius, 0, 28),
    },
    content: typeof rawVisual?.content === 'string' ? rawVisual.content : defaults.content,
  }
}

function updateCanvasVisualTitle(nextVisual) {
  if (nextVisual.settings?.titleTouched) {
    return nextVisual
  }

  return {
    ...nextVisual,
    settings: {
      ...nextVisual.settings,
      title: getCanvasVisualTitle(nextVisual),
    },
  }
}

function setCanvasField(visual, field, value, removeValue = false, multiple = false) {
  const isArrayField = multiple || ['values', 'tooltip', 'filters'].includes(field)

  if (isArrayField) {
    const currentValues = Array.isArray(visual.fields?.[field]) ? visual.fields[field] : []
    const nextValues = removeValue
      ? currentValues.filter((fieldName) => fieldName !== value)
      : multiple
        ? [...new Set([...currentValues, value])]
        : value
          ? [value]
          : []

    return updateCanvasVisualTitle({
      ...visual,
      fields: {
        ...visual.fields,
        [field]: nextValues,
      },
    })
  }

  return updateCanvasVisualTitle({
    ...visual,
    fields: {
      ...visual.fields,
      [field]: removeValue ? '' : value,
    },
  })
}

function smartAssignFieldToVisual(visual, fieldName, columnProfiles, targetField = 'auto') {
  const fieldType = getDisplayColumnType(fieldName, columnProfiles)
  let nextVisual = visual
  let resolvedTarget = targetField
  let multiple = ['tooltip', 'filters'].includes(targetField)

  if (targetField === 'auto') {
    if (visual.kind === 'table') {
      resolvedTarget = 'values'
      multiple = true
    } else if (visual.kind === 'kpi') {
      if (fieldType === 'numeric') {
        resolvedTarget = 'values'
      } else if (!visual.fields?.label) {
        resolvedTarget = 'label'
      } else {
        resolvedTarget = 'filters'
        multiple = true
      }
    } else if (visual.kind === 'chart') {
      const hasDimension = Boolean(visual.fields?.x_axis)
      const hasMeasure = Boolean(visual.fields?.y_axis)

      if (hasDimension && hasMeasure) {
        resolvedTarget = visual.fields?.legend ? 'tooltip' : 'legend'
        multiple = resolvedTarget === 'tooltip'
      } else if (fieldType === 'numeric' && !hasMeasure) {
        resolvedTarget = 'y_axis'
      } else if (!hasDimension) {
        resolvedTarget = 'x_axis'
      } else if (!hasMeasure) {
        resolvedTarget = 'y_axis'
      } else {
        resolvedTarget = 'legend'
      }
    } else {
      resolvedTarget = 'filters'
      multiple = true
    }
  }

  if (resolvedTarget === 'values') {
    multiple = visual.kind === 'table'
  }

  nextVisual = setCanvasField(nextVisual, resolvedTarget, fieldName, false, multiple)

  if (
    fieldType === 'numeric' &&
    ['y_axis', 'values'].includes(resolvedTarget) &&
    !isIdentifierLikeField(fieldName) &&
    (!visual.settings?.aggregation || visual.settings.aggregation === 'count')
  ) {
    nextVisual = updateCanvasVisualTitle({
      ...nextVisual,
      settings: {
        ...nextVisual.settings,
        aggregation: 'sum',
      },
    })
  }

  return nextVisual
}

function createCanvasVisualFromField(fieldName, columnProfiles, numericColumns, index = 0) {
  const fieldType = getDisplayColumnType(fieldName, columnProfiles)
  const isIdentifierField = isIdentifierLikeField(fieldName)
  const chartType = fieldType === 'numeric' && !isIdentifierField
    ? 'kpi'
    : fieldType === 'date' && numericColumns.length
      ? 'line'
      : 'bar'
  let visual = createCanvasVisual(chartType, index)

  if (fieldType === 'numeric' && !isIdentifierField) {
    visual = setCanvasField(visual, 'values', fieldName)
    visual = updateCanvasVisualTitle({
      ...visual,
      settings: {
        ...visual.settings,
        aggregation: 'sum',
      },
    })
  } else if (fieldType === 'numeric') {
    visual = setCanvasField(visual, 'x_axis', fieldName)
  } else if (fieldType === 'date' && numericColumns.length) {
    visual = setCanvasField(visual, 'x_axis', fieldName)
    visual = setCanvasField(visual, 'y_axis', numericColumns[0])
    visual = updateCanvasVisualTitle({
      ...visual,
      settings: {
        ...visual.settings,
        aggregation: 'sum',
      },
    })
  } else {
    visual = setCanvasField(visual, 'x_axis', fieldName)
  }

  return updateCanvasVisualTitle(visual)
}

function getFieldDropPreview(fieldName, columnProfiles, numericColumns, targetVisual = null, targetField = 'auto') {
  if (!fieldName) {
    return ''
  }

  const previewVisual = targetVisual
    ? smartAssignFieldToVisual(targetVisual, fieldName, columnProfiles, targetField)
    : createCanvasVisualFromField(fieldName, columnProfiles, numericColumns)

  return getCanvasVisualTitle(previewVisual)
}

function formatCanvasLabel(value) {
  if (value === null || value === undefined || value === '') {
    return 'Missing'
  }

  return String(value)
}

function aggregateCanvasValues(values, aggregation) {
  if (aggregation === 'count') {
    return values.length
  }

  const numericValues = values.map((value) => Number(value)).filter(Number.isFinite)
  if (!numericValues.length) {
    return null
  }

  if (aggregation === 'sum') {
    return numericValues.reduce((sum, value) => sum + value, 0)
  }

  if (aggregation === 'average') {
    return numericValues.reduce((sum, value) => sum + value, 0) / numericValues.length
  }

  if (aggregation === 'min') {
    return Math.min(...numericValues)
  }

  if (aggregation === 'max') {
    return Math.max(...numericValues)
  }

  return numericValues.length
}

function buildHistogramBuckets(values) {
  const numericValues = values.map((value) => Number(value)).filter(Number.isFinite)
  if (!numericValues.length) {
    return { labels: [], values: [] }
  }

  const minValue = Math.min(...numericValues)
  const maxValue = Math.max(...numericValues)
  if (minValue === maxValue) {
    return {
      labels: [formatValue(minValue)],
      values: [numericValues.length],
    }
  }

  const bucketCount = clampValue(Math.ceil(Math.sqrt(numericValues.length)), 5, 12)
  const bucketSize = (maxValue - minValue) / bucketCount
  const buckets = Array.from({ length: bucketCount }, (_, index) => {
    const start = minValue + index * bucketSize
    const end = index === bucketCount - 1 ? maxValue : start + bucketSize
    return {
      start,
      end,
      count: 0,
    }
  })

  for (const value of numericValues) {
    const bucketIndex = value === maxValue
      ? bucketCount - 1
      : clampValue(Math.floor((value - minValue) / bucketSize), 0, bucketCount - 1)
    buckets[bucketIndex].count += 1
  }

  return {
    labels: buckets.map((bucket) => `${formatValue(Number(bucket.start.toFixed(2)))}-${formatValue(Number(bucket.end.toFixed(2)))}`),
    values: buckets.map((bucket) => bucket.count),
  }
}

function buildCanvasChart(visual, rows) {
  const chartType = visual.settings?.chart_type || visual.type || 'bar'
  const apexType = ['histogram', 'horizontal-bar'].includes(chartType) ? 'bar' : chartType
  const xAxis = visual.fields?.x_axis || ''
  const yAxis = visual.fields?.y_axis || ''
  const legendField = visual.fields?.legend || ''
  const aggregation = visual.settings?.aggregation || 'count'
  const title = getCanvasVisualTitle(visual)
  const subtitle = visual.settings?.subtitle || ''
  const histogramAxis = chartType === 'histogram' ? xAxis || yAxis : ''
  const colors = [visual.settings?.color || CANVAS_PALETTE[0], visual.settings?.secondaryColor || CANVAS_PALETTE[1], ...CANVAS_PALETTE]
  const baseOptions = {
    chart: {
      id: visual.id,
      background: 'transparent',
      foreColor: '#47564d',
      toolbar: { show: false },
      zoom: { enabled: false },
      animations: { enabled: true },
    },
    colors,
    dataLabels: { enabled: Boolean(visual.settings?.showLabels) },
    grid: { borderColor: '#dfe7e1', strokeDashArray: 4 },
    legend: {
      show: Boolean(visual.settings?.showLegend),
      position: 'bottom',
      labels: { colors: '#47564d' },
    },
    stroke: { curve: 'smooth', width: 3 },
    plotOptions: {
      line: { isSlopeChart: false },
      bar: {},
      pie: {},
    },
    tooltip: { theme: 'light' },
    title: { text: '' },
    subtitle: { text: '' },
    noData: { text: 'Drag fields here to build this visual.' },
  }

  if (
    (!xAxis && chartType !== 'histogram')
    || (chartType === 'histogram' && !histogramAxis)
    || !rows.length
    || (aggregation !== 'count' && !yAxis && chartType !== 'histogram')
  ) {
    return {
      id: visual.id,
      title,
      description: 'Drag fields here to build this visual.',
      type: APEX_TYPES.has(apexType) ? apexType : 'bar',
      chart_type: chartType,
      x_axis: xAxis,
      y_axis: yAxis,
      series: [],
      options: baseOptions,
      empty: true,
    }
  }

  if (chartType === 'histogram') {
    const histogram = buildHistogramBuckets(rows.map((row) => row[histogramAxis]))

    return {
      id: visual.id,
      title,
      description: subtitle || `Distribution of ${histogramAxis}.`,
      type: 'bar',
      chart_type: 'histogram',
      x_axis: histogramAxis,
      y_axis: '',
      series: [{ name: 'Records', data: histogram.values }],
      options: {
        ...baseOptions,
        plotOptions: {
          ...(baseOptions.plotOptions ?? {}),
          bar: {
            borderRadius: 4,
            columnWidth: '92%',
          },
        },
        xaxis: {
          type: 'category',
          categories: histogram.labels,
          labels: { style: { colors: '#718178' }, rotate: -35, trim: true },
        },
        yaxis: { labels: { style: { colors: '#718178' } } },
      },
      empty: histogram.values.length === 0,
    }
  }

  if (chartType === 'scatter') {
    if (!yAxis) {
      return {
        id: visual.id,
        title,
        description: 'Drag fields here to build this visual.',
        type: 'scatter',
        chart_type: 'scatter',
        x_axis: xAxis,
        y_axis: yAxis,
        series: [],
        options: baseOptions,
        empty: true,
      }
    }

    const data = rows
      .map((row) => ({ x: Number(row[xAxis]), y: Number(row[yAxis]) }))
      .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
      .slice(0, 350)

    return {
      id: visual.id,
      title,
      description: subtitle,
      type: 'scatter',
      chart_type: 'scatter',
      x_axis: xAxis,
      y_axis: yAxis,
      series: [{ name: yAxis || 'Value', data }],
      options: {
        ...baseOptions,
        markers: { size: 5, strokeWidth: 0 },
        xaxis: {
          type: 'numeric',
          title: { text: xAxis, style: { color: '#718178' } },
          labels: { style: { colors: '#718178' } },
        },
        yaxis: { labels: { style: { colors: '#718178' } } },
      },
      empty: data.length === 0,
    }
  }

  const grouped = new Map()
  rows.forEach((row) => {
    const label = formatCanvasLabel(row[xAxis])
    const groupLabel = legendField ? formatCanvasLabel(row[legendField]) : '__single__'
    const legendBuckets = grouped.get(label) ?? new Map()
    const currentValues = legendBuckets.get(groupLabel) ?? []
    currentValues.push(yAxis ? row[yAxis] : 1)
    legendBuckets.set(groupLabel, currentValues)
    grouped.set(label, legendBuckets)
  })

  const pairs = [...grouped.entries()]
    .map(([label, legendBuckets]) => {
      const total = [...legendBuckets.values()]
        .map((values) => aggregateCanvasValues(values, aggregation))
        .filter((value) => value !== null && value !== undefined)
        .reduce((sum, value) => sum + Number(value), 0)

      return [label, total, legendBuckets]
    })
    .filter(([, value]) => value !== null && value !== undefined)
    .sort((left, right) => {
      if (['line', 'area'].includes(chartType)) {
        return String(left[0]).localeCompare(String(right[0]), undefined, { numeric: true })
      }

      return Number(right[1]) - Number(left[1])
    })
    .slice(0, 18)

  const labels = pairs.map(([label]) => label)
  const values = pairs.map(([, value]) => Number(value.toFixed ? value.toFixed(2) : value))
  const legendValues = legendField
    ? [
        ...new Set(
          pairs.flatMap(([, , legendBuckets]) => [...legendBuckets.keys()]),
        ),
      ].slice(0, 8)
    : []

  if (chartType === 'pie' || chartType === 'donut') {
    const piePairs = labels
      .map((label, index) => ({ label, value: values[index] }))
      .filter((pair) => Number.isFinite(pair.value) && pair.value > 0)

    return {
      id: visual.id,
      title,
      description: subtitle,
      type: chartType,
      chart_type: chartType,
      x_axis: xAxis,
      y_axis: yAxis,
      series: piePairs.map((pair) => pair.value),
      options: {
        ...baseOptions,
        labels: piePairs.map((pair) => pair.label),
        stroke: { width: 1, colors: ['#ffffff'] },
        plotOptions: {
          ...baseOptions.plotOptions,
          pie: chartType === 'donut' ? { donut: { size: '62%' } } : {},
        },
      },
      empty: piePairs.length === 0,
    }
  }

  return {
    id: visual.id,
    title,
    description: subtitle,
    type: chartType === 'area' ? 'area' : chartType === 'line' ? 'line' : 'bar',
    chart_type: chartType,
    x_axis: xAxis,
    y_axis: yAxis,
    series: legendValues.length
      ? legendValues.map((legendValue) => ({
          name: legendValue,
          data: pairs.map(([, , legendBuckets]) => {
            const valuesForLegend = legendBuckets.get(legendValue) ?? []
            const aggregatedValue = aggregateCanvasValues(valuesForLegend, aggregation)
            return aggregatedValue === null || aggregatedValue === undefined
              ? 0
              : Number(aggregatedValue.toFixed ? aggregatedValue.toFixed(2) : aggregatedValue)
          }),
        }))
      : [{ name: aggregation === 'count' ? 'Records' : yAxis || 'Value', data: values }],
    options: {
      ...baseOptions,
      plotOptions: {
        ...(baseOptions.plotOptions ?? {}),
        bar: {
          ...(baseOptions.plotOptions?.bar ?? {}),
          horizontal: chartType === 'horizontal-bar',
          borderRadius: 4,
        },
      },
      xaxis: {
        type: 'category',
        categories: labels,
        labels: { style: { colors: '#718178' }, rotate: -35, trim: true },
      },
      yaxis: { labels: { style: { colors: '#718178' } } },
    },
    empty: values.length === 0,
  }
}

function buildSafeCanvasChart(visual, rows) {
  try {
    return buildCanvasChart(visual, Array.isArray(rows) ? rows : [])
  } catch (error) {
    console.error('Unable to render canvas chart.', error)
    return {
      id: visual?.id ?? 'canvas-chart',
      title: visual ? getCanvasVisualTitle(visual) : 'Chart',
      description: 'This visual could not be rendered. Try changing the assigned fields.',
      type: 'bar',
      chart_type: 'bar',
      x_axis: '',
      y_axis: '',
      series: [],
      options: {
        chart: { toolbar: { show: false }, background: 'transparent' },
        noData: { text: 'This visual could not be rendered.' },
      },
      empty: true,
    }
  }
}

function getSafeCanvasVisualFrame(visual) {
  const defaults = getVisualDefaults(visual?.type)

  return {
    x: normalizeNumber(visual?.x, 0, 0, CANVAS_SIZE.width - 120),
    y: normalizeNumber(visual?.y, 0, 0, CANVAS_SIZE.height - 90),
    width: normalizeNumber(visual?.width, defaults.width, 160, CANVAS_SIZE.width),
    height: normalizeNumber(visual?.height, defaults.height, 110, CANVAS_SIZE.height),
  }
}

function getCanvasElementSize(canvasElement) {
  const rect = canvasElement?.getBoundingClientRect?.()
  const width = Math.max(CANVAS_SIZE.width, Math.round(rect?.width || canvasElement?.clientWidth || CANVAS_SIZE.width))
  const height = Math.max(CANVAS_SIZE.height, Math.round(rect?.height || canvasElement?.clientHeight || CANVAS_SIZE.height))

  return { width, height }
}

function getCanvasVisualRenderKey(visual) {
  try {
    return JSON.stringify({
      id: visual?.id,
      kind: visual?.kind,
      type: visual?.type,
      x: visual?.x,
      y: visual?.y,
      width: visual?.width,
      height: visual?.height,
      fields: visual?.fields,
      settings: visual?.settings,
      content: visual?.content,
    })
  } catch {
    return `${visual?.id ?? 'visual'}:${visual?.kind ?? ''}:${visual?.type ?? ''}`
  }
}

function computeCanvasKpi(visual, rows) {
  const safeRows = Array.isArray(rows) ? rows : []
  const field = visual.fields?.values?.[0] || visual.fields?.y_axis || ''
  const aggregation = visual.settings?.aggregation || 'count'
  const values = field ? safeRows.map((row) => row[field]) : safeRows
  const rawValue = aggregateCanvasValues(values, aggregation)
  const labelField = visual.fields?.label || ''

  return {
    label: getCanvasVisualTitle(visual),
    value: formatValue(rawValue ?? safeRows.length),
    hint: visual.settings?.subtitle || (labelField ? `Filtered by ${labelField}` : field || 'Filtered rows'),
  }
}

function getKpiTextKey(kpi, index) {
  return `${kpi.type || 'kpi'}:${kpi.label || index}`
}

function getKpiInstanceKey(kpi, index) {
  return kpi.id || getKpiTextKey(kpi, index)
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

function getCanvasLayoutKey(datasetId) {
  return `${CANVAS_LAYOUT_PREFIX}${datasetId || 'workspace'}`
}

function getSavedCanvasLayout(datasetId) {
  if (typeof window === 'undefined' || !datasetId) {
    return null
  }

  const rawValue = window.localStorage.getItem(getCanvasLayoutKey(datasetId))
  if (!rawValue) {
    return null
  }

  try {
    return JSON.parse(rawValue)
  } catch {
    return null
  }
}

function saveCanvasLayout(datasetId, layout) {
  if (typeof window === 'undefined' || !datasetId) {
    return
  }

  window.localStorage.setItem(getCanvasLayoutKey(datasetId), JSON.stringify(layout))
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

function NoteCard({ note, isFinalized, onEdit, onRemove }) {
  return (
    <article className="visual-note-card">
      <div>
        <span>Note</span>
        <h3>{note.title || 'Untitled Note'}</h3>
        {note.body ? <p>{note.body}</p> : null}
      </div>

      {!isFinalized ? (
        <div className="visual-kpi-actions">
          <button type="button" className="visual-card-edit-button" onClick={onEdit}>
            Edit
          </button>
          <button type="button" className="visual-card-remove-button" onClick={onRemove}>
            Remove
          </button>
        </div>
      ) : null}
    </article>
  )
}

function WorkspaceControlPanel({
  mode,
  widgetCount,
  isLoading,
  statusText = '',
  showWidgetBar = true,
  onBlankWorkspace,
  onSuggestedWorkspace,
  onAddChart,
  onAddKpi,
  onAddNote,
}) {
  return (
    <section className="visual-workspace-panel">
      <header className="visual-section-title">
        <div>
          <h2>Workspace Sheet</h2>
          <p>
            {mode === 'blank' ? `Blank sheet / ${widgetCount} widgets` : `Suggested sheet / ${widgetCount} widgets`}
            {statusText ? ` / ${statusText}` : ''}
          </p>
        </div>
        <div className="visual-workspace-actions">
          <button type="button" className="visual-secondary-button" onClick={onBlankWorkspace}>
            <IconButtonContent icon="plus" label="New blank sheet" showLabel />
          </button>
          <button
            type="button"
            className="visual-secondary-button"
            onClick={onSuggestedWorkspace}
            disabled={isLoading}
          >
            <IconButtonContent icon="load" label="Use suggested" showLabel />
          </button>
        </div>
      </header>

      {showWidgetBar ? (
        <div className="visual-widget-bar" aria-label="Add dashboard widgets">
          <button type="button" className="visual-widget-button" onClick={onAddChart}>
            <IconButtonContent icon="visualize" label="Chart" showLabel />
          </button>
          <button type="button" className="visual-widget-button" onClick={onAddKpi}>
            <IconButtonContent icon="analyze" label="KPI" showLabel />
          </button>
          <button type="button" className="visual-widget-button" onClick={onAddNote}>
            <IconButtonContent icon="edit" label="Note" showLabel />
          </button>
        </div>
      ) : null}
    </section>
  )
}

function ChartTypeIcon({ type }) {
  return <span className={`visual-chart-type-icon visual-chart-type-icon--${type}`} aria-hidden="true" />
}

function ChartTypeSelector({ value, onChange }) {
  return (
    <div className="visual-chart-type-selector" role="radiogroup" aria-label="Chart type">
      {CHART_TYPE_OPTIONS.map((option) => (
        <button
          key={`chart-type-${option.value}`}
          type="button"
          className={
            value === option.value
              ? 'visual-chart-type-button visual-chart-type-button--active'
              : 'visual-chart-type-button'
          }
          onClick={() => onChange(option.value)}
          aria-pressed={value === option.value}
        >
          <ChartTypeIcon type={option.icon} />
          <span>{option.label}</span>
        </button>
      ))}
    </div>
  )
}

function getChartFilterColumn(chart) {
  return chart?.x_axis || chart?.dimension || ''
}

function normalizeCategoryFilterValue(value) {
  if (value === null || value === undefined) {
    return 'Missing'
  }

  return String(value)
}

function normalizeDateFilterValue(value) {
  if (value === null || value === undefined) {
    return ''
  }

  const rawValue = String(value)
  const isoDateMatch = rawValue.match(/^\d{4}-\d{2}-\d{2}/)
  if (isoDateMatch) {
    return isoDateMatch[0]
  }

  const parsedDate = new Date(rawValue)
  return Number.isNaN(parsedDate.getTime()) ? rawValue : parsedDate.toISOString().slice(0, 10)
}

function getFilterDisplayValue(value) {
  const displayValue = normalizeCategoryFilterValue(value).trim()
  return displayValue || 'Blank'
}

function parseNumericFilterRange(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? { min: value, max: value } : null
  }

  const label = String(value ?? '').trim()
  const rangeMatch = label.match(
    /^[[(]?\s*([+-]?\d+(?:\.\d+)?(?:e[+-]?\d+)?)\s*(?:,|to|\s+-\s+)\s*([+-]?\d+(?:\.\d+)?(?:e[+-]?\d+)?)\s*[\])]?$/i,
  )

  if (rangeMatch) {
    const minValue = Number(rangeMatch[1])
    const maxValue = Number(rangeMatch[2])
    if (Number.isFinite(minValue) && Number.isFinite(maxValue)) {
      return { min: Math.min(minValue, maxValue), max: Math.max(minValue, maxValue) }
    }
  }

  const numericValue = Number(label)
  return Number.isFinite(numericValue) ? { min: numericValue, max: numericValue } : null
}

function formatActiveFilterValue(filter, state) {
  if (filter.type === 'datetime') {
    if (state.start && state.end && state.start === state.end) {
      return state.start
    }

    return `${state.start || filter.start || 'Start'} to ${state.end || filter.end || 'End'}`
  }

  if (filter.type === 'numeric') {
    const minValue = state.min ?? filter.min
    const maxValue = state.max ?? filter.max

    if (minValue !== undefined && maxValue !== undefined && Number(minValue) === Number(maxValue)) {
      return formatValue(minValue)
    }

    return `${formatValue(minValue)} to ${formatValue(maxValue)}`
  }

  return (state.values ?? []).map(getFilterDisplayValue).join(', ')
}

function buildChartFilterState(filter, rawValue) {
  if (!filter) {
    return null
  }

  if (filter.type === 'datetime') {
    const dateValue = normalizeDateFilterValue(rawValue)
    return dateValue ? { start: dateValue, end: dateValue } : null
  }

  if (filter.type === 'numeric') {
    return parseNumericFilterRange(rawValue)
  }

  return { values: [normalizeCategoryFilterValue(rawValue)] }
}

function chartPointMatchesFilter(filter, state, rawValue) {
  if (!filter || !state) {
    return false
  }

  if (filter.type === 'datetime') {
    const dateValue = normalizeDateFilterValue(rawValue)
    return Boolean(dateValue && state.start === dateValue && state.end === dateValue)
  }

  if (filter.type === 'numeric') {
    const numericRange = parseNumericFilterRange(rawValue)
    return (
      Boolean(numericRange) &&
      Number(state.min) === numericRange.min &&
      Number(state.max) === numericRange.max
    )
  }

  const selectedValues = state.values ?? []
  const selectedValue = normalizeCategoryFilterValue(rawValue)
  return selectedValues.length === 1 && selectedValues[0] === selectedValue
}

function filterStatesMatch(filter, leftState, rightState) {
  if (!filter || !leftState || !rightState) {
    return false
  }

  if (filter.type === 'datetime') {
    return leftState.start === rightState.start && leftState.end === rightState.end
  }

  if (filter.type === 'numeric') {
    return Number(leftState.min) === Number(rightState.min) && Number(leftState.max) === Number(rightState.max)
  }

  const leftValues = leftState.values ?? []
  const rightValues = rightState.values ?? []
  return leftValues.length === 1 && rightValues.length === 1 && leftValues[0] === rightValues[0]
}

function resolveChartPointValue(chart, sourceOptions, series, config) {
  const dataPointIndex = config?.dataPointIndex
  if (dataPointIndex === undefined || dataPointIndex < 0) {
    return null
  }

  if (chart?.type === 'pie' || chart?.type === 'donut') {
    return sourceOptions.labels?.[dataPointIndex] ?? null
  }

  const seriesIndex = config?.seriesIndex >= 0 ? config.seriesIndex : 0
  const point = series?.[seriesIndex]?.data?.[dataPointIndex]

  if (point && typeof point === 'object' && !Array.isArray(point)) {
    if (Object.hasOwn(point, 'x')) {
      return point.x
    }

    if (Object.hasOwn(point, 'label')) {
      return point.label
    }
  }

  if (Array.isArray(point)) {
    return point[0]
  }

  return sourceOptions.xaxis?.categories?.[dataPointIndex] ?? point ?? null
}

function getChartPointValues(chart, sourceOptions, series) {
  if (chart?.type === 'pie' || chart?.type === 'donut') {
    return sourceOptions.labels ?? []
  }

  if (Array.isArray(sourceOptions.xaxis?.categories) && sourceOptions.xaxis.categories.length) {
    return sourceOptions.xaxis.categories
  }

  const data = series?.[0]?.data ?? []
  return data.map((point) => {
    if (point && typeof point === 'object' && !Array.isArray(point)) {
      return Object.hasOwn(point, 'x') ? point.x : point.label
    }

    return Array.isArray(point) ? point[0] : point
  })
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
  filterMetadataByColumn,
  filterState,
  onChartValueSelect,
}) {
  const apexType = APEX_TYPES.has(chart?.type) ? chart.type : 'bar'
  const series = Array.isArray(chart?.series) ? chart.series : []
  const sourceOptions = chart?.options ?? {}
  const filterColumn = getChartFilterColumn(chart)
  const chartFilter = filterColumn ? filterMetadataByColumn?.get(filterColumn) : null
  const chartFilterState = filterColumn ? filterState?.[filterColumn] : null
  const isFilterableChart = Boolean(
    !chart?.empty &&
      chartFilter &&
      onChartValueSelect,
  )
  const pointValues = getChartPointValues(chart, sourceOptions, series)
  const selectedPointIndex =
    chartFilter && chartFilterState
      ? pointValues.findIndex((value) => chartPointMatchesFilter(chartFilter, chartFilterState, value))
      : -1
  const sourceChartOptions = sourceOptions.chart ?? {}
  const sourceEvents = sourceChartOptions.events ?? {}
  const options = {
    ...sourceOptions,
    chart: {
      ...sourceChartOptions,
      toolbar: { show: false },
      events: {
        ...sourceEvents,
        dataPointSelection: (event, chartContext, config) => {
          if (typeof sourceEvents.dataPointSelection === 'function') {
            sourceEvents.dataPointSelection(event, chartContext, config)
          }

          if (!isFilterableChart) {
            return
          }

          const selectedValue = resolveChartPointValue(chart, sourceOptions, series, config)
          if (selectedValue === null || selectedValue === undefined) {
            return
          }

          onChartValueSelect(filterColumn, selectedValue)
        },
      },
    },
    title: { text: '' },
    subtitle: { text: '' },
    tooltip: {
      ...(sourceOptions.tooltip ?? {}),
      shared: false,
      intersect: true,
    },
  }
  const displayTitle = textOverride.title || chart?.title || 'Auto Chart'
  const displayDescription = textOverride.subtitle || ''
  const displayCaption = textOverride.caption || ''

  if (isFilterableChart && ['line', 'area', 'scatter'].includes(apexType)) {
    const sourceMarkerSize = Number(sourceOptions.markers?.size ?? 4)
    options.markers = {
      ...(sourceOptions.markers ?? {}),
      size: sourceMarkerSize > 0 ? sourceMarkerSize : 4,
    }
  }

  if (isFilterableChart && selectedPointIndex >= 0) {
    const selectedColor = '#0f766e'
    const mutedColor = '#d7e0db'

    if (apexType === 'pie' || apexType === 'donut') {
      options.colors = pointValues.map((_, index) => (index === selectedPointIndex ? selectedColor : mutedColor))
    } else if (apexType === 'bar') {
      options.colors = pointValues.map((_, index) => (index === selectedPointIndex ? selectedColor : mutedColor))
      options.legend = { ...(sourceOptions.legend ?? {}), show: false }
      options.plotOptions = {
        ...(sourceOptions.plotOptions ?? {}),
        bar: {
          ...(sourceOptions.plotOptions?.bar ?? {}),
          distributed: true,
        },
      }
    } else {
      options.markers = {
        ...(options.markers ?? {}),
        discrete: [
          ...(options.markers?.discrete ?? []),
          {
            seriesIndex: 0,
            dataPointIndex: selectedPointIndex,
            fillColor: selectedColor,
            strokeColor: '#0b4f49',
            size: 7,
          },
        ],
      }
    }
  }

  return (
    <article
      className={
        [
          'visual-chart-card',
          isDragging ? 'visual-chart-card--dragging' : '',
          isFilterableChart ? 'visual-chart-card--filterable' : '',
          selectedPointIndex >= 0 ? 'visual-chart-card--filtered' : '',
        ]
          .filter(Boolean)
          .join(' ')
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
          <ChartRenderErrorBoundary
            resetKey={`${chart?.id}:${apexType}:${chart?.x_axis}:${chart?.y_axis}:${series.length}`}
          >
            <Chart options={options} series={series} type={apexType} height={210} width="100%" />
          </ChartRenderErrorBoundary>
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
          <IconButtonContent icon={isOpen ? 'close' : 'plus'} label={isOpen ? 'Close builder' : 'Create new chart'} showLabel />
        </button>
      </header>

      {isOpen ? (
        <>
          <ChartTypeSelector
            value={settings.chart_type}
            onChange={(value) => onSettingChange('chart_type', value)}
          />

          <div className="visual-builder-grid">
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
              <IconButtonContent icon="plus" label={isRendering ? 'Adding' : 'Add chart'} showLabel />
            </button>
          </div>
        </>
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

function ActiveFilterChips({
  activeFilters,
  disabled,
  onRemoveFilter,
  onClearFilters,
}) {
  return (
    <section className="visual-active-filter-bar" aria-label="Active dashboard filters">
      <div className="visual-active-filter-title">
        <span>Active Filters</span>
        <p>
          {activeFilters.length
            ? `${activeFilters.length} chart ${activeFilters.length === 1 ? 'filter' : 'filters'} applied`
            : 'Click a chart value to filter the dashboard.'}
        </p>
      </div>

      {activeFilters.length ? (
        <div className="visual-active-filter-list">
          {activeFilters.map((filter) => (
            <button
              type="button"
              className="visual-filter-chip"
              key={`${filter.column}-${filter.valueLabel}`}
              onClick={() => onRemoveFilter(filter.column)}
              disabled={disabled}
              title={`Remove ${filter.label}`}
            >
              <span>{filter.column}:</span>
              <strong>{filter.valueLabel}</strong>
              <small aria-hidden="true">x</small>
            </button>
          ))}
        </div>
      ) : null}

      {activeFilters.length > 1 ? (
        <button
          type="button"
          className="visual-clear-filters"
          onClick={onClearFilters}
          disabled={disabled}
        >
          Clear All
        </button>
      ) : null}
    </section>
  )
}

class CanvasBuilderErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, errorInfo) {
    console.error('Blank canvas builder crashed.', error, errorInfo)
  }

  componentDidUpdate(previousProps) {
    if (previousProps.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null })
    }
  }

  render() {
    if (this.state.error) {
      return (
        <section className="visual-error-banner visual-builder-error" role="alert">
          <div>
            <h2>Dashboard builder display issue</h2>
            <p>One visual could not render, so the builder was paused instead of showing a blank page.</p>
          </div>
          {this.props.onReset ? (
            <button type="button" className="visual-secondary-button" onClick={this.props.onReset}>
              Reset blank sheet
            </button>
          ) : null}
        </section>
      )
    }

    return this.props.children
  }
}

class ChartRenderErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, errorInfo) {
    console.error('Chart visual crashed.', error, errorInfo)
  }

  componentDidUpdate(previousProps) {
    if (previousProps.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null })
    }
  }

  render() {
    if (this.state.error) {
      return (
        <div className="blank-visual-empty blank-visual-empty--error">
          This chart could not render. Change the chart type or assigned fields.
        </div>
      )
    }

    return this.props.children
  }
}

class CanvasVisualErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, errorInfo) {
    console.error('Canvas visual crashed.', error, errorInfo)
  }

  componentDidUpdate(previousProps) {
    if (previousProps.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null })
    }
  }

  render() {
    if (this.state.error) {
      const visual = this.props.visual
      const frame = getSafeCanvasVisualFrame(visual)
      const visualStyle = {
        width: frame.width,
        height: frame.height,
        transform: `translate(${frame.x}px, ${frame.y}px)`,
      }

      return (
        <article className="blank-canvas-visual blank-canvas-visual--error" style={visualStyle}>
          <header className="blank-visual-handle">
            <span>visual</span>
            {this.props.onRemove && visual?.id ? (
              <button type="button" aria-label="Remove visual" onClick={() => this.props.onRemove(visual.id)}>
                x
              </button>
            ) : null}
          </header>
          <div className="blank-visual-empty blank-visual-empty--error">
            This visual could not render. Remove it or assign different fields.
          </div>
        </article>
      )
    }

    return this.props.children
  }
}

function CanvasChartVisual({
  visual,
  rows,
  filterMetadataByColumn,
  filterState,
  onChartValueSelect,
}) {
  const chart = buildSafeCanvasChart(visual, rows)
  const frame = getSafeCanvasVisualFrame(visual)
  const apexType = APEX_TYPES.has(chart?.type) ? chart.type : 'bar'
  const series = Array.isArray(chart?.series) ? chart.series : []
  const sourceOptions = chart?.options ?? {}
  const filterColumn = getChartFilterColumn(chart)
  const chartFilter = filterColumn ? filterMetadataByColumn?.get(filterColumn) : null
  const chartFilterState = filterColumn ? filterState?.[filterColumn] : null
  const isFilterableChart = Boolean(!chart?.empty && chartFilter && onChartValueSelect)
  const pointValues = getChartPointValues(chart, sourceOptions, series)
  const selectedPointIndex =
    chartFilter && chartFilterState
      ? pointValues.findIndex((value) => chartPointMatchesFilter(chartFilter, chartFilterState, value))
      : -1
  const sourceChartOptions = sourceOptions.chart ?? {}
  const sourceEvents = sourceChartOptions.events ?? {}
  const options = {
    ...sourceOptions,
    chart: {
      ...sourceChartOptions,
      toolbar: { show: false },
      events: {
        ...sourceEvents,
        dataPointSelection: (event, chartContext, config) => {
          if (typeof sourceEvents.dataPointSelection === 'function') {
            sourceEvents.dataPointSelection(event, chartContext, config)
          }

          if (!isFilterableChart) {
            return
          }

          const selectedValue = resolveChartPointValue(chart, sourceOptions, series, config)
          if (selectedValue === null || selectedValue === undefined) {
            return
          }

          onChartValueSelect(filterColumn, selectedValue)
        },
      },
    },
    tooltip: {
      ...(sourceOptions.tooltip ?? {}),
      shared: false,
      intersect: true,
    },
  }
  const chartHeight = Math.max(112, frame.height - (visual.settings?.caption ? 106 : 82))
  const chartRenderKey = JSON.stringify({
    id: visual.id,
    type: apexType,
    chartType: chart?.chart_type,
    xAxis: chart?.x_axis,
    yAxis: chart?.y_axis,
    labels: sourceOptions.labels ?? sourceOptions.xaxis?.categories ?? [],
    series,
  })

  if (isFilterableChart && ['line', 'area', 'scatter'].includes(apexType)) {
    const sourceMarkerSize = Number(sourceOptions.markers?.size ?? 4)
    options.markers = {
      ...(sourceOptions.markers ?? {}),
      size: sourceMarkerSize > 0 ? sourceMarkerSize : 4,
    }
  }

  if (isFilterableChart && selectedPointIndex >= 0) {
    const selectedColor = normalizeHexColor(visual.settings?.color, '#0f766e')
    const mutedColor = '#d7e0db'

    if (apexType === 'pie' || apexType === 'donut') {
      options.colors = pointValues.map((_, index) => (index === selectedPointIndex ? selectedColor : mutedColor))
    } else if (apexType === 'bar') {
      options.colors = pointValues.map((_, index) => (index === selectedPointIndex ? selectedColor : mutedColor))
      options.legend = { ...(sourceOptions.legend ?? {}), show: false }
      options.plotOptions = {
        ...(sourceOptions.plotOptions ?? {}),
        bar: {
          ...(sourceOptions.plotOptions?.bar ?? {}),
          distributed: true,
        },
      }
    } else {
      options.markers = {
        ...(options.markers ?? {}),
        discrete: [
          ...(options.markers?.discrete ?? []),
          {
            seriesIndex: 0,
            dataPointIndex: selectedPointIndex,
            fillColor: selectedColor,
            strokeColor: '#0b4f49',
            size: 7,
          },
        ],
      }
    }
  }

  return (
    <div
      className={
        [
          'blank-visual-inner',
          isFilterableChart ? 'blank-visual-inner--filterable' : '',
          selectedPointIndex >= 0 ? 'blank-visual-inner--filtered' : '',
        ]
          .filter(Boolean)
          .join(' ')
      }
    >
      <div className="blank-visual-title">
        <h3>{getCanvasVisualTitle(visual) || chart.title}</h3>
        {visual.settings?.subtitle ? <p>{visual.settings.subtitle}</p> : null}
      </div>
      {chart.empty ? (
        <div className="blank-visual-empty">{chart.description}</div>
      ) : (
        <ChartRenderErrorBoundary
          resetKey={`${chartRenderKey}:${chartHeight}`}
        >
          <Chart key={chartRenderKey} options={options} series={series} type={apexType} height={chartHeight} width="100%" />
        </ChartRenderErrorBoundary>
      )}
      {visual.settings?.caption ? <p className="blank-visual-caption">{visual.settings.caption}</p> : null}
    </div>
  )
}

function CanvasKpiVisual({ visual, rows }) {
  const kpi = computeCanvasKpi(visual, rows)

  return (
    <div className="blank-kpi-visual">
      <span>{kpi.label}</span>
      <strong>{kpi.value}</strong>
      <small>{kpi.hint}</small>
      {visual.settings?.caption ? <p>{visual.settings.caption}</p> : null}
    </div>
  )
}

function CanvasTableVisual({ visual, rows }) {
  const selectedColumns = Array.isArray(visual.fields?.values) && visual.fields.values.length ? visual.fields.values : []
  const visibleRows = Array.isArray(rows) ? rows.slice(0, 40) : []

  return (
    <div className="blank-table-visual">
      <div className="blank-visual-title">
        <h3>{getCanvasVisualTitle(visual)}</h3>
        {visual.settings?.subtitle ? <p>{visual.settings.subtitle}</p> : null}
      </div>
      {selectedColumns.length ? (
        <div className="blank-table-scroll">
          <table>
            <thead>
              <tr>
                {selectedColumns.map((column) => (
                  <th key={`${visual.id}-head-${column}`}>{column}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row, rowIndex) => (
                <tr key={`${visual.id}-row-${rowIndex}`}>
                  {selectedColumns.map((column) => (
                    <td key={`${visual.id}-${rowIndex}-${column}`}>{formatValue(row[column])}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="blank-visual-empty">Drag fields here to build this visual.</div>
      )}
      {visual.settings?.caption ? <p className="blank-visual-caption">{visual.settings.caption}</p> : null}
    </div>
  )
}

function CanvasTextVisual({ visual }) {
  return (
    <div className="blank-text-visual">
      {visual.settings?.title ? <h3>{visual.settings.title}</h3> : null}
      <p>{visual.content}</p>
      {visual.settings?.caption ? <small>{visual.settings.caption}</small> : null}
    </div>
  )
}

function CanvasVisual({
  visual,
  rows,
  isSelected,
  isFinalized,
  dragState,
  isDropActive,
  isDropPulse,
  filterMetadataByColumn,
  filterState,
  onSelect,
  onRemove,
  onDragStart,
  onResizeStart,
  onFieldDragOver,
  onFieldDragLeave,
  onFieldDrop,
  onChartValueSelect,
}) {
  const isFieldDragging = Boolean(dragState?.field)
  const showFieldDropOverlay = isFieldDragging && !isFinalized && ['chart', 'kpi', 'table'].includes(visual.kind)
  const frame = getSafeCanvasVisualFrame(visual)
  const visualStyle = {
    width: frame.width,
    height: frame.height,
    transform: `translate(${frame.x}px, ${frame.y}px)`,
    backgroundColor: normalizeHexColor(visual.settings?.backgroundColor, '#ffffff'),
    borderRadius: `${normalizeNumber(visual.settings?.borderRadius, 8, 0, 28)}px`,
    fontFamily: visual.settings?.fontFamily,
    fontSize: `${normalizeNumber(visual.settings?.fontSize, 13, 10, 48)}px`,
    '--blank-accent': normalizeHexColor(visual.settings?.color, '#0f766e'),
  }

  return (
    <article
      className={
        [
          'blank-canvas-visual',
          isSelected ? 'blank-canvas-visual--selected' : '',
          isDropActive ? 'blank-canvas-visual--drop-active' : '',
          isDropPulse ? 'blank-canvas-visual--drop-pulse' : '',
        ]
          .filter(Boolean)
          .join(' ')
      }
      style={visualStyle}
      onPointerDown={() => onSelect(visual.id)}
      onDragOver={(event) => {
        if (!isFieldDragging) {
          return
        }

        event.preventDefault()
        event.stopPropagation()
        onFieldDragOver(event, visual)
      }}
      onDragLeave={(event) => {
        if (didLeaveElement(event)) {
          onFieldDragLeave(visual.id)
        }
      }}
      onDrop={(event) => {
        if (!isFieldDragging) {
          return
        }

        event.preventDefault()
        event.stopPropagation()
        onFieldDrop(event, visual)
      }}
    >
      {!isFinalized ? (
        <header className="blank-visual-handle" onPointerDown={(event) => onDragStart(event, visual)}>
          <span>{visual.kind}</span>
          <button
            type="button"
            aria-label="Remove visual"
            title="Remove visual"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => onRemove(visual.id)}
          >
            x
          </button>
        </header>
      ) : null}

      <div className="blank-visual-content">
        {visual.kind === 'chart' ? (
          <CanvasChartVisual
            visual={visual}
            rows={rows}
            filterMetadataByColumn={filterMetadataByColumn}
            filterState={filterState}
            onChartValueSelect={onChartValueSelect}
          />
        ) : null}
        {visual.kind === 'kpi' ? <CanvasKpiVisual visual={visual} rows={rows} /> : null}
        {visual.kind === 'table' ? <CanvasTableVisual visual={visual} rows={rows} /> : null}
        {visual.kind === 'text' ? <CanvasTextVisual visual={visual} /> : null}
      </div>

      {showFieldDropOverlay ? (
        visual.kind === 'chart' ? (
          <div className="blank-chart-drop-overlay">
            <strong>Drop field to build this chart</strong>
            <div className="blank-chart-drop-zones">
              <div
                className="blank-chart-drop-zone blank-chart-drop-zone--top"
                onDragOver={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  onFieldDragOver(event, visual, 'x_axis')
                }}
                onDrop={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  onFieldDrop(event, visual, 'x_axis')
                }}
              >
                Drop dimension (X-axis)
              </div>
              <div
                className="blank-chart-drop-zone blank-chart-drop-zone--side"
                onDragOver={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  onFieldDragOver(event, visual, 'legend')
                }}
                onDrop={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  onFieldDrop(event, visual, 'legend')
                }}
              >
                Drop legend
              </div>
              <div
                className="blank-chart-drop-zone blank-chart-drop-zone--bottom"
                onDragOver={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  onFieldDragOver(event, visual, 'y_axis')
                }}
                onDrop={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  onFieldDrop(event, visual, 'y_axis')
                }}
              >
                Drop measure (Y-axis)
              </div>
            </div>
          </div>
        ) : (
          <div className="blank-chart-drop-overlay blank-chart-drop-overlay--simple">
            <strong>Drop field to build this visual</strong>
          </div>
        )
      ) : null}

      {!isFinalized ? (
        <>
          <span
            className="blank-resize-handle blank-resize-handle--right"
            onPointerDown={(event) => onResizeStart(event, visual, 'right')}
            aria-hidden="true"
          />
          <span
            className="blank-resize-handle blank-resize-handle--bottom"
            onPointerDown={(event) => onResizeStart(event, visual, 'bottom')}
            aria-hidden="true"
          />
          <span
            className="blank-resize-handle blank-resize-handle--corner"
            onPointerDown={(event) => onResizeStart(event, visual, 'corner')}
            aria-hidden="true"
          />
        </>
      ) : null}
    </article>
  )
}

function FieldDropZone({
  label,
  value,
  multiple = false,
  acceptedTypes = ['any'],
  columnProfiles,
  onDropField,
  onRemoveField,
}) {
  const values = multiple ? value ?? [] : value ? [value] : []
  const warnings = values
    .map((fieldName) => getFieldWellWarning(fieldName, acceptedTypes, columnProfiles))
    .filter(Boolean)

  return (
    <div
      className="blank-field-dropzone"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault()
        const fieldName = getDraggedFieldName(event)
        if (fieldName) {
          onDropField(fieldName)
        }
      }}
    >
      <header>
        <span>{label}</span>
        <small>{acceptedTypes.includes('any') ? 'Any field' : acceptedTypes.join(' / ')}</small>
      </header>
      <div>
        {values.length ? (
          values.map((fieldName) => (
            <button
              type="button"
              key={`${label}-${fieldName}`}
              onClick={(event) => {
                event.stopPropagation()
                onRemoveField(fieldName)
              }}
              title={`Remove ${fieldName}`}
              aria-label={`Remove ${fieldName}`}
            >
              {fieldName} <small aria-hidden="true">x</small>
            </button>
          ))
        ) : (
          <em>Drop field</em>
        )}
      </div>
      {warnings.length ? <p>{warnings[0]}</p> : null}
    </div>
  )
}

function BlankSidebarSection({ title, isOpen, onToggle, children }) {
  return (
    <section className={isOpen ? 'blank-sidebar-section' : 'blank-sidebar-section blank-sidebar-section--collapsed'}>
      <button
        type="button"
        className="blank-sidebar-section-toggle"
        onClick={onToggle}
        aria-expanded={isOpen}
      >
        <span>{title}</span>
        <small aria-hidden="true">{isOpen ? 'Collapse' : 'Open'}</small>
      </button>
      {isOpen ? <div className="blank-sidebar-section-body">{children}</div> : null}
    </section>
  )
}

function BlankSidePane({ title, isCollapsed, onToggleCollapse, className = '', children }) {
  if (isCollapsed) {
    return (
      <aside className={`blank-builder-sidebar blank-builder-sidebar--side-collapsed ${className}`.trim()}>
        <button
          type="button"
          className="blank-sidepane-tab"
          onClick={onToggleCollapse}
          aria-label={`Open ${title}`}
          title={`Open ${title}`}
        >
          <span>{title}</span>
        </button>
      </aside>
    )
  }

  return (
    <aside className={`blank-builder-sidebar ${className}`.trim()} aria-label={title}>
      <header className="blank-sidepane-header">
        <h2>{title}</h2>
        <button
          type="button"
          className="blank-sidepane-collapse-button"
          onClick={onToggleCollapse}
          aria-label={`Collapse ${title}`}
          title={`Collapse ${title}`}
        >
          <span aria-hidden="true">&gt;</span>
        </button>
      </header>
      {children}
    </aside>
  )
}

function BlankCanvasSidebar({
  columns,
  columnProfiles,
  selectedVisual,
  onAddVisual,
  onFieldClick,
  onFieldDragStart,
  onFieldDragEnd,
  onUpdateField,
  onUpdateSetting,
  onUpdateContent,
  onRemoveVisual,
}) {
  const [openSections, setOpenSections] = useState({
    visualizations: true,
    fields: true,
    settings: true,
  })
  const [collapsedPanes, setCollapsedPanes] = useState({
    build: false,
    settings: false,
  })
  const fieldWells = selectedVisual ? getFieldWellsForVisual(selectedVisual) : []
  const selectedChartType = selectedVisual?.settings?.chart_type || selectedVisual?.type
  const toggleSection = (section) => {
    setOpenSections((previous) => ({
      ...previous,
      [section]: !previous[section],
    }))
  }
  const togglePane = (pane) => {
    setCollapsedPanes((previous) => ({
      ...previous,
      [pane]: !previous[pane],
    }))
  }
  const sidePaneClassName = [
    'blank-builder-sidepanes',
    collapsedPanes.build ? 'blank-builder-sidepanes--build-collapsed' : '',
    collapsedPanes.settings ? 'blank-builder-sidepanes--settings-collapsed' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className={sidePaneClassName}>
      <BlankSidePane
        title="Build"
        className="blank-builder-sidebar--build"
        isCollapsed={collapsedPanes.build}
        onToggleCollapse={() => togglePane('build')}
      >
        <BlankSidebarSection
          title="Visualizations"
          isOpen={openSections.visualizations}
          onToggle={() => toggleSection('visualizations')}
        >
          <div className="blank-visual-button-grid">
            {CANVAS_VISUAL_TYPES.map((visualType) => (
              <button
                type="button"
                key={`canvas-add-${visualType.value}`}
                onClick={() => onAddVisual(visualType.value)}
                title={visualType.label}
                aria-label={visualType.label}
              >
                <ChartTypeIcon type={visualType.icon} />
                <span>{visualType.label}</span>
              </button>
            ))}
          </div>
        </BlankSidebarSection>

        <BlankSidebarSection
          title="Data Fields"
          isOpen={openSections.fields}
          onToggle={() => toggleSection('fields')}
        >
          <div className="blank-field-list">
            {columns.map((column) => (
              <button
                type="button"
                key={`canvas-field-${column}`}
                draggable
                onClick={() => onFieldClick(column)}
                onDragStart={(event) => onFieldDragStart(event, column)}
                onDragEnd={onFieldDragEnd}
                title={`Add ${column}`}
                aria-label={`Add ${column}`}
              >
                <span>{column}</span>
                <small className={`blank-field-type blank-field-type--${getDisplayColumnType(column, columnProfiles)}`}>
                  {getDisplayColumnType(column, columnProfiles)}
                </small>
              </button>
            ))}
          </div>
        </BlankSidebarSection>
      </BlankSidePane>

      <BlankSidePane
        title="Settings"
        className="blank-builder-sidebar--settings"
        isCollapsed={collapsedPanes.settings}
        onToggleCollapse={() => togglePane('settings')}
      >
        <BlankSidebarSection
          title="Settings"
          isOpen={openSections.settings}
          onToggle={() => toggleSection('settings')}
        >
          {selectedVisual ? (
            <div className="blank-settings-panel">
              {selectedVisual.kind === 'chart' ? (
                <div className="blank-settings-group">
                  <ChartTypeSelector
                    value={selectedChartType}
                    onChange={(value) => onUpdateSetting(selectedVisual.id, 'chart_type', value)}
                  />
                </div>
              ) : null}

              <div className="blank-field-well-stack">
                {fieldWells.map((well) => (
                  <FieldDropZone
                    key={`${selectedVisual.id}-${well.field}`}
                    label={well.label}
                    value={
                      well.multiple
                        ? selectedVisual.fields?.[well.field] ?? []
                        : well.field === 'values'
                          ? selectedVisual.fields?.values?.[0]
                          : selectedVisual.fields?.[well.field]
                    }
                    multiple={well.multiple}
                    acceptedTypes={well.acceptedTypes}
                    columnProfiles={columnProfiles}
                    onDropField={(fieldName) =>
                      onUpdateField(selectedVisual.id, well.field, fieldName, false, well.multiple)
                    }
                    onRemoveField={(fieldName) =>
                      onUpdateField(selectedVisual.id, well.field, fieldName, true, well.multiple)
                    }
                  />
                ))}
              </div>

              {['chart', 'kpi'].includes(selectedVisual.kind) ? (
                <label>
                  <span>Aggregation</span>
                  <select
                    value={selectedVisual.settings?.aggregation || 'count'}
                    onChange={(event) => onUpdateSetting(selectedVisual.id, 'aggregation', event.target.value)}
                  >
                    {AGGREGATION_OPTIONS.map((option) => (
                      <option key={`canvas-agg-${option.value}`} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}

              <label>
                <span>Title</span>
                <input
                  type="text"
                  value={getCanvasVisualTitle(selectedVisual)}
                  onChange={(event) => onUpdateSetting(selectedVisual.id, 'title', event.target.value)}
                />
              </label>
              <label>
                <span>Subtitle</span>
                <input
                  type="text"
                  value={selectedVisual.settings?.subtitle ?? ''}
                  onChange={(event) => onUpdateSetting(selectedVisual.id, 'subtitle', event.target.value)}
                />
              </label>
              <label>
                <span>Caption</span>
                <input
                  type="text"
                  value={selectedVisual.settings?.caption ?? ''}
                  onChange={(event) => onUpdateSetting(selectedVisual.id, 'caption', event.target.value)}
                />
              </label>

              {selectedVisual.kind === 'text' ? (
                <label>
                  <span>Text</span>
                  <textarea
                    value={selectedVisual.content ?? ''}
                    onChange={(event) => onUpdateContent(selectedVisual.id, event.target.value)}
                  />
                </label>
              ) : null}

              <label>
                <span>Font Family</span>
                <select
                  value={selectedVisual.settings?.fontFamily || FONT_FAMILY_OPTIONS[0].value}
                  onChange={(event) => onUpdateSetting(selectedVisual.id, 'fontFamily', event.target.value)}
                >
                  {FONT_FAMILY_OPTIONS.map((option) => (
                    <option key={`canvas-font-${option.value}`} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Font Size</span>
                <input
                  type="number"
                  min="10"
                  max="48"
                  value={selectedVisual.settings?.fontSize ?? 13}
                  onChange={(event) => onUpdateSetting(selectedVisual.id, 'fontSize', Number(event.target.value))}
                />
              </label>

              <div className="blank-color-grid">
                <label>
                  <span>Color</span>
                  <input
                    type="color"
                    value={normalizeHexColor(selectedVisual.settings?.color, CANVAS_PALETTE[0])}
                    onChange={(event) => onUpdateSetting(selectedVisual.id, 'color', event.target.value)}
                  />
                </label>
                <label>
                  <span>Background</span>
                  <input
                    type="color"
                    value={normalizeHexColor(selectedVisual.settings?.backgroundColor, '#ffffff')}
                    onChange={(event) => onUpdateSetting(selectedVisual.id, 'backgroundColor', event.target.value)}
                  />
                </label>
              </div>

              {selectedVisual.kind === 'chart' ? (
                <div className="blank-toggle-grid">
                  <label>
                    <input
                      type="checkbox"
                      checked={Boolean(selectedVisual.settings?.showLegend)}
                      onChange={(event) => onUpdateSetting(selectedVisual.id, 'showLegend', event.target.checked)}
                    />
                    <span>Legend</span>
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={Boolean(selectedVisual.settings?.showLabels)}
                      onChange={(event) => onUpdateSetting(selectedVisual.id, 'showLabels', event.target.checked)}
                    />
                    <span>Labels</span>
                  </label>
                </div>
              ) : null}

              <label>
                <span>Border Radius</span>
                <input
                  type="number"
                  min="0"
                  max="28"
                  value={selectedVisual.settings?.borderRadius ?? 8}
                  onChange={(event) => onUpdateSetting(selectedVisual.id, 'borderRadius', Number(event.target.value))}
                />
              </label>

              <button type="button" className="visual-card-remove-button" onClick={() => onRemoveVisual(selectedVisual.id)}>
                Remove Visual
              </button>
            </div>
          ) : (
            <p className="blank-sidebar-empty">No visual selected</p>
          )}
        </BlankSidebarSection>
      </BlankSidePane>
    </div>
  )
}

function BlankCanvasBuilder({
  captureRef,
  canvasRef,
  visuals,
  selectedVisualId,
  isFinalized,
  dragState,
  activeDropVisualId,
  dropPulseVisualId,
  rows,
  columns,
  columnProfiles,
  filterMetadataByColumn,
  filterState,
  onSelectVisual,
  onAddVisual,
  onRemoveVisual,
  onFieldClick,
  onFieldDragStart,
  onFieldDragEnd,
  onCanvasFieldDragOver,
  onCanvasFieldDrop,
  onUpdateField,
  onUpdateSetting,
  onUpdateContent,
  onDragStart,
  onResizeStart,
  onVisualFieldDragOver,
  onVisualFieldDragLeave,
  onVisualFieldDrop,
  onCanvasBackgroundClick,
  onChartValueSelect,
}) {
  const viewportRef = useRef(null)
  const [fitScale, setFitScale] = useState(1)
  const [zoomMode, setZoomMode] = useState('fit')
  const safeVisuals = Array.isArray(visuals)
    ? visuals.map((visual, index) => normalizeCanvasVisual(visual, index))
    : []
  const selectedVisual = safeVisuals.find((visual) => visual.id === selectedVisualId) ?? null
  const canvasScale = zoomMode === 'fit' ? fitScale : Number(zoomMode)
  const normalizedCanvasScale = Number.isFinite(canvasScale) ? canvasScale : fitScale

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) {
      return undefined
    }

    function updateFitScale() {
      const nextScale = clampValue((viewport.clientWidth || CANVAS_SIZE.width) / CANVAS_SIZE.width, 0.28, 1)
      setFitScale(Number(nextScale.toFixed(3)))
    }

    updateFitScale()

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateFitScale)
      return () => window.removeEventListener('resize', updateFitScale)
    }

    const resizeObserver = new ResizeObserver(updateFitScale)
    resizeObserver.observe(viewport)
    return () => resizeObserver.disconnect()
  }, [])

  return (
    <div className="blank-builder-shell">
      <main className="blank-builder-main">
        <div className="blank-canvas-toolbar" aria-label="Canvas zoom">
          <span>Canvas</span>
          <div className="blank-canvas-zoom-control">
            {CANVAS_ZOOM_OPTIONS.map((option) => (
              <button
                key={`canvas-zoom-${option.value}`}
                type="button"
                className={zoomMode === option.value ? 'is-active' : ''}
                onClick={() => setZoomMode(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div ref={viewportRef} className="blank-canvas-viewport">
          <div
            className="blank-canvas-stage"
            style={{
              width: CANVAS_SIZE.width * normalizedCanvasScale,
              height: CANVAS_SIZE.height * normalizedCanvasScale,
            }}
          >
            <div
              ref={captureRef}
              className="blank-report-capture"
              style={{
                width: CANVAS_SIZE.width,
                height: CANVAS_SIZE.height,
                transform: `scale(${normalizedCanvasScale})`,
              }}
            >
              <section
                ref={canvasRef}
                className={
                  dragState?.field && !activeDropVisualId
                    ? 'blank-report-canvas blank-report-canvas--drop-active'
                    : 'blank-report-canvas'
                }
                style={{ width: CANVAS_SIZE.width, height: CANVAS_SIZE.height }}
                onPointerDown={onCanvasBackgroundClick}
                onDragOver={onCanvasFieldDragOver}
                onDrop={(event) => onCanvasFieldDrop(event, normalizedCanvasScale)}
              >
                {safeVisuals.map((visual, index) => (
                  <CanvasVisualErrorBoundary
                    key={visual.id || `visual-${index}`}
                    visual={visual}
                    onRemove={onRemoveVisual}
                    resetKey={getCanvasVisualRenderKey(visual)}
                  >
                    <CanvasVisual
                      visual={visual}
                      rows={rows}
                      isSelected={visual.id === selectedVisualId}
                      isFinalized={isFinalized}
                      dragState={dragState}
                      isDropActive={visual.id === activeDropVisualId}
                      isDropPulse={visual.id === dropPulseVisualId}
                      filterMetadataByColumn={filterMetadataByColumn}
                      filterState={filterState}
                      onSelect={onSelectVisual}
                      onRemove={onRemoveVisual}
                      onDragStart={(event, selectedVisualForDrag) => onDragStart(event, selectedVisualForDrag, normalizedCanvasScale)}
                      onResizeStart={(event, selectedVisualForResize, direction) => onResizeStart(event, selectedVisualForResize, direction, normalizedCanvasScale)}
                      onFieldDragOver={onVisualFieldDragOver}
                      onFieldDragLeave={onVisualFieldDragLeave}
                      onFieldDrop={onVisualFieldDrop}
                      onChartValueSelect={onChartValueSelect}
                    />
                  </CanvasVisualErrorBoundary>
                ))}
                {!safeVisuals.length ? (
                  <div className="blank-canvas-empty">
                    <h3>Blank Canvas</h3>
                    <p>Choose a field or visual to start this sheet.</p>
                  </div>
                ) : null}
              </section>
            </div>
          </div>
        </div>
      </main>

      {!isFinalized ? (
        <BlankCanvasSidebar
          columns={columns}
          columnProfiles={columnProfiles}
          selectedVisual={selectedVisual}
          onAddVisual={onAddVisual}
          onFieldClick={(fieldName) => onFieldClick(fieldName, selectedVisual)}
          onFieldDragStart={onFieldDragStart}
          onFieldDragEnd={onFieldDragEnd}
          onUpdateField={onUpdateField}
          onUpdateSetting={onUpdateSetting}
          onUpdateContent={onUpdateContent}
          onRemoveVisual={onRemoveVisual}
        />
      ) : null}
      {dragState?.field ? (
        <div
          className="blank-drag-preview"
          style={{ transform: `translate(${dragState.x + 14}px, ${dragState.y + 14}px)` }}
        >
          {dragState.preview || `Drop ${dragState.field}`}
        </div>
      ) : null}
    </div>
  )
}

function DashboardEditorPanel({
  editor,
  chart,
  kpi,
  note,
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
  onCustomKpiValueChange,
  onNoteChange,
}) {
  if (!editor) {
    return null
  }

  if (editor.type === 'note') {
    return (
      <aside className="visual-side-panel">
        <header>
          <div>
            <span>Workspace Widget</span>
            <h2>Edit Note</h2>
          </div>
          <button type="button" className="visual-small-button" onClick={onClose}>
            Close
          </button>
        </header>
        <label>
          <span>Title</span>
          <input
            type="text"
            value={note?.title ?? ''}
            onChange={(event) => onNoteChange(editor.noteId, 'title', event.target.value)}
          />
        </label>
        <label>
          <span>Body</span>
          <textarea
            value={note?.body ?? ''}
            maxLength={280}
            onChange={(event) => onNoteChange(editor.noteId, 'body', event.target.value)}
          />
        </label>
      </aside>
    )
  }

  if (editor.type === 'kpi') {
    const title = kpiText?.title || kpi?.label || ''
    const subtitle = kpiText?.subtitle || kpi?.hint || ''
    const isCustomKpi = kpi?.source === 'custom'

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
        {isCustomKpi ? (
          <label>
            <span>Value</span>
            <input
              type="text"
              value={kpi?.value ?? ''}
              onChange={(event) => onCustomKpiValueChange(editor.textKey, event.target.value)}
            />
          </label>
        ) : null}
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
          <ChartTypeSelector
            value={settings.chart_type}
            onChange={(value) => onSettingChange(chart.id, 'chart_type', value)}
          />

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
  const [customKpis, setCustomKpis] = useState([])
  const [customNotes, setCustomNotes] = useState([])
  const [customChartsById, setCustomChartsById] = useState({})
  const [hiddenChartIds, setHiddenChartIds] = useState([])
  const [hiddenKpiKeys, setHiddenKpiKeys] = useState([])
  const [workspaceMode, setWorkspaceMode] = useState('suggested')
  const [workspaceWidgets, setWorkspaceWidgets] = useState(DEFAULT_WORKSPACE_WIDGETS)
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
  const [canvasVisuals, setCanvasVisuals] = useState([])
  const [selectedCanvasVisualId, setSelectedCanvasVisualId] = useState('')
  const [canvasInteraction, setCanvasInteraction] = useState(null)
  const [canvasDragState, setCanvasDragState] = useState(null)
  const [activeDropVisualId, setActiveDropVisualId] = useState('')
  const [dropPulseVisualId, setDropPulseVisualId] = useState('')
  const [hydratedCanvasDatasetId, setHydratedCanvasDatasetId] = useState('')
  const [activeEditor, setActiveEditor] = useState(null)
  const [openChartMenuId, setOpenChartMenuId] = useState('')
  const [isBuilderOpen, setIsBuilderOpen] = useState(false)
  const dashboardCaptureRef = useRef(null)
  const blankCanvasRef = useRef(null)

  const dashboard = localDashboard ?? storedCharts
  const sourceColumns = useMemo(() => uploadedDataset.columns ?? [], [uploadedDataset.columns])
  const sourceRows = useMemo(() => uploadedDataset.rows ?? [], [uploadedDataset.rows])
  const tableColumns = dashboard?.table?.columns?.length ? dashboard.table.columns : sourceColumns
  const tableRows = dashboard?.table?.rows ?? sourceRows
  const columnProfiles = useMemo(() => {
    if (Array.isArray(dashboard?.columns) && dashboard.columns.length) {
      return dashboard.columns
    }

    return activeProfile?.column_profiles ?? []
  }, [activeProfile, dashboard])
  const numericColumns = useMemo(() => {
    if (dashboard?.column_types?.numeric?.length) {
      return dashboard.column_types.numeric
    }

    return columnProfiles
      .filter((column) => String(column.dtype).toLowerCase().includes('int') || String(column.dtype).toLowerCase().includes('float'))
      .map((column) => column.name)
  }, [columnProfiles, dashboard])
  const chartConfigs = useMemo(() => dashboard?.chart_configs ?? [], [dashboard])
  const renderedCharts = chartConfigs.map((chart) => customChartsById[chart.id] ?? chart)
  const summary = dashboard?.summary ?? {}
  const insightKpis = useMemo(() => {
    if (Array.isArray(dashboard?.insight_kpis)) {
      return dashboard.insight_kpis
    }

    if (Array.isArray(dashboard?.kpis)) {
      return dashboard.kpis
    }

    return []
  }, [dashboard])
  const fallbackKpis = useMemo(
    () => [
      {
        label: 'Total Records',
        value: formatValue(summary.total_rows ?? tableRows.length),
        hint: 'Rows in the cleaned dataset',
      },
    ],
    [summary.total_rows, tableRows.length],
  )
  const autoKpiCards = useMemo(
    () => (insightKpis.length > 0 ? insightKpis : fallbackKpis),
    [fallbackKpis, insightKpis],
  )
  const kpiCards = useMemo(
    () => (workspaceMode === 'blank' ? customKpis : [...autoKpiCards, ...customKpis]),
    [autoKpiCards, customKpis, workspaceMode],
  )
  const hasDatasetPayload = sourceColumns.length > 0 || sourceRows.length > 0
  const hiddenChartIdSet = useMemo(() => new Set(hiddenChartIds), [hiddenChartIds])
  const hiddenKpiKeySet = useMemo(() => new Set(hiddenKpiKeys), [hiddenKpiKeys])
  const dashboardCharts = useMemo(
    () => (workspaceMode === 'blank' ? manualCharts : [...renderedCharts, ...manualCharts]),
    [manualCharts, renderedCharts, workspaceMode],
  )
  const visibleKpiCards = useMemo(
    () => kpiCards.filter((kpi, index) => !hiddenKpiKeySet.has(getKpiInstanceKey(kpi, index))),
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
  const filterPayload = useMemo(
    () => buildFilterPayload(filterState, filterMetadata),
    [filterMetadata, filterState],
  )
  const filterMetadataByColumn = useMemo(() => {
    return new Map(filterMetadata.map((filter) => [filter.column, filter]))
  }, [filterMetadata])
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
        const valueLabel = formatActiveFilterValue(filter, state)

        return {
          column: filter.column,
          valueLabel,
          label: `${filter.column}: ${valueLabel}`,
        }
      })
  }, [filterMetadata, filterState])
  const hasActiveFilters = activeFilters.length > 0
  const hasBlankCanvasWork = workspaceMode === 'blank' && canvasVisuals.length > 0
  const shouldShowActiveFilters = hasDatasetPayload
    && filterMetadata.length > 0
    && (workspaceMode !== 'blank' || hasActiveFilters)
  const presentationKpis = isFinalized && finalizedDashboard?.kpis && !hasActiveFilters
    ? finalizedDashboard.kpis
    : visibleKpiCards
  const presentationCharts = isFinalized && finalizedDashboard?.charts && !hasActiveFilters
    ? finalizedDashboard.charts
    : visibleCharts
  const presentationNotes = isFinalized && finalizedDashboard?.notes && !hasActiveFilters
    ? finalizedDashboard.notes
    : customNotes
  const presentationKpiText = isFinalized && finalizedDashboard?.kpiTextByKey
    ? finalizedDashboard.kpiTextByKey
    : kpiTextByKey
  const presentationChartText = isFinalized && finalizedDashboard?.chartTextById
    ? finalizedDashboard.chartTextById
    : chartTextById
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
  const activeKpi = activeEditor?.type === 'kpi'
    ? kpiCards.find((kpi, index) => getKpiInstanceKey(kpi, index) === activeEditor.textKey) ?? null
    : null
  const activeNote = activeEditor?.type === 'note'
    ? customNotes.find((note) => note.id === activeEditor.noteId) ?? null
    : null
  const activeChartSettings = activeChart
    ? settingsById[activeChart.id] ?? buildDefaultSettings(activeChart, tableColumns, numericColumns)
    : null
  const workspaceWidgetCount = workspaceMode === 'blank'
    ? canvasVisuals.length
    : visibleKpiCards.length + visibleCharts.length + customNotes.length
  const presentationWidgetCount =
    workspaceMode === 'blank'
      ? canvasVisuals.length
      : presentationKpis.length + presentationCharts.length + presentationNotes.length

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
          const savedCanvasLayout = getSavedCanvasLayout(datasetId)
          const savedCanvasVisuals = Array.isArray(savedCanvasLayout?.visuals)
            ? savedCanvasLayout.visuals.map((visual, index) => normalizeCanvasVisual(visual, index))
            : []

          setLocalDashboard(payload)
          setCustomChartsById({})
          setManualCharts([])
          setCustomKpis([])
          setCustomNotes([])
          setHiddenChartIds([])
          setHiddenKpiKeys([])
          setWorkspaceMode(savedCanvasLayout?.workspaceMode === 'blank' ? 'blank' : 'suggested')
          setWorkspaceWidgets(DEFAULT_WORKSPACE_WIDGETS)
          setChartOrder((payload.chart_configs ?? []).map((chart) => chart.id))
          setFilterMetadata(payload.filters ?? [])
          setFilterState({})
          setCanvasVisuals(savedCanvasVisuals)
          setSelectedCanvasVisualId(savedCanvasVisuals[0]?.id ?? '')
          setCanvasInteraction(null)
          setCanvasDragState(null)
          setActiveDropVisualId('')
          setDropPulseVisualId('')
          setHydratedCanvasDatasetId(datasetId)
          setIsFinalized(false)
          setFinalizedDashboard(null)
          setActiveEditor(null)
          setOpenChartMenuId('')
          setIsBuilderOpen(false)
        }
      } catch (error) {
        if (!cancelled) {
          setDashboardError(error.message)
          setHydratedCanvasDatasetId(datasetId)
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
    if (!hasDatasetPayload || filterMetadata.length === 0) {
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
    sourceColumns,
    sourceRows,
  ])

  useEffect(() => {
    if (!datasetId || hydratedCanvasDatasetId !== datasetId) {
      return
    }

    saveCanvasLayout(datasetId, {
      workspaceMode,
      visuals: canvasVisuals,
    })
  }, [canvasVisuals, datasetId, hydratedCanvasDatasetId, workspaceMode])

  useEffect(() => {
    if (!canvasInteraction) {
      return
    }

    function handlePointerMove(event) {
      event.preventDefault()
      const interactionScale = canvasInteraction.canvasScale || 1
      const deltaX = (event.clientX - canvasInteraction.startClientX) / interactionScale
      const deltaY = (event.clientY - canvasInteraction.startClientY) / interactionScale
      const canvasWidth = canvasInteraction.canvasWidth ?? CANVAS_SIZE.width
      const canvasHeight = canvasInteraction.canvasHeight ?? CANVAS_SIZE.height

      setCanvasVisuals((previous) =>
        previous.map((visual) => {
          if (visual.id !== canvasInteraction.id) {
            return visual
          }

          if (canvasInteraction.mode === 'move') {
            return {
              ...visual,
              x: clampValue(canvasInteraction.startX + deltaX, 0, canvasWidth - visual.width),
              y: clampValue(canvasInteraction.startY + deltaY, 0, canvasHeight - visual.height),
            }
          }

          const shouldResizeWidth = ['right', 'corner'].includes(canvasInteraction.mode)
          const shouldResizeHeight = ['bottom', 'corner'].includes(canvasInteraction.mode)

          return {
            ...visual,
            width: shouldResizeWidth
              ? clampValue(canvasInteraction.startWidth + deltaX, 180, canvasWidth - visual.x)
              : visual.width,
            height: shouldResizeHeight
              ? clampValue(canvasInteraction.startHeight + deltaY, 120, canvasHeight - visual.y)
              : visual.height,
          }
        }),
      )
    }

    function handlePointerUp() {
      setCanvasInteraction(null)
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)

    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
    }
  }, [canvasInteraction])

  function confirmDiscardBlankWork(actionLabel) {
    return window.confirm(`Discard the current blank sheet and ${actionLabel}?`)
  }

  async function regenerateDashboard() {
    if (!hasDatasetPayload) {
      return
    }

    if (hasBlankCanvasWork && !confirmDiscardBlankWork('regenerate the suggested dashboard')) {
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
      setCustomKpis([])
      setCustomNotes([])
      setHiddenChartIds([])
      setHiddenKpiKeys([])
      setWorkspaceMode('suggested')
      setWorkspaceWidgets(DEFAULT_WORKSPACE_WIDGETS)
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

  function createBlankWorkspace() {
    if (hasBlankCanvasWork && !confirmDiscardBlankWork('start a new blank sheet')) {
      return
    }

    setWorkspaceMode('blank')
    setWorkspaceWidgets(BLANK_WORKSPACE_WIDGETS)
    setManualCharts([])
    setCustomKpis([])
    setCustomNotes([])
    setCustomChartsById({})
    setHiddenChartIds([])
    setHiddenKpiKeys([])
    setChartOrder([])
    setSettingsById({})
    setKpiTextByKey({})
    setChartTextById({})
    setCanvasVisuals([])
    setSelectedCanvasVisualId('')
    setCanvasInteraction(null)
    setCanvasDragState(null)
    setActiveDropVisualId('')
    setDropPulseVisualId('')
    setHydratedCanvasDatasetId(datasetId)
    setIsFinalized(false)
    setFinalizedDashboard(null)
    setActiveEditor(null)
    setOpenChartMenuId('')
    setIsBuilderOpen(false)
    setDraggingChartId('')
    setDashboardError('')
  }

  function restoreSuggestedWorkspace() {
    if (hasBlankCanvasWork && !confirmDiscardBlankWork('switch back to the suggested sheet')) {
      return
    }

    setWorkspaceMode('suggested')
    setWorkspaceWidgets(DEFAULT_WORKSPACE_WIDGETS)
    setManualCharts([])
    setCustomKpis([])
    setCustomNotes([])
    setCustomChartsById({})
    setHiddenChartIds([])
    setHiddenKpiKeys([])
    setChartOrder(chartConfigs.map((chart) => chart.id))
    setSettingsById({})
    setKpiTextByKey({})
    setChartTextById({})
    setSelectedCanvasVisualId('')
    setCanvasInteraction(null)
    setCanvasDragState(null)
    setActiveDropVisualId('')
    setDropPulseVisualId('')
    setIsFinalized(false)
    setFinalizedDashboard(null)
    setActiveEditor(null)
    setOpenChartMenuId('')
    setIsBuilderOpen(false)
    setDraggingChartId('')
    setDashboardError('')
  }

  function addCanvasVisual(type) {
    const visual = createCanvasVisual(type, canvasVisuals.length)
    setCanvasVisuals((previous) => [...previous, visual])
    setSelectedCanvasVisualId(visual.id)
  }

  function handleCanvasFieldClick(fieldName, selectedVisual = null) {
    if (!fieldName) {
      return
    }

    if (selectedVisual?.id && selectedVisual.kind !== 'text') {
      setCanvasVisuals((previous) =>
        previous.map((visual) =>
          visual.id === selectedVisual.id
            ? smartAssignFieldToVisual(visual, fieldName, columnProfiles)
            : visual,
        ),
      )
      setSelectedCanvasVisualId(selectedVisual.id)
      pulseCanvasVisual(selectedVisual.id)
      return
    }

    const visual = createCanvasVisualFromField(fieldName, columnProfiles, numericColumns, canvasVisuals.length)
    setCanvasVisuals((previous) => [...previous, visual])
    setSelectedCanvasVisualId(visual.id)
    pulseCanvasVisual(visual.id)
  }

  function pulseCanvasVisual(visualId) {
    setDropPulseVisualId(visualId)
    window.setTimeout(() => {
      setDropPulseVisualId((current) => (current === visualId ? '' : current))
    }, 520)
  }

  function startCanvasFieldDrag(event, fieldName) {
    const transfer = event?.dataTransfer
    if (transfer && typeof transfer.setData === 'function') {
      transfer.effectAllowed = 'copy'
      transfer.setData('application/x-atlas-field', fieldName)
      transfer.setData('text/plain', fieldName)
    }

    setCanvasDragState({
      field: fieldName,
      x: event?.clientX ?? 0,
      y: event?.clientY ?? 0,
      preview: getFieldDropPreview(fieldName, columnProfiles, numericColumns),
    })
  }

  function endCanvasFieldDrag() {
    setCanvasDragState(null)
    setActiveDropVisualId('')
  }

  function updateCanvasDragPreview(event, targetVisual = null, targetField = 'auto') {
    const fieldName = canvasDragState?.field || getDraggedFieldName(event)
    if (!fieldName) {
      return
    }

    setCanvasDragState({
      field: fieldName,
      x: event?.clientX ?? 0,
      y: event?.clientY ?? 0,
      preview: getFieldDropPreview(fieldName, columnProfiles, numericColumns, targetVisual, targetField),
    })
  }

  function handleCanvasFieldDragOver(event) {
    if (!canvasDragState?.field) {
      return
    }

    event.preventDefault()
    updateCanvasDragPreview(event)
    setActiveDropVisualId('')
  }

  function handleCanvasFieldDrop(event, canvasScale = 1) {
    const fieldName = canvasDragState?.field || getDraggedFieldName(event)
    if (!fieldName) {
      return
    }

    event.preventDefault()
    const canvasRect = blankCanvasRef.current?.getBoundingClientRect?.()
    if (!canvasRect) {
      endCanvasFieldDrag()
      return
    }

    const canvasSize = getCanvasElementSize(blankCanvasRef.current)
    const nextVisual = createCanvasVisualFromField(fieldName, columnProfiles, numericColumns, canvasVisuals.length)
    const safeScale = canvasScale || 1
    const pointerX = ((event?.clientX ?? canvasRect.left) - canvasRect.left) / safeScale
    const pointerY = ((event?.clientY ?? canvasRect.top) - canvasRect.top) / safeScale
    const x = clampValue(pointerX - nextVisual.width / 2, 0, canvasSize.width - nextVisual.width)
    const y = clampValue(pointerY - 32, 0, canvasSize.height - nextVisual.height)
    const positionedVisual = {
      ...nextVisual,
      x,
      y,
    }

    setCanvasVisuals((previous) => [...previous, positionedVisual])
    setSelectedCanvasVisualId(positionedVisual.id)
    pulseCanvasVisual(positionedVisual.id)
    endCanvasFieldDrag()
  }

  function handleVisualFieldDragOver(event, visual, targetField = 'auto') {
    if (!canvasDragState?.field) {
      return
    }

    event.preventDefault()
    updateCanvasDragPreview(event, visual, targetField)
    setActiveDropVisualId(visual.id)
  }

  function handleVisualFieldDragLeave(visualId) {
    setActiveDropVisualId((current) => (current === visualId ? '' : current))
  }

  function handleVisualFieldDrop(event, visual, targetField = 'auto') {
    const fieldName = canvasDragState?.field || getDraggedFieldName(event)
    if (!fieldName) {
      return
    }

    event.preventDefault()
    setCanvasVisuals((previous) =>
      previous.map((item) =>
        item.id === visual.id
          ? smartAssignFieldToVisual(item, fieldName, columnProfiles, targetField)
          : item,
      ),
    )
    setSelectedCanvasVisualId(visual.id)
    pulseCanvasVisual(visual.id)
    endCanvasFieldDrag()
  }

  function removeCanvasVisual(visualId) {
    setCanvasVisuals((previous) => previous.filter((visual) => visual.id !== visualId))
    setSelectedCanvasVisualId((current) => (current === visualId ? '' : current))
  }

  function updateCanvasVisual(visualId, updater) {
    setCanvasVisuals((previous) =>
      previous.map((visual) => {
        if (visual.id !== visualId) {
          return visual
        }

        return typeof updater === 'function' ? updater(visual) : { ...visual, ...updater }
      }),
    )
  }

  function updateCanvasField(visualId, field, value, removeValue = false, multiple = false) {
    updateCanvasVisual(visualId, (visual) => {
      let nextVisual = setCanvasField(visual, field, value, removeValue, multiple)
      const fieldType = getDisplayColumnType(value, columnProfiles)

      if (
        !removeValue &&
        fieldType === 'numeric' &&
        ['y_axis', 'values'].includes(field) &&
        !isIdentifierLikeField(value) &&
        (!visual.settings?.aggregation || visual.settings.aggregation === 'count')
      ) {
        nextVisual = updateCanvasVisualTitle({
          ...nextVisual,
          settings: {
            ...nextVisual.settings,
            aggregation: 'sum',
          },
        })
      }

      return nextVisual
    })
  }

  function updateCanvasSetting(visualId, field, value) {
    updateCanvasVisual(visualId, (visual) => {
      const nextVisual = {
        ...visual,
        type: field === 'chart_type' ? value : visual.type,
        settings: {
          ...visual.settings,
          [field]: value,
          titleTouched: field === 'title' ? true : visual.settings?.titleTouched,
        },
      }

      if (field !== 'title' && !nextVisual.settings?.titleTouched) {
        nextVisual.settings = {
          ...nextVisual.settings,
          title: getCanvasVisualTitle(nextVisual),
        }
      }

      return nextVisual
    })
  }

  function updateCanvasContent(visualId, value) {
    updateCanvasVisual(visualId, { content: value })
  }

  function startCanvasVisualDrag(event, visual, canvasScale = 1) {
    if (isFinalized) {
      return
    }

    event.preventDefault()
    event.stopPropagation()
    const canvasSize = getCanvasElementSize(blankCanvasRef.current)
    setSelectedCanvasVisualId(visual.id)
    setCanvasInteraction({
      mode: 'move',
      id: visual.id,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: visual.x,
      startY: visual.y,
      canvasWidth: canvasSize.width,
      canvasHeight: canvasSize.height,
      canvasScale,
    })
  }

  function startCanvasVisualResize(event, visual, direction, canvasScale = 1) {
    if (isFinalized) {
      return
    }

    event.preventDefault()
    event.stopPropagation()
    const canvasSize = getCanvasElementSize(blankCanvasRef.current)
    setSelectedCanvasVisualId(visual.id)
    setCanvasInteraction({
      mode: direction,
      id: visual.id,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startWidth: visual.width,
      startHeight: visual.height,
      canvasWidth: canvasSize.width,
      canvasHeight: canvasSize.height,
      canvasScale,
    })
  }

  function handleCanvasBackgroundClick(event) {
    if (event.target === blankCanvasRef.current) {
      setSelectedCanvasVisualId('')
    }
  }

  function addCustomKpi() {
    const customKpi = {
      id: `custom-kpi-${Date.now()}`,
      source: 'custom',
      type: 'custom',
      label: 'Custom KPI',
      value: formatValue(summary.total_rows ?? tableRows.length),
      hint: 'Custom metric',
    }

    setCustomKpis((previous) => [...previous, customKpi])
    setHiddenKpiKeys((previous) => previous.filter((key) => key !== customKpi.id))
    setActiveEditor({ type: 'kpi', textKey: customKpi.id })
  }

  function addCustomNote() {
    const customNote = {
      id: `note-${Date.now()}`,
      title: 'New Note',
      body: '',
    }

    setCustomNotes((previous) => [...previous, customNote])
    setActiveEditor({ type: 'note', noteId: customNote.id })
  }

  function removeChart(chartId) {
    setHiddenChartIds((previous) => (previous.includes(chartId) ? previous : [...previous, chartId]))
    setManualCharts((previous) => previous.filter((chart) => chart.id !== chartId))
    setChartOrder((previous) => previous.filter((id) => id !== chartId))
    setActiveEditor((current) => (current?.chartId === chartId ? null : current))
    setOpenChartMenuId((current) => (current === chartId ? '' : current))
  }

  function removeKpi(textKey) {
    if (textKey.startsWith('custom-kpi-')) {
      setCustomKpis((previous) => previous.filter((kpi) => kpi.id !== textKey))
    }

    setHiddenKpiKeys((previous) => (previous.includes(textKey) ? previous : [...previous, textKey]))
    setActiveEditor((current) => (current?.type === 'kpi' && current.textKey === textKey ? null : current))
  }

  function removeNote(noteId) {
    setCustomNotes((previous) => previous.filter((note) => note.id !== noteId))
    setActiveEditor((current) => (current?.type === 'note' && current.noteId === noteId ? null : current))
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
      workspaceMode,
      widgets: workspaceWidgets,
      kpis: visibleKpiCards,
      charts: visibleCharts,
      notes: customNotes,
      chartOrder: visibleCharts.map((chart) => chart.id),
      settingsById,
      hiddenChartIds,
      hiddenKpiKeys,
      manualCharts,
      customKpis,
      customChartsById,
      canvasVisuals,
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
    setCustomKpis(savedDashboard.customKpis ?? [])
    setCustomNotes(savedDashboard.notes ?? [])
    const savedCanvasVisuals = Array.isArray(savedDashboard.canvasVisuals)
      ? savedDashboard.canvasVisuals.map((visual, index) => normalizeCanvasVisual(visual, index))
      : []

    setCanvasVisuals(savedCanvasVisuals)
    setSelectedCanvasVisualId(savedCanvasVisuals[0]?.id ?? '')
    setCanvasDragState(null)
    setActiveDropVisualId('')
    setDropPulseVisualId('')
    setHydratedCanvasDatasetId(datasetId)
    setCustomChartsById(savedDashboard.customChartsById ?? {})
    setHiddenChartIds(savedDashboard.hiddenChartIds ?? [])
    setHiddenKpiKeys(savedDashboard.hiddenKpiKeys ?? [])
    setWorkspaceMode(savedDashboard.workspaceMode ?? 'suggested')
    setWorkspaceWidgets(savedDashboard.widgets ?? DEFAULT_WORKSPACE_WIDGETS)
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

  function updateChartDrivenFilter(column, rawValue) {
    const filter = filterMetadataByColumn.get(column)
    const nextFilterState = buildChartFilterState(filter, rawValue)

    if (!filter || !nextFilterState) {
      return
    }

    setFilterState((previous) => {
      const currentFilterState = previous[column]
      const next = { ...previous }

      if (filterStatesMatch(filter, currentFilterState, nextFilterState)) {
        delete next[column]
      } else {
        next[column] = nextFilterState
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

  function updateCustomKpiValue(textKey, value) {
    setCustomKpis((previous) =>
      previous.map((kpi) => (kpi.id === textKey ? { ...kpi, value } : kpi)),
    )
  }

  function updateNote(noteId, field, value) {
    setCustomNotes((previous) =>
      previous.map((note) => (note.id === noteId ? { ...note, [field]: value } : note)),
    )
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
                className="visual-secondary-button icon-only-button"
                onClick={exportDashboardPng}
                disabled={isExporting || presentationWidgetCount === 0}
                title={isExporting ? 'Exporting' : 'Export PNG'}
                aria-label={isExporting ? 'Exporting' : 'Export PNG'}
              >
                <IconButtonContent icon="image" label={isExporting ? 'Exporting' : 'Export PNG'} />
              </button>
              <button
                type="button"
                className="visual-secondary-button icon-only-button"
                onClick={exportDashboardPdf}
                disabled={isExporting || presentationWidgetCount === 0}
                title="Export PDF"
                aria-label="Export PDF"
              >
                <IconButtonContent icon="pdf" label="Export PDF" />
              </button>
              <button type="button" className="visual-secondary-button icon-only-button" onClick={returnToEditMode} title="Back to edit mode" aria-label="Back to edit mode">
                <IconButtonContent icon="back" label="Back to edit mode" />
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="visual-apply-button icon-only-button"
                onClick={finalizeDashboard}
                disabled={workspaceWidgetCount === 0}
                title="Finalize dashboard"
                aria-label="Finalize dashboard"
              >
                <IconButtonContent icon="save" label="Finalize dashboard" />
              </button>
              <button type="button" className="visual-secondary-button icon-only-button" onClick={loadSavedDashboard} title="Load saved" aria-label="Load saved">
                <IconButtonContent icon="load" label="Load saved" />
              </button>
              <button
                type="button"
                className="visual-secondary-button icon-only-button"
                onClick={regenerateDashboard}
                disabled={isLoading || !hasDatasetPayload}
                title={isLoading ? 'Generating' : 'Regenerate'}
                aria-label={isLoading ? 'Generating' : 'Regenerate'}
              >
                <IconButtonContent icon="reset" label={isLoading ? 'Generating' : 'Regenerate'} />
              </button>
              <Link to="/cleaning" className="visual-secondary-button icon-only-button" title="Back to clean" aria-label="Back to clean">
                <IconButtonContent icon="back" label="Back to clean" />
              </Link>
            </>
          )}
        </div>
      </header>

      {errorMessage || dashboardError ? (
        <p className="visual-error-banner">{dashboardError || errorMessage}</p>
      ) : null}

      {!isFinalized ? (
        <WorkspaceControlPanel
          mode={workspaceMode}
          widgetCount={workspaceWidgetCount}
          isLoading={isLoading}
          statusText={workspaceMode === 'blank' ? 'Autosaved locally' : ''}
          showWidgetBar={workspaceMode !== 'blank'}
          onBlankWorkspace={createBlankWorkspace}
          onSuggestedWorkspace={restoreSuggestedWorkspace}
          onAddChart={() => setIsBuilderOpen(true)}
          onAddKpi={addCustomKpi}
          onAddNote={addCustomNote}
        />
      ) : null}

      {shouldShowActiveFilters ? (
        <ActiveFilterChips
          activeFilters={activeFilters}
          disabled={isFiltering}
          onRemoveFilter={(column) => updateGlobalFilter(column, {})}
          onClearFilters={clearAllFilters}
        />
      ) : null}

      {workspaceMode === 'blank' ? (
        <CanvasBuilderErrorBoundary
          resetKey={`${datasetId}:${workspaceMode}:${canvasVisuals.length}:${selectedCanvasVisualId}`}
          onReset={createBlankWorkspace}
        >
          <BlankCanvasBuilder
            captureRef={dashboardCaptureRef}
            canvasRef={blankCanvasRef}
            visuals={canvasVisuals}
            selectedVisualId={selectedCanvasVisualId}
            isFinalized={isFinalized}
            dragState={canvasDragState}
            activeDropVisualId={activeDropVisualId}
            dropPulseVisualId={dropPulseVisualId}
            rows={tableRows}
            columns={tableColumns}
            columnProfiles={columnProfiles}
            filterMetadataByColumn={filterMetadataByColumn}
            filterState={filterState}
            onSelectVisual={setSelectedCanvasVisualId}
            onAddVisual={addCanvasVisual}
            onRemoveVisual={removeCanvasVisual}
            onFieldClick={handleCanvasFieldClick}
            onFieldDragStart={startCanvasFieldDrag}
            onFieldDragEnd={endCanvasFieldDrag}
            onCanvasFieldDragOver={handleCanvasFieldDragOver}
            onCanvasFieldDrop={handleCanvasFieldDrop}
            onUpdateField={updateCanvasField}
            onUpdateSetting={updateCanvasSetting}
            onUpdateContent={updateCanvasContent}
            onDragStart={startCanvasVisualDrag}
            onResizeStart={startCanvasVisualResize}
            onVisualFieldDragOver={handleVisualFieldDragOver}
            onVisualFieldDragLeave={handleVisualFieldDragLeave}
            onVisualFieldDrop={handleVisualFieldDrop}
            onCanvasBackgroundClick={handleCanvasBackgroundClick}
            onChartValueSelect={updateChartDrivenFilter}
          />
        </CanvasBuilderErrorBoundary>
      ) : (
      <div ref={dashboardCaptureRef} className="visual-dashboard-capture">
        {presentationKpis.length > 0 ? (
          <section className="visual-kpi-grid">
            {presentationKpis.map((kpi, index) => {
              const textKey = getKpiInstanceKey(kpi, index)

              return (
                <KpiCard
                  key={textKey}
                  label={kpi.label}
                  value={kpi.value}
                  hint={kpi.hint}
                  textKey={textKey}
                  textOverride={presentationKpiText[textKey]}
                  isFinalized={isFinalized}
                  onEditText={(selectedTextKey) =>
                    setActiveEditor({ type: 'kpi', textKey: selectedTextKey })
                  }
                  onRemove={removeKpi}
                />
              )
            })}
          </section>
        ) : null}

        {presentationNotes.length > 0 ? (
          <section className="visual-note-grid">
            {presentationNotes.map((note) => (
              <NoteCard
                key={note.id}
                note={note}
                isFinalized={isFinalized}
                onEdit={() => setActiveEditor({ type: 'note', noteId: note.id })}
                onRemove={() => removeNote(note.id)}
              />
            ))}
          </section>
        ) : null}

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
                    filterMetadataByColumn={filterMetadataByColumn}
                    filterState={filterState}
                    onChartValueSelect={updateChartDrivenFilter}
                  />
                ))}
              </div>
            ) : (
              <div className="visual-empty-panel">
                <h3>No visible charts</h3>
                <p>{workspaceMode === 'blank' ? 'Blank sheet' : 'Suggested dashboard is empty'}</p>
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

        </main>
      </div>
      )}

      {!isFinalized && workspaceMode !== 'blank' ? (
        <DashboardEditorPanel
          editor={activeEditor}
          chart={activeChart}
          kpi={activeKpi}
          note={activeNote}
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
          onCustomKpiValueChange={updateCustomKpiValue}
          onNoteChange={updateNote}
        />
      ) : null}
    </div>
  )
}

export default VisualizationPage
