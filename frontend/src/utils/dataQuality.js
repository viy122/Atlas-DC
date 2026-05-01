const NULL_TEXT_TOKENS = new Set(['', '-', '--', 'n/a', 'na', 'null', 'none', 'unknown'])

function normalizeColumnName(columnName = '') {
  return String(columnName).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
}

function isMissingValue(value) {
  if (value === null || value === undefined) {
    return true
  }

  if (typeof value === 'number') {
    return Number.isNaN(value)
  }

  return NULL_TEXT_TOKENS.has(String(value).trim().toLowerCase())
}

function getColumnValues(rows = [], columnName) {
  return rows
    .map((row) => row?.[columnName])
    .filter((value) => !isMissingValue(value))
}

function parseNumeric(value) {
  const normalized = String(value)
    .replaceAll(',', '')
    .replace(/[^\d.+-]/g, '')
    .trim()

  if (!normalized) {
    return Number.NaN
  }

  return Number(normalized)
}

function getNumericLikeRatio(values = []) {
  if (!values.length) {
    return 0
  }

  const parsedCount = values.filter((value) => Number.isFinite(parseNumeric(value))).length
  return parsedCount / values.length
}

function getDateLikeRatio(values = []) {
  if (!values.length) {
    return 0
  }

  const datePattern = /(?:\d{1,4}[-/]\d{1,2}[-/]\d{1,4})|(?:[A-Za-z]{3,9}\s+\d{1,2},?\s+\d{2,4})/
  const parsedCount = values.filter((value) => {
    const text = String(value).trim()
    return datePattern.test(text) && !Number.isNaN(Date.parse(text))
  }).length

  return parsedCount / values.length
}

function isTextDtype(dtype = '') {
  const normalized = String(dtype).toLowerCase()
  return normalized.includes('object') || normalized.includes('string')
}

function isDateName(columnName = '') {
  return /date|time|day|month|year|created|updated|timestamp/.test(normalizeColumnName(columnName))
}

function isCriticalName(columnName = '') {
  return /(^|_)(id|email|username|primary_key|primarykey)($|_)/.test(normalizeColumnName(columnName))
}

function isRequiredCandidate(columnName = '') {
  return /name|status|category|product|city|region|department|customer/.test(normalizeColumnName(columnName))
}

function countDuplicateRows(rows = [], columns = []) {
  if (!rows.length || !columns.length) {
    return 0
  }

  const seen = new Set()
  let duplicates = 0

  for (const row of rows) {
    const signature = JSON.stringify(columns.map((column) => row?.[column] ?? null))
    if (seen.has(signature)) {
      duplicates += 1
    } else {
      seen.add(signature)
    }
  }

  return duplicates
}

function countDuplicateKeys(rows = [], columns = []) {
  let duplicateKeys = 0

  for (const column of columns.filter(isCriticalName)) {
    const seen = new Set()
    const duplicates = new Set()

    for (const value of getColumnValues(rows, column)) {
      const normalized = String(value).trim().toLowerCase()
      if (seen.has(normalized)) {
        duplicates.add(normalized)
      } else {
        seen.add(normalized)
      }
    }

    duplicateKeys += duplicates.size
  }

  return duplicateKeys
}

function countTextConsistencyIssues(profile, rows = []) {
  const textColumns = (profile?.column_profiles ?? []).filter((column) => isTextDtype(column.dtype))
  let issueColumns = 0

  for (const column of textColumns) {
    const values = getColumnValues(rows, column.name).slice(0, 80).map((value) => String(value))
    if (!values.length) {
      continue
    }

    const hasExtraSpacing = values.some((value) => value.trim() !== value || /\s{2,}/.test(value))
    const hasMixedCaseName = /name|city|region|category|department/.test(normalizeColumnName(column.name))
      && values.some((value) => /[a-z]/.test(value) && /[A-Z]/.test(value) && value !== value.replace(/\b\w/g, (letter) => letter.toUpperCase()))

    if (hasExtraSpacing || hasMixedCaseName) {
      issueColumns += 1
    }
  }

  return issueColumns
}

function clampScore(value) {
  if (!Number.isFinite(value)) {
    return 0
  }

  return Math.max(0, Math.min(100, value))
}

export function buildQualityReport(profile, rows = [], options = {}) {
  const rowCount = Number(profile?.rows ?? rows.length ?? 0)
  const columnProfiles = profile?.column_profiles ?? []
  const columnCount = Number(profile?.columns_count ?? columnProfiles.length ?? 0)
  const columns = profile?.columns ?? columnProfiles.map((column) => column.name)
  const totalCells = rowCount * columnCount
  const missingCells = columnProfiles.reduce((sum, column) => sum + Number(column.missing_values ?? 0), 0)
  const duplicateRows = Number(options.duplicateRows ?? countDuplicateRows(rows, columns))
  const duplicateKeys = Number(options.duplicateKeys ?? countDuplicateKeys(rows, columns))
  const typeIssueColumns = columnProfiles.filter((column) => {
    if (!isTextDtype(column.dtype)) {
      return false
    }

    const values = getColumnValues(rows, column.name).slice(0, 80)
    return getNumericLikeRatio(values) >= 0.8 || (isDateName(column.name) && getDateLikeRatio(values) >= 0.65)
  }).length
  const consistencyIssues = countTextConsistencyIssues(profile, rows) + duplicateKeys

  const completeness = totalCells ? ((totalCells - missingCells) / totalCells) * 100 : 0
  const uniqueness = rowCount ? ((rowCount - duplicateRows) / rowCount) * 100 : 0
  const typeReadiness = columnCount ? ((columnCount - typeIssueColumns) / columnCount) * 100 : 100
  const consistency = columnCount ? ((columnCount - consistencyIssues) / columnCount) * 100 : 100
  const score = (
    clampScore(completeness) * 0.4
    + clampScore(uniqueness) * 0.2
    + clampScore(typeReadiness) * 0.2
    + clampScore(consistency) * 0.2
  )

  return {
    score: clampScore(score),
    dimensions: [
      { label: 'Completeness', score: clampScore(completeness), detail: `${missingCells} missing cells` },
      { label: 'Uniqueness', score: clampScore(uniqueness), detail: `${duplicateRows} duplicate rows` },
      { label: 'Type Readiness', score: clampScore(typeReadiness), detail: `${typeIssueColumns} type issues` },
      { label: 'Consistency', score: clampScore(consistency), detail: `${consistencyIssues} consistency issues` },
    ],
    missingCells,
    duplicateRows,
    duplicateKeys,
    typeIssueColumns,
    consistencyIssues,
  }
}

