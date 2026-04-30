import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAtlas } from '../context/AtlasContext'
import { formatBytes, formatDataType, formatDateTime, totalMissing } from '../utils/formatters'

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

function cloneRows(rows) {
  return rows.map((row) => ({ ...row }))
}

function normalizeCsvValue(value) {
  if (value === null || value === undefined) {
    return ''
  }

  const text = String(value)
  if (/[",\n\r]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`
  }

  return text
}

function UploadPage() {
  const {
    datasetId,
    fileName,
    datasetMeta,
    uploadedDataset,
    rawProfile,
    busyAction,
    errorMessage,
    uploadDataset,
    saveDatasetEdits,
    resetWorkspace,
  } = useAtlas()

  const [editableRows, setEditableRows] = useState([])
  const [dirtyCells, setDirtyCells] = useState(() => new Set())
  const [saveMessage, setSaveMessage] = useState('')
  const [undoStack, setUndoStack] = useState([])
  const [redoStack, setRedoStack] = useState([])

  const columns = uploadedDataset.columns
  const hasDataset = Boolean(datasetId)
  const hasUnsavedChanges = dirtyCells.size > 0
  const canUndo = undoStack.length > 0
  const canRedo = redoStack.length > 0

  const columnProfilesByName = useMemo(
    () => new Map((rawProfile?.column_profiles ?? []).map((column) => [column.name, column])),
    [rawProfile],
  )

  const editorFormula = useMemo(() => {
    if (!rawProfile?.column_profiles?.length) {
      return '= Upload a CSV or Excel file to start editing.'
    }

    const typeMap = {
      NUMBER: 'number',
      STRING: 'text',
      BOOLEAN: 'logical',
      DATETIME: 'date',
    }

    const columnTypes = rawProfile.column_profiles
      .slice(0, 8)
      .map((column) => `{"${column.name}", type ${typeMap[formatDataType(column.dtype)] ?? 'text'}}`)
      .join(', ')

    return `= Table.TransformColumnTypes(#"Promoted Headers", {${columnTypes}})`
  }, [rawProfile])

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    setEditableRows(cloneRows(uploadedDataset.rows))
    setDirtyCells(new Set())
    setSaveMessage('')
    setUndoStack([])
    setRedoStack([])
  }, [uploadedDataset.rows])
  /* eslint-enable react-hooks/set-state-in-effect */

  function markDirty(token = '__table') {
    setDirtyCells((currentCells) => {
      const nextCells = new Set(currentCells)
      nextCells.add(token)
      return nextCells
    })
    setSaveMessage('')
  }

  function setRowsWithHistory(updater, dirtyToken) {
    setEditableRows((currentRows) => {
      const previousRows = cloneRows(currentRows)
      const nextRows = updater(previousRows)

      setUndoStack((currentStack) => [...currentStack, previousRows])
      setRedoStack([])
      return nextRows
    })
    markDirty(dirtyToken)
  }

  function updateCell(rowIndex, column, value) {
    setRowsWithHistory(
      (currentRows) =>
        currentRows.map((row, index) =>
        index === rowIndex
          ? {
              ...row,
              [column]: value,
            }
          : row,
        ),
      `${rowIndex}:${column}`,
    )
  }

  function addRow() {
    const nextRow = Object.fromEntries(columns.map((column) => [column, '']))
    setRowsWithHistory((currentRows) => [...currentRows, nextRow], `${editableRows.length}:__row`)
  }

  function removeRow(rowIndex) {
    setRowsWithHistory(
      (currentRows) => currentRows.filter((_, index) => index !== rowIndex),
      `removed:${rowIndex}`,
    )
  }

  function resetEdits() {
    setRowsWithHistory(() => cloneRows(uploadedDataset.rows), '__reset')
  }

  function undoEdit() {
    if (!canUndo) {
      return
    }

    setUndoStack((currentUndoStack) => {
      const previousRows = currentUndoStack.at(-1)
      const remainingUndoStack = currentUndoStack.slice(0, -1)

      setRedoStack((currentRedoStack) => [...currentRedoStack, cloneRows(editableRows)])
      setEditableRows(cloneRows(previousRows))
      markDirty('__undo')

      return remainingUndoStack
    })
  }

  function redoEdit() {
    if (!canRedo) {
      return
    }

    setRedoStack((currentRedoStack) => {
      const nextRows = currentRedoStack.at(-1)
      const remainingRedoStack = currentRedoStack.slice(0, -1)

      setUndoStack((currentUndoStack) => [...currentUndoStack, cloneRows(editableRows)])
      setEditableRows(cloneRows(nextRows))
      markDirty('__redo')

      return remainingRedoStack
    })
  }

  function exportCsv() {
    if (!hasDataset || columns.length === 0) {
      return
    }

    const csvRows = [
      columns.map(normalizeCsvValue).join(','),
      ...editableRows.map((row) => columns.map((column) => normalizeCsvValue(row[column])).join(',')),
    ]
    const blob = new Blob([csvRows.join('\n')], { type: 'text/csv;charset=utf-8' })
    const exportUrl = URL.createObjectURL(blob)
    const link = document.createElement('a')
    const baseName = (fileName || 'atlas_dataset').replace(/\.[^.]+$/, '').replace(/[^\w-]+/g, '_')

    link.href = exportUrl
    link.download = `${baseName || 'atlas_dataset'}_edited.csv`
    document.body.append(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(exportUrl)
  }

  async function handleSaveEdits() {
    try {
      await saveDatasetEdits({ columns, rows: editableRows })
      setDirtyCells(new Set())
      setUndoStack([])
      setRedoStack([])
      setSaveMessage('Saved. The active dataset has been updated.')
    } catch {
      setSaveMessage('')
    }
  }

  return (
    <div className="upload-workbench">
      <aside className="query-sidebar">
        <div className="query-sidebar__head">
          <span>Queries [1]</span>
        </div>

        <div className={hasDataset ? 'query-item query-item--active' : 'query-item'}>
          <span className="query-table-icon" aria-hidden="true" />
          <strong>{fileName || 'No dataset loaded'}</strong>
        </div>
      </aside>

      <section className="query-main">
        <div className="query-notice">
          <span className="query-notice__icon">i</span>
          <span>{hasDataset ? 'Preview is editable. Save changes before profiling or cleaning.' : 'Import a CSV or Excel file to begin.'}</span>
          <button type="button" className="editor-toolbar__button" onClick={resetEdits} disabled={!hasUnsavedChanges}>
            Reset Edits
          </button>
        </div>

        <div className="editor-toolbar upload-editor-toolbar">
          <div className="editor-toolbar__group">
            <ImportDatasetButton busy={busyAction === 'uploading'} onFileSelect={uploadDataset} />
            <button type="button" className="editor-toolbar__button" onClick={resetWorkspace} disabled={!hasDataset}>
              Close
            </button>
            <button type="button" className="editor-toolbar__button" onClick={undoEdit} disabled={!canUndo}>
              Undo
            </button>
            <button type="button" className="editor-toolbar__button" onClick={redoEdit} disabled={!canRedo}>
              Redo
            </button>
            <button
              type="button"
              className="editor-toolbar__button"
              onClick={handleSaveEdits}
              disabled={!hasDataset || !hasUnsavedChanges || busyAction === 'saving'}
            >
              {busyAction === 'saving' ? 'Saving...' : 'Save Changes'}
            </button>
            <button type="button" className="editor-toolbar__button" onClick={addRow} disabled={!hasDataset}>
              Add Row
            </button>
            <button type="button" className="editor-toolbar__button" onClick={exportCsv} disabled={!hasDataset}>
              Export CSV
            </button>
          </div>

          <div className="editor-toolbar__group">
            <Link to="/profiling" className={hasDataset ? 'editor-toolbar__button' : 'editor-toolbar__button disabled-link'}>
              Profile
            </Link>
            <Link to="/cleaning" className={hasDataset ? 'editor-toolbar__button' : 'editor-toolbar__button disabled-link'}>
              Clean
            </Link>
          </div>
        </div>

        <div className="editor-formula-bar">
          <span className="editor-formula-bar__fx">fx</span>
          <div className="editor-formula-bar__input">{editorFormula}</div>
        </div>

        {errorMessage ? <p className="error-banner">{errorMessage}</p> : null}
        {saveMessage ? <p className="info-banner">{saveMessage}</p> : null}

        {hasDataset ? (
          <div className="dataset-table-shell dataset-table-shell--editor upload-edit-grid">
            <div className="dataset-table-scroll dataset-table-scroll--editor">
              <table className="dataset-grid-table dataset-grid-table--editor editable-grid-table">
                <thead>
                  <tr>
                    <th className="row-index-col">#</th>
                    {columns.map((column) => {
                      const profile = columnProfilesByName.get(column)

                      return (
                        <th key={column}>
                          <span className="column-title">{column}</span>
                          <span className="column-meta">
                            {formatDataType(profile?.dtype)} / {profile?.missing_values ?? 0} null
                          </span>
                        </th>
                      )
                    })}
                    <th className="row-action-col">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {editableRows.map((row, rowIndex) => (
                    <tr key={`editable-row-${rowIndex}`}>
                      <td className="row-index-col">{rowIndex + 1}</td>
                      {columns.map((column) => {
                        const dirty = dirtyCells.has(`${rowIndex}:${column}`)

                        return (
                          <td key={`${column}-${rowIndex}`} className={dirty ? 'editable-cell is-dirty' : 'editable-cell'}>
                            <input
                              className="editable-cell-input"
                              value={row[column] ?? ''}
                              onChange={(event) => updateCell(rowIndex, column, event.target.value)}
                              aria-label={`${column} row ${rowIndex + 1}`}
                            />
                          </td>
                        )
                      })}
                      <td className="row-action-col">
                        <button type="button" className="table-nav-button" onClick={() => removeRow(rowIndex)}>
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div className="empty-panel upload-empty-panel">
            <h2>No dataset loaded</h2>
            <p>Choose a CSV or Excel file. The table will appear here and can be edited before saving.</p>
            <ImportDatasetButton
              busy={busyAction === 'uploading'}
              onFileSelect={uploadDataset}
              label="Import Dataset"
            />
          </div>
        )}

        <footer className="query-status-bar">
          <span>{columns.length} COLUMNS</span>
          <span>{editableRows.length} ROWS</span>
          <span>{totalMissing(rawProfile?.column_profiles ?? [])} MISSING</span>
          <span>{formatBytes(datasetMeta.sizeBytes)}</span>
          <span>{fileName ? `Uploaded ${formatDateTime(datasetMeta.uploadedAt)}` : 'No active preview'}</span>
        </footer>
      </section>

      <aside className="query-settings-panel">
        <div className="query-settings-panel__head">
          <strong>Query Settings</strong>
        </div>

        <div className="query-setting-group">
          <span>Properties</span>
          <label htmlFor="query-name">Name</label>
          <input id="query-name" value={fileName || ''} readOnly />
        </div>

        <div className="query-setting-group">
          <span>Applied Steps</span>
          <div className="applied-step">Source</div>
          <div className="applied-step">Navigation</div>
          <div className="applied-step">Promoted Headers</div>
          {hasUnsavedChanges ? <div className="applied-step applied-step--pending">Pending Edits</div> : null}
          {saveMessage ? <div className="applied-step applied-step--saved">Saved Edits</div> : null}
        </div>
      </aside>
    </div>
  )
}

export default UploadPage
