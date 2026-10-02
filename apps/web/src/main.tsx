import { App, configurePdf } from '@pdf-atelier/app'
import { createElectronPlatform } from '@pdf-atelier/platform/electron'
import { createWebPlatform } from '@pdf-atelier/platform/web'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'

// The only place that knows which runtime is active.
const platform = window.pdfAtelier ? createElectronPlatform(window.pdfAtelier) : createWebPlatform()

configurePdf({ assetsBaseUrl: './pdfjs/' })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App platform={platform} />
  </StrictMode>,
)