export function buildCleaningRecommendations(profile, rows = []) {
  const columnProfiles = profile?.column_profiles ?? []
  const columns = profile?.columns ?? columnProfiles.map((column) => column.name)
  const missingColumns = columnProfiles.filter((column) => Number(column.missing_values ?? 0) > 0)
  const duplicateRows = countDuplicateRows(rows, columns)
  const duplicateKeys = countDuplicateKeys(rows, columns)
  const numericLikeColumns = []
  const dateLikeColumns = []
  const textConsistencyColumns = []

  for (const column of columnProfiles) {
    const values = getColumnValues(rows, column.name).slice(0, 100)

    if (isTextDtype(column.dtype) && getNumericLikeRatio(values) >= 0.8) {
      numericLikeColumns.push(column.name)
    }

    if (isTextDtype(column.dtype) && (isDateName(column.name) || getDateLikeRatio(values) >= 0.75) && getDateLikeRatio(values) >= 0.6) {
      dateLikeColumns.push(column.name)
    }

    if (isTextDtype(column.dtype) && countTextConsistencyIssues({ column_profiles: [column] }, rows) > 0) {
      textConsistencyColumns.push(column.name)
    }
  }

  const criticalColumns = columns.filter(isCriticalName)
  const requiredColumns = missingColumns
    .map((column) => column.name)
    .filter((column) => !isCriticalName(column) && isRequiredCandidate(column))
  const recommendations = []

  if (numericLikeColumns.length) {
    recommendations.push({
      id: 'convert-numeric',
      title: 'Convert numeric-looking text',
      confidence: 96,
      impact: `${numericLikeColumns.slice(0, 4).join(', ')}${numericLikeColumns.length > 4 ? '...' : ''}`,
      reason: 'These fields contain mostly parseable numbers but are not typed as measures yet.',
      ruleKeys: ['convert_numeric_columns'],
    })
  }

  if (dateLikeColumns.length) {
    recommendations.push({
      id: 'convert-dates',
      title: 'Convert date-like columns',
      confidence: 94,
      impact: `${dateLikeColumns.slice(0, 4).join(', ')}${dateLikeColumns.length > 4 ? '...' : ''}`,
      reason: 'Date-ready fields unlock trend charts, date filters, and valid time comparisons.',
      ruleKeys: ['convert_datetime_columns'],
    })
  }

  if (missingColumns.length) {
    recommendations.push({
      id: 'handle-missing',
      title: 'Handle missing values',
      confidence: 91,
      impact: `${missingColumns.length} column(s) contain missing cells`,
      reason: 'Completeness directly affects statistics, filters, and dashboard trust.',
      ruleKeys: ['normalize_placeholder_nulls', 'fill_numeric_missing'],
    })
  }

  if (duplicateRows > 0) {
    recommendations.push({
      id: 'remove-duplicates',
      title: 'Remove exact duplicate rows',
      confidence: 98,
      impact: `${duplicateRows} duplicate row(s) detected`,
      reason: 'Exact duplicates can inflate totals and counts.',
      ruleKeys: ['remove_duplicates'],
    })
  }

  if (duplicateKeys > 0 || criticalColumns.length) {
    recommendations.push({
      id: 'protect-keys',
      title: 'Protect identifier fields',
      confidence: duplicateKeys > 0 ? 95 : 88,
      impact: criticalColumns.length ? criticalColumns.join(', ') : `${duplicateKeys} duplicate key value(s)`,
      reason: 'Identifier and email fields should be validated, required, and protected from unsafe edits.',
      ruleKeys: ['drop_critical_missing', 'flag_duplicate_keys', 'validate_emails'],
    })
  }

  if (textConsistencyColumns.length) {
    recommendations.push({
      id: 'standardize-text',
      title: 'Standardize text formats',
      confidence: 89,
      impact: `${textConsistencyColumns.slice(0, 4).join(', ')}${textConsistencyColumns.length > 4 ? '...' : ''}`,
      reason: 'Consistent labels prevent duplicate categories caused by spacing or casing differences.',
      ruleKeys: ['standardize_text'],
    })
  }

  return {
    recommendations,
    recommendedOptions: recommendations.reduce((options, recommendation) => {
      for (const key of recommendation.ruleKeys) {
        options[key] = true
      }
      return options
    }, {}),
    criticalKeywords: criticalColumns.length ? criticalColumns.join(',') : 'id,email',
    requiredKeywords: [...new Set(requiredColumns)].join(','),
    duplicateRows,
    duplicateKeys,
  }
}
