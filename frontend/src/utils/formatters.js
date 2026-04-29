export function formatValue(value) {
  if (value === null || value === undefined || value === '') {
    return '-'
  }

  if (typeof value === 'number') {
    return new Intl.NumberFormat().format(value)
  }

  return String(value)
}

export function formatBytes(bytes) {
  if (!bytes) {
    return '0 B'
  }

  const units = ['B', 'KB', 'MB', 'GB']
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const scaled = bytes / 1024 ** exponent

  return `${scaled.toFixed(exponent === 0 ? 0 : 2)} ${units[exponent]}`
}

export function formatPercent(value, digits = 0) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return '-'
  }

  return `${Number(value).toFixed(digits)}%`
}

export function formatDateTime(value) {
  if (!value) {
    return '-'
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return '-'
  }

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
}

export function formatDataType(dtype = '') {
  const normalized = String(dtype).toLowerCase()

  if (normalized.includes('int') || normalized.includes('float') || normalized.includes('number')) {
    return 'NUMBER'
  }

  if (normalized.includes('bool')) {
    return 'BOOLEAN'
  }

  if (normalized.includes('date') || normalized.includes('time')) {
    return 'DATETIME'
  }

  return 'STRING'
}

export function totalMissing(columnProfiles = []) {
  return columnProfiles.reduce((sum, column) => sum + (column.missing_values ?? 0), 0)
}
