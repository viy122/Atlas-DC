import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { IconButtonContent } from '../components/AtlasBrand'
import { useAtlas } from '../context/AtlasContext'
import { formatDataType } from '../utils/formatters'

function ImportDatasetButton({ busy, onFileSelect, label = 'Import Data', iconOnly = false }) {
  return (
    <label
      className={`primary-button import-button${busy ? ' is-busy' : ''}${iconOnly ? ' icon-only-button' : ''}`}
      title={busy ? 'Importing' : label}
      aria-label={busy ? 'Importing' : label}
    >
      {iconOnly ? (
        <IconButtonContent icon="upload" label={busy ? 'Importing' : label} />
      ) : (
        <span>{busy ? 'Importing...' : label}</span>
      )}
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

  const text = String(value).trim()
  if (['', '-', '--', 'n/a', 'na', 'null', 'none', 'unknown'].includes(text.toLowerCase())) {
    return ''
  }

  if (/[",\n\r]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`
  }

  return text
}

function UploadPage() {
  const {
    datasetId,
    fileName,
    uploadedDataset,
    rawProfile,
    busyAction,
    errorMessage,
    uploadDataset,
    saveDatasetEdits,
    renameDatasetFile,
    resetWorkspace,
  } = useAtlas()

  const [editableRows, setEditableRows] = useState([])
  const [draftFileName, setDraftFileName] = useState('')
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

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    setEditableRows(cloneRows(uploadedDataset.rows))
    setDirtyCells(new Set())
    setSaveMessage('')
    setUndoStack([])
    setRedoStack([])
  }, [uploadedDataset.rows])
  /* eslint-enable react-hooks/set-state-in-effect */

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    setDraftFileName(fileName || '')
  }, [fileName])
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

  async function handleRenameFile(event) {
    event.preventDefault()
    if (!hasDataset || draftFileName.trim() === fileName) {
      return
    }

    try {
      await renameDatasetFile(draftFileName)
      setSaveMessage('File name updated.')
    } catch {
      setSaveMessage('')
    }
  }

  return (
    <div className="upload-workbench">
      <section className="query-main">
        <div className="editor-toolbar upload-editor-toolbar">
          <div className="editor-toolbar__group">
            <ImportDatasetButton busy={busyAction === 'uploading'} onFileSelect={uploadDataset} iconOnly />
            <button type="button" className="editor-toolbar__button icon-only-button" onClick={resetWorkspace} disabled={!hasDataset} title="Close dataset" aria-label="Close dataset">
              <IconButtonContent icon="close" label="Close dataset" />
            </button>
            <button type="button" className="editor-toolbar__button icon-only-button" onClick={resetEdits} disabled={!hasUnsavedChanges} title="Reset edits" aria-label="Reset edits">
              <IconButtonContent icon="reset" label="Reset edits" />
            </button>
            <button type="button" className="editor-toolbar__button icon-only-button" onClick={undoEdit} disabled={!canUndo} title="Undo" aria-label="Undo">
              <IconButtonContent icon="undo" label="Undo" />
            </button>
            <button type="button" className="editor-toolbar__button icon-only-button" onClick={redoEdit} disabled={!canRedo} title="Redo" aria-label="Redo">
              <IconButtonContent icon="redo" label="Redo" />
            </button>
            <button
              type="button"
              className="editor-toolbar__button icon-only-button"
              onClick={handleSaveEdits}
              disabled={!hasDataset || !hasUnsavedChanges || busyAction === 'saving'}
              title={busyAction === 'saving' ? 'Saving' : 'Save changes'}
              aria-label={busyAction === 'saving' ? 'Saving' : 'Save changes'}
            >
              <IconButtonContent icon="save" label={busyAction === 'saving' ? 'Saving' : 'Save changes'} />
            </button>
            <button type="button" className="editor-toolbar__button icon-only-button" onClick={addRow} disabled={!hasDataset} title="Add row" aria-label="Add row">
              <IconButtonContent icon="plus" label="Add row" />
            </button>
            <button type="button" className="editor-toolbar__button icon-only-button" onClick={exportCsv} disabled={!hasDataset} title="Export CSV" aria-label="Export CSV">
              <IconButtonContent icon="download" label="Export CSV" />
            </button>
          </div>

          <div className="editor-toolbar__group">
            <Link to="/profiling" className={hasDataset ? 'editor-toolbar__button icon-only-button' : 'editor-toolbar__button icon-only-button disabled-link'} title="Profile" aria-label="Profile">
              <IconButtonContent icon="profile" label="Profile" />
            </Link>
            <Link to="/cleaning" className={hasDataset ? 'editor-toolbar__button icon-only-button' : 'editor-toolbar__button icon-only-button disabled-link'} title="Clean" aria-label="Clean">
              <IconButtonContent icon="clean" label="Clean" />
            </Link>
          </div>

          {hasDataset ? (
            <form className="rename-file-form upload-rename-form" onSubmit={handleRenameFile}>
              <input
                id="dataset-name"
                value={draftFileName}
                onChange={(event) => setDraftFileName(event.target.value)}
                disabled={busyAction === 'renaming'}
                aria-label="Dataset name"
              />
              <button
                type="submit"
                className="editor-toolbar__button icon-only-button"
                disabled={!draftFileName.trim() || draftFileName.trim() === fileName || busyAction === 'renaming'}
                title="Rename file"
                aria-label="Rename file"
              >
                <IconButtonContent icon="edit" label="Rename file" />
              </button>
            </form>
          ) : null}
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
                        <button type="button" className="table-nav-button icon-only-button" onClick={() => removeRow(rowIndex)} title="Delete row" aria-label="Delete row">
                          <IconButtonContent icon="trash" label="Delete row" />
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
      </section>
    </div>
  )
}

export default UploadPage
