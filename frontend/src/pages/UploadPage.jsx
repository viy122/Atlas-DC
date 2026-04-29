import { useMemo } from 'react'
import MetricCard from '../components/MetricCard'
import { useAtlas } from '../context/AtlasContext'
import {
  formatBytes,
  formatDataType,
  formatDateTime,
  formatPercent,
  totalMissing,
} from '../utils/formatters'

function ImportDatasetButton({ busy, onFileSelect, label = 'Import Data' }) {
  return (
    <label className={`primary-button import-button${busy ? ' is-busy' : ''}`}>
      <span>{busy ? 'Importing...' : label}</span>
      <input
        type="file"
        accept=".csv,.xlsx,.xls"
        onChange={(event) => {
          const selectedFile = event.target.files?.[0]
          if (selectedFile) {
            onFileSelect(selectedFile)
          }

          event.target.value = ''
        }}
        disabled={busy}
      />
    </label>
  )
}

function UploadPage() {
  const {
    datasetId,
    fileName,
    datasetMeta,
    uploadedDataset,
    rawProfile,
    cleanedProfile,
    cleaningSummary,
    analysis,
    busyAction,
    errorMessage,
    uploadDataset,
    runAutoClean,
    generateDashboard,
    resetWorkspace,
  } = useAtlas()

  const rawMissing = totalMissing(rawProfile?.column_profiles ?? [])
  const cleanedMissing = totalMissing(cleanedProfile?.column_profiles ?? [])
  const hiddenFlagColumns = useMemo(
    () => new Set(['missing_required_field', 'duplicate_primary_key_flag']),
    [],
  )

  const displayColumns = useMemo(
    () => uploadedDataset.columns.filter((column) => !hiddenFlagColumns.has(column)),
    [uploadedDataset.columns, hiddenFlagColumns],
  )

  const flaggedMissingRequiredRows = Number(cleaningSummary?.missing_required_field_rows ?? 0)
  const flaggedDuplicateKeyRows = Number(cleaningSummary?.duplicate_primary_key_rows ?? 0)

  const columnProfilesByName = useMemo(
    () =>
      new Map((rawProfile?.column_profiles ?? []).map((column) => [column.name, column])),
    [rawProfile],
  )

  const dataTypeCounts = useMemo(() => {
    const totals = { NUMBER: 0, STRING: 0, BOOLEAN: 0, DATETIME: 0 }

    for (const column of rawProfile?.column_profiles ?? []) {
      const label = formatDataType(column.dtype)
      totals[label] = (totals[label] ?? 0) + 1
    }

    return totals
  }, [rawProfile])

  const qualityScore = useMemo(() => {
    if (!rawProfile?.rows || !rawProfile?.columns_count) {
      return 0
    }

    const totalCells = rawProfile.rows * rawProfile.columns_count
    return Math.max(0, ((totalCells - rawMissing) / totalCells) * 100)
  }, [rawMissing, rawProfile])

  const numericSummary = analysis?.numeric_summary?.slice(0, 4) ?? []

  const cleaningCapabilities = [
    {
      label: 'Handle Missing Values',
      status: cleanedProfile
        ? `${cleaningSummary?.missing_values_filled ?? 0} filled`
        : 'Ready to apply',
    },
    {
      label: 'Remove Duplicates',
      status: cleanedProfile
        ? `${cleaningSummary?.duplicates_removed ?? 0} removed`
        : 'Ready to apply',
    },
    {
      label: 'Convert Data Types',
      status: cleanedProfile
        ? `${cleaningSummary?.date_columns_converted?.length ?? 0} converted`
        : 'Auto-detect dates',
    },
    {
      label: 'Standardize Formats',
      status: cleanedProfile
        ? `${cleaningSummary?.text_columns_standardized?.length ?? 0} columns normalized`
        : 'Whitespace and text cleanup',
    },
    {
      label: 'Filter Invalid Data',
      status: cleanedProfile
        ? `${cleaningSummary?.invalid_rows_removed ?? 0} rows filtered`
        : 'Invalid rows review ready',
    },
  ]

  const editorFormula = useMemo(() => {
    if (!rawProfile?.column_profiles?.length) {
      return '= Upload a CSV or Excel file to start the query view.'
    }

    const typeMap = {
      NUMBER: 'number',
      STRING: 'text',
      BOOLEAN: 'logical',
      DATETIME: 'date',
    }

    const columnTypes = rawProfile.column_profiles
      .slice(0, 6)
      .map(
        (column) =>
          `{"${column.name}", type ${typeMap[formatDataType(column.dtype)] ?? 'text'}}`,
      )
      .join(', ')

    return `= Table.TransformColumnTypes(#"Promoted Headers", {${columnTypes}})`
  }, [rawProfile])

  return (
    <div className="page-grid dataset-page">
      <section className="page-header dataset-page__header">
        <div>
          <h1>Datasets</h1>
          <p>Manage, explore, clean, and analyze your uploaded data sources.</p>
        </div>

        <ImportDatasetButton busy={busyAction === 'uploading'} onFileSelect={uploadDataset} />
      </section>

      <section className="dataset-layout dataset-layout--editor">
        <div className="dataset-stack">
          <section className="surface-card dataset-card dataset-card--editor">
            {datasetId ? (
              <>
                <div className="card-header card-header--dataset card-header--editor">
                  <div>
                    <div className="title-row">
                      <h2>{fileName}</h2>
                      <span className="status-badge status-badge--success">Active</span>
                    </div>
                    <p>Uploaded on {formatDateTime(datasetMeta.uploadedAt)}</p>
                  </div>
                </div>

                {busyAction === 'cleaning' ? (
                  <p className="info-banner">Cleaning in progress... applying fill, type fixes, and duplicate removal.</p>
                ) : null}

                {errorMessage ? <p className="error-banner">{errorMessage}</p> : null}

                <div className="editor-toolbar">
                  <div className="editor-toolbar__group">
                    <button type="button" className="editor-toolbar__button">
                      Close
                    </button>
                    <button type="button" className="editor-toolbar__button">
                      Apply
                    </button>
                    <button type="button" className="editor-toolbar__button">
                      Types
                    </button>
                  </div>

                  <div className="editor-toolbar__group">
                    <button
                      type="button"
                      className="editor-toolbar__button"
                      onClick={generateDashboard}
                      disabled={busyAction === 'dashboarding'}
                    >
                      Refresh
                    </button>
                    <button
                      type="button"
                      className="editor-toolbar__button"
                      onClick={runAutoClean}
                      disabled={busyAction === 'cleaning'}
                    >
                      Clean
                    </button>
                  </div>
                </div>

                <div className="editor-formula-bar">
                  <span className="editor-formula-bar__fx">fx</span>
                  <div className="editor-formula-bar__input">{editorFormula}</div>
                </div>

                <div className="dataset-summary-grid dataset-summary-grid--compact">
                  <div className="stat-tile">
                    <span>Rows</span>
                    <strong>{rawProfile?.rows ?? 0}</strong>
                  </div>
                  <div className="stat-tile">
                    <span>Columns</span>
                    <strong>{rawProfile?.columns_count ?? 0}</strong>
                  </div>
                  <div className="stat-tile">
                    <span>Size</span>
                    <strong>{formatBytes(datasetMeta.sizeBytes)}</strong>
                  </div>
                  <div className="stat-tile stat-tile--quality">
                    <div className="quality-row">
                      <span>Quality</span>
                      <strong>{formatPercent(qualityScore, 0)}</strong>
                    </div>
                    <div className="quality-bar">
                      <div className="quality-bar__fill" style={{ width: `${qualityScore}%` }} />
                    </div>
                  </div>
                </div>

                <div className="dataset-table-shell dataset-table-shell--editor">
                  <div className="dataset-table-scroll dataset-table-scroll--editor">
                    <table className="dataset-grid-table dataset-grid-table--editor">
                      <thead>
                        <tr>
                          <th className="row-status-col">Status</th>
                          <th className="row-index-col">#</th>
                          {displayColumns.map((column) => {
                            const profile = columnProfilesByName.get(column)

                            return (
                              <th key={column}>
                                <span className="column-title">{column}</span>
                                <span className="column-meta">
                                  {formatDataType(profile?.dtype)} / {profile?.missing_values ?? 0}{' '}
                                  null
                                </span>
                              </th>
                            )
                          })}
                        </tr>
                      </thead>
                      <tbody>
                        {uploadedDataset.rows.map((row, rowIndex) => (
                          <tr
                            key={`dataset-row-${rowIndex}`}
                            className={`${row?.missing_required_field ? 'row-flag-missing-required' : ''} ${row?.duplicate_primary_key_flag ? 'row-flag-duplicate-key' : ''}`.trim()}
                          >
                            <td className="row-status-col">
                              {row?.missing_required_field ? (
                                <span className="row-flag-chip row-flag-chip--missing">Missing Required</span>
                              ) : row?.duplicate_primary_key_flag ? (
                                <span className="row-flag-chip row-flag-chip--duplicate">Duplicate Key</span>
                              ) : (
                                <span className="row-flag-chip row-flag-chip--clean">Clean</span>
                              )}
                            </td>
                            <td className="row-index-col">{rowIndex + 1}</td>
                            {displayColumns.map((column) => (
                              <td key={`${column}-${rowIndex}`}>{String(row[column] ?? '-')}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>


                </div>
              </>
            ) : (
              <div className="empty-panel">
                <h2>No dataset loaded yet</h2>
                <p>Import a CSV or Excel file to open the data-first workspace.</p>
                <ImportDatasetButton
                  busy={busyAction === 'uploading'}
                  onFileSelect={uploadDataset}
                  label="Import your first dataset"
                />
              </div>
            )}
          </section>

          {datasetId ? (
            <div className="content-grid content-grid--two">
              <section className="surface-card">
                <div className="card-header">
                  <div>
                    <h2>Data Profiling</h2>
                    <p>Shape, missingness, data types, and basic numeric statistics.</p>
                  </div>
                </div>

                <div className="metric-grid">
                  <MetricCard
                    label="Rows"
                    value={rawProfile?.rows ?? 0}
                    hint="Total records detected."
                  />
                  <MetricCard
                    label="Columns"
                    value={rawProfile?.columns_count ?? 0}
                    hint="Fields inferred from the source file."
                  />
                  <MetricCard
                    label="Number Fields"
                    value={dataTypeCounts.NUMBER}
                    hint="Columns suitable for numeric statistics."
                  />
                  <MetricCard
                    label="Missing Values"
                    value={rawMissing}
                    hint="Null or empty values across the dataset."
                  />
                </div>

                <div className="profile-breakdown-grid">
                  <article className="mini-panel">
                    <h3>Detected Data Types</h3>
                    <div className="type-summary-list">
                      <div>
                        <span>String</span>
                        <strong>{dataTypeCounts.STRING}</strong>
                      </div>
                      <div>
                        <span>Number</span>
                        <strong>{dataTypeCounts.NUMBER}</strong>
                      </div>
                      <div>
                        <span>Boolean</span>
                        <strong>{dataTypeCounts.BOOLEAN}</strong>
                      </div>
                      <div>
                        <span>Date/Time</span>
                        <strong>{dataTypeCounts.DATETIME}</strong>
                      </div>
                    </div>
                  </article>

                  <article className="mini-panel">
                    <h3>Basic Statistics</h3>
                    {numericSummary.length > 0 ? (
                      <div className="stat-list">
                        {numericSummary.map((item) => (
                          <div key={item.column} className="stat-list__row">
                            <div>
                              <strong>{item.column}</strong>
                              <span>
                                Mean {item.mean ?? '-'} / Median {item.median ?? '-'}
                              </span>
                            </div>
                            <em>
                              Min {item.min ?? '-'} / Max {item.max ?? '-'}
                            </em>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="empty-state-inline">
                        Statistics will appear after the upload is processed.
                      </p>
                    )}
                  </article>
                </div>
              </section>

              <section className="surface-card">
                <div className="card-header">
                  <div>
                    <h2>Cleaning Studio</h2>
                    <p>Run core cleanup actions and review the transformation summary.</p>
                  </div>
                  <div className="card-actions">
                    <button
                      type="button"
                      className="primary-button"
                      onClick={runAutoClean}
                      disabled={busyAction === 'cleaning'}
                    >
                      {busyAction === 'cleaning' ? 'Cleaning...' : 'Run Auto Cleaning'}
                    </button>
                    <button type="button" className="ghost-button" onClick={resetWorkspace}>
                      Reset
                    </button>
                  </div>
                </div>

                <div className="cleaning-capability-list">
                  {cleaningCapabilities.map((item) => (
                    <article key={item.label} className="capability-card">
                      <strong>{item.label}</strong>
                      <span>{item.status}</span>
                    </article>
                  ))}
                </div>

                {cleanedProfile ? (
                  <div className="metric-grid">
                    <MetricCard
                      label="Missing After Clean"
                      value={cleanedMissing}
                      hint="Remaining gaps after the cleaning step."
                    />
                    <MetricCard
                      label="Duplicates Removed"
                      value={cleaningSummary?.duplicates_removed ?? 0}
                      hint="Duplicate records removed."
                    />
                    <MetricCard
                      label="Dates Converted"
                      value={cleaningSummary?.date_columns_converted?.length ?? 0}
                      hint="Columns converted to datetime."
                    />
                    <MetricCard
                      label="Invalid Rows Filtered"
                      value={cleaningSummary?.invalid_rows_removed ?? 0}
                      hint="Rows removed during invalid-data filtering."
                    />
                    <MetricCard
                      label="Missing Required (Flagged)"
                      value={flaggedMissingRequiredRows}
                      hint="Rows kept but missing required business fields."
                    />
                    <MetricCard
                      label="Duplicate PK (Flagged)"
                      value={flaggedDuplicateKeyRows}
                      hint="Rows flagged for duplicate identifier values."
                    />
                  </div>
                ) : (
                  <p className="empty-state-inline">
                    Cleaning has not been applied yet. Run Auto Cleaning to generate the cleaned dataset view.
                  </p>
                )}
              </section>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  )
}

export default UploadPage
