import { formatValue } from '../utils/formatters'

function DatasetVersionTable({ title, side, columns, rows }) {
  const valueKey = side === 'cleaned' ? 'cleaned' : 'raw'

  return (
    <section className="comparison-dataset-panel">
      <div className="comparison-dataset-panel__head">
        <h4>{title}</h4>
        <p>{rows.length} preview rows</p>
      </div>

      <div className="table-wrap comparison-wrap comparison-wrap--side">
        <table className="comparison-table comparison-table--side">
          <thead>
            <tr>
              <th className="row-number-col">#</th>
              <th>Status</th>
              {columns.map((column) => (
                <th key={`${side}-head-${column}`}>{column}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${side}-row-${row.row_number}`} className={`comparison-row comparison-row--${row.status}`}>
                <td className="row-number-col">{row.row_number}</td>
                <td>
                  <span className={`row-flag-chip comparison-status comparison-status--${row.status}`}>
                    {row.status}
                  </span>
                </td>
                {columns.map((column) => {
                  const changed = row.changed_columns?.includes(column)
                  const missingSide =
                    (side === 'raw' && row.status === 'added') ||
                    (side === 'cleaned' && row.status === 'removed')

                  return (
                    <td
                      key={`${side}-cell-${row.row_number}-${column}`}
                      className={changed ? 'comparison-cell comparison-cell--changed' : 'comparison-cell'}
                    >
                      {missingSide
                        ? side === 'raw'
                          ? 'Not in original'
                          : 'Removed'
                        : formatValue(row[valueKey]?.[column], { empty: 'Not provided' })}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function ComparisonTable({ comparison }) {
  const columns = comparison?.columns ?? []
  const rows = comparison?.rows ?? []

  if (!comparison || columns.length === 0) {
    return (
      <section className="table-card">
        <div className="table-head">
          <h3>Original vs Cleaned Dataset</h3>
        </div>
        <p className="empty-inline">Run auto cleaning to generate a highlighted comparison.</p>
      </section>
    )
  }

  return (
    <section className="table-card comparison-card">
      <div className="table-head">
        <h3>Original vs Cleaned Dataset</h3>
        <p>
          {comparison.summary.preview_changed_rows} changed rows / {comparison.summary.preview_rows}{' '}
          preview rows
        </p>
      </div>

      <div className="comparison-legend">
        <span className="comparison-legend__item comparison-legend__item--changed">Changed cell</span>
        <span className="comparison-legend__item">Same value</span>
      </div>

      <div className="comparison-split-grid">
        <DatasetVersionTable title="Original Dataset" side="raw" columns={columns} rows={rows} />
        <DatasetVersionTable title="Cleaned Dataset" side="cleaned" columns={columns} rows={rows} />
      </div>
    </section>
  )
}

export default ComparisonTable
