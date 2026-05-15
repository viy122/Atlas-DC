function IconPath({ name }) {
  switch (name) {
    case 'home':
      return <path d="M4 11.5 12 5l8 6.5V20h-5v-5H9v5H4v-8.5Z" />
    case 'search':
      return <path d="m20 20-4.2-4.2M18 11a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z" />
    case 'bell':
      return <path d="M18 10a6 6 0 1 0-12 0c0 7-3 7-3 7h18s-3 0-3-7M9.8 21h4.4" />
    case 'help':
      return <path d="M12 18h.01M9.2 9a3 3 0 1 1 5.2 2c-.8.7-1.4 1.1-1.8 1.8-.3.5-.4.9-.4 1.7M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
    case 'login':
      return <path d="M10 17l5-5-5-5m5 5H3m11-8h4a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3h-4" />
    case 'logout':
      return <path d="M14 17l5-5-5-5m5 5H8m2 8H6a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3h4" />
    case 'settings':
      return <path d="M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4ZM19.4 15a1.8 1.8 0 0 0 .4 2l.1.1-2 3.4-.2-.1a1.8 1.8 0 0 0-2.1.3l-.3.2a1.8 1.8 0 0 0-.9 1.7V23h-4v-.4a1.8 1.8 0 0 0-.9-1.7l-.3-.2a1.8 1.8 0 0 0-2.1-.3l-.2.1-2-3.4.1-.1a1.8 1.8 0 0 0 .4-2l-.1-.4A1.8 1.8 0 0 0 3.6 13H3V9h.6a1.8 1.8 0 0 0 1.7-1.2l.1-.4a1.8 1.8 0 0 0-.4-2L4.9 5.3l2-3.4.2.1a1.8 1.8 0 0 0 2.1-.3l.3-.2A1.8 1.8 0 0 0 10.4 0h4a1.8 1.8 0 0 0 .9 1.5l.3.2a1.8 1.8 0 0 0 2.1.3l.2-.1 2 3.4-.1.1a1.8 1.8 0 0 0-.4 2l.1.4A1.8 1.8 0 0 0 21.4 9h.6v4h-.6a1.8 1.8 0 0 0-1.7 1.2l-.3.8Z" />
    case 'database':
      return <path d="M5 7c0-2 3.1-3.5 7-3.5S19 5 19 7s-3.1 3.5-7 3.5S5 9 5 7Zm0 0v5c0 2 3.1 3.5 7 3.5s7-1.5 7-3.5V7M5 12v5c0 2 3.1 3.5 7 3.5s7-1.5 7-3.5v-5" />
    case 'chevron-left':
      return <path d="m15 6-6 6 6 6" />
    case 'check':
      return <path d="m5 12 4 4L19 6" />
    case 'upload':
      return <path d="M12 16V4m0 0 4 4m-4-4-4 4M5 16v3h14v-3" />
    case 'close':
      return <path d="m7 7 10 10M17 7 7 17" />
    case 'undo':
      return <path d="M9 7H5v4m0-4 5 5a5 5 0 1 0 3.5-8.5" />
    case 'redo':
      return <path d="M15 7h4v4m0-4-5 5a5 5 0 1 1-3.5-8.5" />
    case 'save':
      return <path d="M5 5h12l2 2v12H5V5Zm3 0v5h8V5M8 19v-5h8v5" />
    case 'plus':
      return <path d="M12 5v14M5 12h14" />
    case 'download':
      return <path d="M12 4v12m0 0 4-4m-4 4-4-4M5 20h14" />
    case 'profile':
      return <path d="M5 5h14M5 10h10M5 15h14M5 20h7" />
    case 'clean':
      return <path d="M8 15 5 12l3-3m8 0 3 3-3 3M14 4l-4 16" />
    case 'spark':
      return <path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Zm6 12 .8 2.2L21 18l-2.2.8L18 21l-.8-2.2L15 18l2.2-.8L18 15Z" />
    case 'calendar':
      return <path d="M7 3v4m10-4v4M5 8h14M6 5h12v15H6V5Z" />
    case 'reset':
      return <path d="M5 7v5h5M6 12a6 6 0 1 0 1.8-4.3L5 10.5" />
    case 'analyze':
      return <path d="M5 19V9m7 10V5m7 14v-7" />
    case 'visualize':
      return <path d="M5 18h14M7 15l3-4 3 2 4-6" />
    case 'back':
      return <path d="m11 5-7 7 7 7M5 12h14" />
    case 'next':
      return <path d="m13 5 7 7-7 7M19 12H5" />
    case 'export':
      return <path d="M12 4v9m0 0 3-3m-3 3-3-3M6 20h12a1 1 0 0 0 1-1v-4M5 15v4a1 1 0 0 0 1 1" />
    case 'image':
      return <path d="M5 6h14v12H5V6Zm3 9 3-3 2 2 2-3 3 4M8 9h.01" />
    case 'pdf':
      return <path d="M7 4h7l3 3v13H7V4Zm7 0v4h3M9 15h6M9 11h6" />
    case 'load':
      return <path d="M5 12a7 7 0 0 1 12-4m2-3v5h-5M19 12a7 7 0 0 1-12 4m-2 3v-5h5" />
    case 'edit':
      return <path d="M5 19h4L19 9l-4-4L5 15v4Zm9-13 4 4" />
    case 'trash':
      return <path d="M5 7h14M9 7V5h6v2m-8 0 1 13h8l1-13" />
    default:
      return <path d="M12 5v14M5 12h14" />
  }
}

function AtlasIcon({ name, className = '' }) {
  return (
    <svg
      className={className ? `atlas-icon ${className}` : 'atlas-icon'}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <IconPath name={name} />
    </svg>
  )
}

function AtlasLogo({ compact = false }) {
  return (
    <span className={compact ? 'atlas-logo atlas-logo--compact' : 'atlas-logo'} aria-label="ATLAS">
      <svg className="atlas-logo__mark" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
        <rect x="4" y="4" width="40" height="40" rx="10" />
        <path d="M13 34 24 12l11 22" />
        <path d="M18 25h12" />
        <path d="M12 38h24" />
      </svg>
      {!compact ? (
        <span className="atlas-logo__text">
          <strong>ATLAS</strong>
          <small>Analytics Workbench</small>
        </span>
      ) : null}
    </span>
  )
}

function IconButtonContent({ icon, label, showLabel = false }) {
  return (
    <>
      <AtlasIcon name={icon} />
      <span className={showLabel ? 'button-text' : 'sr-only'}>{label}</span>
    </>
  )
}

export { AtlasIcon, AtlasLogo, IconButtonContent }
