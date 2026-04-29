import { formatValue } from '../utils/formatters'

function ExcelDataTable({
  title,
  columns = [],
  rows = [],
  fileName = '',
  emptyMessage = 'Upload a dataset to view it here.',
}) {
  const hasColumns = columns.length > 0

  return (
    <section className="panel">
      <div className="section-title-row">
        <div>
          <h3>{title}</h3>
          <p>{fileName || 'No active dataset'}</p>
        </div>
        <p>
          {rows.length} rows / {columns.length} columns
        </p>
      </div>

      {hasColumns ? (
        <div className="excel-viewer-shell">
          <div className="excel-viewer-scroll">
            <table className="excel-like-table">
              <thead>
                <tr>
                  <th className="row-number-col">#</th>
                  {columns.map((column) => (
                    <th key={column}>{column}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.length > 0 ? (
                  rows.map((row, rowIndex) => (
                    <tr key={`excel-row-${rowIndex}`}>
                      <td className="row-number-col">{rowIndex + 1}</td>
                      {columns.map((column) => (
                        <td key={`${column}-${rowIndex}`}>{formatValue(row[column])}</td>
                      ))}
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td className="row-number-col">1</td>
                    <td colSpan={columns.length} className="excel-empty-cell">
                      No rows found in this dataset.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <p className="empty-inline">{emptyMessage}</p>
      )}
    </section>
  )
}

export default ExcelDataTable
