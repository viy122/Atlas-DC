import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { IconButtonContent } from '../components/AtlasBrand'
import { CompactMetric, EmptyStateMascot } from '../components/CompactUI'
import { useAtlas } from '../context/AtlasContext'
import { formatDataType, formatValue, totalMissing } from '../utils/formatters'

function ImportDatasetButton({ busy, onFileSelect, label = 'Import Data', iconOnly = false, tourId }) {
  return (
    <label
      className={`primary-button import-button${busy ? ' is-busy' : ''}${iconOnly ? ' icon-only-button' : ''}`}
      title={busy ? 'Importing' : label}
      aria-label={busy ? 'Importing' : label}
      data-tour={tourId}
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
    workflow,
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
  const isUploading = busyAction === 'uploading'

  useEffect(() => {
    document.documentElement.classList.add('atlas-upload-locked')
    document.body.classList.add('atlas-upload-locked')

    return () => {
      document.documentElement.classList.remove('atlas-upload-locked')
      document.body.classList.remove('atlas-upload-locked')
    }
  }, [])

  const columnProfilesByName = useMemo(
    () => new Map((rawProfile?.column_profiles ?? []).map((column) => [column.name, column])),
    [rawProfile],
  )
  const datasetSummary = useMemo(() => {
    const columnProfiles = rawProfile?.column_profiles ?? []
    const typeCounts = columnProfiles.reduce(
      (counts, column) => {
        const type = formatDataType(column.dtype)
        if (type === 'NUMBER') {
          counts.numeric += 1
        } else if (type === 'DATETIME') {
          counts.date += 1
        } else {
          counts.text += 1
        }

        return counts
      },
      { numeric: 0, date: 0, text: 0 },
    )

    return {
      rows: rawProfile?.rows ?? uploadedDataset.rows.length,
      columns: rawProfile?.columns_count ?? columns.length,
      missing: columnProfiles.length ? totalMissing(columnProfiles) : null,
      ...typeCounts,
    }
  }, [columns.length, rawProfile, uploadedDataset.rows.length])

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

  async function handleDatasetUpload(file) {
    await uploadDataset(file)
  }

  async function handleTrySampleDataset() {
    setSaveMessage('')

    try {
      const response = await fetch('/sample_sales_dataset.csv')
      if (!response.ok) {
        throw new Error('Sample dataset is unavailable.')
      }

      const blob = await response.blob()
      const sampleFile = new File([blob], 'sample_sales_dataset.csv', {
        type: blob.type || 'text/csv',
      })

      await handleDatasetUpload(sampleFile)
    } catch {
      setSaveMessage('Sample dataset could not be loaded. Please import your own CSV or Excel file.')
    }
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
          <div className="editor-toolbar__group editor-toolbar__group--compact">
            <span className="toolbar-group-label">File</span>
            <ImportDatasetButton busy={isUploading} onFileSelect={handleDatasetUpload} label="Import Dataset" tourId="import-dataset" />
            <button
              type="button"
              className="editor-toolbar__button"
              onClick={handleTrySampleDataset}
              disabled={isUploading}
              title="Try sample dataset"
            >
              <IconButtonContent icon="database" label="Try Sample Dataset" showLabel />
            </button>
            <button type="button" className="editor-toolbar__button icon-only-button" onClick={resetWorkspace} disabled={!hasDataset} title="Close dataset" aria-label="Close dataset">
              <IconButtonContent icon="close" label="Close dataset" />
            </button>
            <button
              type="button"
              className="editor-toolbar__button"
              onClick={handleSaveEdits}
              disabled={!hasDataset || !hasUnsavedChanges || busyAction === 'saving'}
              title={busyAction === 'saving' ? 'Saving' : 'Save changes'}
            >
              <IconButtonContent icon="save" label={busyAction === 'saving' ? 'Saving' : 'Save'} showLabel />
            </button>
            <button type="button" className="editor-toolbar__button" onClick={exportCsv} disabled={!hasDataset} title="Export CSV">
              <IconButtonContent icon="download" label="Export" showLabel />
            </button>
          </div>

          <div className="editor-toolbar__group editor-toolbar__group--compact">
            <span className="toolbar-group-label">Edit</span>
            <button type="button" className="editor-toolbar__button icon-only-button" onClick={resetEdits} disabled={!hasUnsavedChanges} title="Reset edits" aria-label="Reset edits">
              <IconButtonContent icon="reset" label="Reset edits" />
            </button>
            <button type="button" className="editor-toolbar__button icon-only-button" onClick={undoEdit} disabled={!canUndo} title="Undo" aria-label="Undo">
              <IconButtonContent icon="undo" label="Undo" />
            </button>
            <button type="button" className="editor-toolbar__button icon-only-button" onClick={redoEdit} disabled={!canRedo} title="Redo" aria-label="Redo">
              <IconButtonContent icon="redo" label="Redo" />
            </button>
            <button type="button" className="editor-toolbar__button" onClick={addRow} disabled={!hasDataset} title="Add row">
              <IconButtonContent icon="plus" label="Add Row" showLabel />
            </button>
          </div>

          <div className="editor-toolbar__group editor-toolbar__group--compact">
            <span className="toolbar-group-label">View</span>
            <Link to="/profiling" className={hasDataset ? 'editor-toolbar__button' : 'editor-toolbar__button disabled-link'} title="Profile">
              <IconButtonContent icon="profile" label="Profile" showLabel />
            </Link>
            <Link to="/cleaning" className={workflow.profiled ? 'editor-toolbar__button' : 'editor-toolbar__button disabled-link'} title="Clean">
              <IconButtonContent icon="clean" label="Clean" showLabel />
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
          <section className="compact-metric-strip upload-summary-strip" aria-label="Dataset summary">
            <CompactMetric icon="profile" label="Rows" value={formatValue(datasetSummary.rows)} />
            <CompactMetric icon="profile" label="Columns" value={formatValue(datasetSummary.columns)} />
            <CompactMetric icon="clean" label="Missing Cells" value={datasetSummary.missing === null ? '-' : formatValue(datasetSummary.missing)} />
            <CompactMetric icon="analyze" label="Numeric" value={formatValue(datasetSummary.numeric)} />
            <CompactMetric icon="calendar" label="Date" value={formatValue(datasetSummary.date)} />
            <CompactMetric icon="edit" label="Text" value={formatValue(datasetSummary.text)} />
          </section>
        ) : null}

        {hasDataset ? (
          <div className="dataset-table-shell dataset-table-shell--editor upload-edit-grid" data-tour="dataset-table">
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
                            <em>{formatDataType(profile?.dtype)}</em>
                            <small>{profile?.missing_values ?? 0} missing</small>
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
          <EmptyStateMascot
            title="No dataset loaded"
            description="Choose a CSV or Excel file. The table will appear here and can be edited before saving."
            action={(
              <div className="upload-empty-actions">
                <ImportDatasetButton
                  busy={isUploading}
                  onFileSelect={handleDatasetUpload}
                  label="Import Dataset"
                  tourId="import-dataset"
                />
                <button
                  type="button"
                  className="ghost-button"
                  onClick={handleTrySampleDataset}
                  disabled={isUploading}
                  title="Try sample dataset"
                >
                  <IconButtonContent icon="database" label="Try Sample Dataset" showLabel />
                </button>
              </div>
            )}
            tourId="dataset-table"
          />
        )}
      </section>
    </div>
  )
}

export default UploadPage
