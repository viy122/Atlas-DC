import { formatValue } from '../utils/formatters'

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

      <div className="table-wrap comparison-wrap">
        <table className="comparison-table">
          <thead>
            <tr>
              <th className="row-number-col">#</th>
              <th>Status</th>
              {columns.map((column) => (
                <th key={`compare-head-${column}`}>{column}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`compare-row-${row.row_number}`} className={`comparison-row comparison-row--${row.status}`}>
                <td className="row-number-col">{row.row_number}</td>
                <td>
                  <span className={`row-flag-chip comparison-status comparison-status--${row.status}`}>
                    {row.status}
                  </span>
                </td>
                {columns.map((column) => {
                  const changed = row.changed_columns?.includes(column)

                  return (
                    <td
                      key={`compare-cell-${row.row_number}-${column}`}
                      className={changed ? 'comparison-cell comparison-cell--changed' : 'comparison-cell'}
                    >
                      <div>
                        <span>Original</span>
                        <strong>{formatValue(row.raw?.[column])}</strong>
                      </div>
                      <div>
                        <span>Cleaned</span>
                        <strong>{formatValue(row.cleaned?.[column])}</strong>
                      </div>
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

export default ComparisonTable
