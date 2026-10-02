export { App } from './shell/App.tsx'
export { PlatformProvider, usePlatform } from './platform.ts'
// Re-exported so the web entry configures the engine without depending on @pdf-atelier/pdf directly.
export { configurePdf } from '@pdf-atelier/pdf'
