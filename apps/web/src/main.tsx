import { App, configurePdf } from '@pdf-atelier/app'
import { createElectronPlatform } from '@pdf-atelier/platform/electron'
import { createWebPlatform } from '@pdf-atelier/platform/web'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'

// The only place that knows which runtime is active.
const platform = window.pdfAtelier ? createElectronPlatform(window.pdfAtelier) : createWebPlatform()

configurePdf({ assetsBaseUrl: './pdfjs/' })

// Offline/installable web app. Not in Electron (app:// serves local files already) nor in dev.
if (
  import.meta.env.PROD &&
  !window.pdfAtelier &&
  'serviceWorker' in navigator &&
  location.protocol.startsWith('http')
)
  void navigator.serviceWorker.register('./sw.js').catch((e: unknown) => console.warn('SW', e))

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App platform={platform} />
  </StrictMode>,
)
