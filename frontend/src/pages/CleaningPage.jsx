import { useMemo, useState } from 'react'
import DataTable from '../components/DataTable'
import MetricCard from '../components/MetricCard'
import { useAtlas } from '../context/AtlasContext'
import { totalMissing } from '../utils/formatters'

const CLEANING_RULES = [
  'Duplicate rows are removed.',
  'Numeric missing values are filled with median.',
  'Text missing values are filled with mode or Unknown.',
  'Date-like text columns are auto-converted to datetime.',
]

function CleaningPage() {
  const [file, setFile] = useState(null)

  const {
    datasetId,
    fileName,
    rawProfile,
    cleanedProfile,
    cleaningSummary,
    busyAction,
    errorMessage,
    uploadDataset,
    clearError,
  } = useAtlas()

  const rawMissingTotal = useMemo(
    () => totalMissing(rawProfile?.column_profiles ?? []),
    [rawProfile],
  )
  const cleanedMissingTotal = useMemo(
    () => totalMissing(cleanedProfile?.column_profiles ?? []),
    [cleanedProfile],
  )

  async function handleUpload(event) {
    event.preventDefault()
    await uploadDataset(file)
  }

  function onFileChange(event) {
    const selectedFile = event.target.files?.[0] ?? null
    setFile(selectedFile)
    clearError()
  }

  return (
    <div className="page-grid">
      <section className="panel page-hero">
        <div className="page-hero-content">
          <p className="page-kicker">Stage 03 / Cleaning</p>
          <h2>Apply lightweight cleaning rules while keeping the raw and cleaned states easy to compare.</h2>
          <p>
            This module is designed for fast validation: upload, run the default cleanup rules,
            and compare the before-and-after preview with minimal friction.
          </p>

          <div className="page-hero-meta">
            <div className="hero-stat">
              <span>Raw missing cells</span>
              <strong>{rawMissingTotal}</strong>
            </div>
            <div className="hero-stat">
              <span>Cleaned missing</span>
              <strong>{cleanedMissingTotal}</strong>
            </div>
            <div className="hero-stat">
              <span>Duplicates removed</span>
              <strong>{cleaningSummary?.duplicates_removed ?? 0}</strong>
            </div>
          </div>
        </div>

        <aside className="hero-side-card">
          <div>
            <h3>Cleaning Focus</h3>
            <p>Use this page to reduce noise first before deeper analysis or visualization.</p>
          </div>
          <div className="hero-side-list">
            <div className="hero-side-item">
              <span>Dataset</span>
              <strong>{fileName || 'No file loaded'}</strong>
            </div>
            <div className="hero-side-item">
              <span>Current state</span>
              <strong>{cleanedProfile ? 'Cleaned dataset ready' : 'Raw dataset only'}</strong>
            </div>
            <div className="hero-side-item">
              <span>Next stage</span>
              <strong>{cleanedProfile ? 'Analysis' : 'Run auto cleaning'}</strong>
            </div>
          </div>
        </aside>
      </section>

      <section className="panel cleaning-controls-panel">
        <form className="upload-bar" onSubmit={handleUpload}>
          <label className="file-input" htmlFor="upload-file">
            <span>{file ? file.name : 'Choose CSV/XLSX file for cleaning'}</span>
            <input
              id="upload-file"
              type="file"
              accept=".csv,.xlsx,.xls"
              onChange={onFileChange}
            />
          </label>
          <button
            type="submit"
            className="action-button"
            disabled={!file || busyAction === 'uploading'}
          >
            {busyAction === 'uploading' ? 'Uploading...' : 'Upload Dataset'}
          </button>


        </form>

        <div className="rules-box">
          <h3>Auto Cleaning Rules</h3>
          <ul>
            {CLEANING_RULES.map((rule) => (
              <li key={rule}>{rule}</li>
            ))}
          </ul>
          {datasetId ? <p className="dataset-note">Active file: {fileName || datasetId}</p> : null}
        </div>

        {errorMessage ? <p className="error-banner">{errorMessage}</p> : null}
      </section>

      {(rawProfile || cleanedProfile) ? (
        <section className="split-panels">
          {rawProfile ? (
            <section className="panel">
              <div className="section-title-row">
                <h3>Raw Dataset</h3>
                <p>Before cleaning</p>
              </div>

              <div className="metric-grid">
                <MetricCard label="Rows" value={rawProfile.rows} hint="Original dataset size." />
                <MetricCard
                  label="Columns"
                  value={rawProfile.columns_count}
                  hint="Fields detected from the upload."
                />
                <MetricCard
                  label="Missing Cells"
                  value={rawMissingTotal}
                  hint="Primary signal for cleanup."
                />
                <MetricCard label="File" value={fileName || '-'} hint="Currently active file." />
              </div>

              <DataTable
                title="Raw Data Preview"
                columns={rawProfile.columns}
                rows={rawProfile.preview}
                emptyMessage="No raw data preview yet."
              />
            </section>
          ) : null}

          {cleanedProfile ? (
            <section className="panel">
              <div className="section-title-row">
                <h3>Cleaned Dataset</h3>
                <p>After applying default rules</p>
              </div>

              <div className="metric-grid">
                <MetricCard label="Rows" value={cleanedProfile.rows} hint="Rows after cleaning." />
                <MetricCard
                  label="Columns"
                  value={cleanedProfile.columns_count}
                  hint="Column count after cleanup."
                />
                <MetricCard
                  label="Missing Cells"
                  value={cleanedMissingTotal}
                  hint="Remaining gaps after fill rules."
                />
                <MetricCard
                  label="Duplicates Removed"
                  value={cleaningSummary?.duplicates_removed ?? 0}
                  hint="Rows removed during deduplication."
                />
              </div>

              <div className="metric-grid">
                <MetricCard
                  label="Missing Filled"
                  value={cleaningSummary?.missing_values_filled ?? 0}
                  hint="Cells completed by rules."
                />
                <MetricCard
                  label="Date Columns"
                  value={cleaningSummary?.date_columns_converted?.length ?? 0}
                  hint="Text columns converted to datetime."
                />
                <MetricCard
                  label="Rows Before"
                  value={cleaningSummary?.rows_before ?? rawProfile?.rows ?? 0}
                  hint="Original row count."
                />
                <MetricCard
                  label="Rows After"
                  value={cleaningSummary?.rows_after ?? cleanedProfile.rows}
                  hint="Current cleaned row count."
                />
              </div>

              <DataTable
                title="Cleaned Data Preview"
                columns={cleanedProfile.columns}
                rows={cleanedProfile.preview}
                emptyMessage="No cleaned data preview yet."
              />
            </section>
          ) : null}
        </section>
      ) : null}

      {cleanedProfile ? (
        <section className="panel">
          <div className="section-title-row">
            <h3>Cleaning Outcome</h3>
            <p>Quick summary of the transformation</p>
          </div>

          <div className="summary-slab-grid">
            <article className="summary-slab">
              <h3>Duplicates handled</h3>
              <p>Rows dropped because they were exact matches.</p>
              <strong>{cleaningSummary?.duplicates_removed ?? 0}</strong>
            </article>
            <article className="summary-slab">
              <h3>Missing values filled</h3>
              <p>Numeric fields use median, text fields use mode or fallback values.</p>
              <strong>{cleaningSummary?.missing_values_filled ?? 0}</strong>
            </article>
            <article className="summary-slab">
              <h3>Date parsing applied</h3>
              <p>Columns converted from text into datetime based on detected patterns.</p>
              <strong>{cleaningSummary?.date_columns_converted?.length ?? 0}</strong>
            </article>
          </div>
        </section>
      ) : null}
    </div>
  )
}

export default CleaningPage
