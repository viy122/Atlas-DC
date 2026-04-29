function FileUploadCard({
  busy = false,
  currentFileName = '',
  onFileSelect,
}) {
  return (
    <section className="panel upload-feature-panel">
      <div className="upload-feature-copy">
        <p className="hero-kicker">Stage 1</p>
        <h2>Upload Dataset</h2>
        <p>
          Select a CSV or Excel file and ATLAS will load the full dataset into an
          Excel-style viewer.
        </p>
      </div>

      <label className={`file-dropzone${busy ? ' busy' : ''}`} htmlFor="atlas-upload-input">
        <div>
          <strong>{busy ? 'Uploading dataset...' : 'Choose CSV, XLSX, or XLS file'}</strong>
          <p>{currentFileName || 'The complete dataset will appear below after upload.'}</p>
        </div>
        <span className="dropzone-action">{busy ? 'Uploading' : 'Browse File'}</span>
        <input
          id="atlas-upload-input"
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
    </section>
  )
}

export default FileUploadCard
