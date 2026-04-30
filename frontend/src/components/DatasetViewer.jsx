import { useEffect, useState } from 'react'
import { useAtlas } from '../context/AtlasContext'
import { formatValue } from '../utils/formatters'

function DatasetViewer({ title, stage = 'raw' }) {
  const { datasetId, fetchDatasetTable } = useAtlas()

  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [loading, setLoading] = useState(false)
  const [tablePayload, setTablePayload] = useState(null)
  const [viewerError, setViewerError] = useState('')

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    setPage(1)
  }, [datasetId, stage])
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    async function loadRows() {
      if (!datasetId) {
        setTablePayload(null)
        return
      }

      setLoading(true)
      setViewerError('')

      try {
        const payload = await fetchDatasetTable({ stage, page, pageSize })
        setTablePayload(payload.table)
      } catch (error) {
        setViewerError(error.message)
      } finally {
        setLoading(false)
      }
    }

    loadRows()
  }, [datasetId, fetchDatasetTable, page, pageSize, stage])

  if (!datasetId) {
    return (
      <section className="table-card">
        <div className="table-head">
          <h3>{title}</h3>
        </div>
        <p className="empty-inline">Upload a dataset first to view table rows.</p>
      </section>
    )
  }

  const columns = tablePayload?.columns ?? []
  const rows = tablePayload?.rows ?? []
  const pagination = tablePayload?.pagination

  return (
    <section className="table-card full-table-viewer">
      <div className="table-head">
        <h3>{title}</h3>
        {pagination ? (
          <p>
            Showing {pagination.start_row} to {pagination.end_row} of {pagination.total_rows} rows
          </p>
        ) : null}
      </div>

      <div className="viewer-controls">
        <label htmlFor={`page-size-${stage}`}>Rows per page</label>
        <select
          id={`page-size-${stage}`}
          value={pageSize}
          onChange={(event) => {
            setPageSize(Number(event.target.value))
            setPage(1)
          }}
        >
          <option value={25}>25</option>
          <option value={50}>50</option>
          <option value={100}>100</option>
          <option value={200}>200</option>
        </select>

        <button
          type="button"
          className="table-nav-button"
          onClick={() => setPage((currentPage) => Math.max(currentPage - 1, 1))}
          disabled={!pagination?.has_previous || loading}
        >
          Previous
        </button>

        <span className="page-indicator">
          Page {pagination?.page ?? page} / {pagination?.total_pages ?? 1}
        </span>

        <button
          type="button"
          className="table-nav-button"
          onClick={() => {
            if (pagination?.has_next) {
              setPage((currentPage) => currentPage + 1)
            }
          }}
          disabled={!pagination?.has_next || loading}
        >
          Next
        </button>
      </div>

      {viewerError ? <p className="error-banner">{viewerError}</p> : null}

      {loading ? (
        <p className="empty-inline">Loading rows...</p>
      ) : columns.length > 0 && rows.length > 0 ? (
        <div className="table-wrap excel-wrap">
          <table className="excel-like-table">
            <thead>
              <tr>
                <th className="row-number-col">#</th>
                {columns.map((column) => (
                  <th key={`${stage}-head-${column}`}>{column}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => {
                const rowNumber =
                  (pagination?.start_row ?? (page - 1) * pageSize + 1) + rowIndex
                return (
                  <tr key={`${stage}-row-${rowIndex}-${rowNumber}`}>
                    <td className="row-number-col">{rowNumber}</td>
                    {columns.map((column) => (
                      <td key={`${column}-${rowIndex}`}>{formatValue(row[column], { empty: '' })}</td>
                    ))}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="empty-inline">No rows available for this stage.</p>
      )}
    </section>
  )
}

export default DatasetViewer
