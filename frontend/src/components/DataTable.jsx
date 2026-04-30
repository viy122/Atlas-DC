import { formatValue } from '../utils/formatters'

function DataTable({ title, columns = [], rows = [], emptyMessage = 'No rows to display yet.' }) {
  return (
    <section className="table-card">
      <div className="table-head">
        <h3>{title}</h3>
        <p>
          {rows.length} rows shown / {columns.length} columns
        </p>
      </div>

      {columns.length > 0 && rows.length > 0 ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {columns.map((column) => (
                  <th key={column}>{column}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={`${title}-row-${rowIndex}`}>
                  {columns.map((column) => (
                    <td key={`${column}-${rowIndex}`}>{formatValue(row[column], { empty: '' })}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="empty-inline">{emptyMessage}</p>
      )}
    </section>
  )
}

export default DataTable
