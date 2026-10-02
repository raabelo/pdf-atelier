import type { Platform } from '@pdf-atelier/platform'
import { useEffect, useState } from 'react'
import { createCommands } from '../commands/commands.ts'
import { handleKeyDown, registerCommands, runCommand } from '../commands/registry.ts'
import { openDropped, openFile } from '../files/actions.ts'
import { PlatformProvider } from '../platform.ts'
import { isDirty, useActiveDoc, useDocuments } from '../stores/documents.ts'
import { loadSettings, useSettings } from '../stores/settings.ts'
import { TooltipProvider } from '../ui/overlays.tsx'
import { PageDialogs } from '../sidebar/PageDialogs.tsx'
import { Viewer } from '../viewer/Viewer.tsx'
import {
  AboutDialog,
  ConfirmDialog,
  EmptyState,
  ProgressDialog,
  Sidebar,
  StatusBar,
  TabsBar,
} from './parts.tsx'
import { Toolbar } from './Toolbar.tsx'

function useTheme() {
  const theme = useSettings((s) => s.theme)
  useEffect(() => {
    const mq = matchMedia('(prefers-color-scheme: dark)')
    const apply = () =>
      document.documentElement.classList.toggle(
        'dark',
        theme === 'dark' || (theme === 'system' && mq.matches),
      )
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [theme])
}

export function App({ platform }: { platform: Platform }) {
  const locale = useSettings((s) => s.locale)
  const doc = useActiveDoc()
  const [dragging, setDragging] = useState(false)
  useTheme()

  useEffect(() => {
    void loadSettings()
    const unregister = registerCommands(createCommands(platform))
    window.addEventListener('keydown', handleKeyDown)
    // Native menu (desktop) runs the same commands as toolbar and shortcuts.
    const unmenu = platform.onNativeCommand?.(runCommand)
    // Files handed over by the OS (desktop: "Open with", second instance).
    const unopen = platform.onOpenFile?.((f) => void openFile(f))
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (useDocuments.getState().docs.some(isDirty)) e.preventDefault()
    }
    window.addEventListener('beforeunload', beforeUnload)
    return () => {
      unregister()
      unmenu?.()
      unopen?.()
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('beforeunload', beforeUnload)
    }
  }, [platform])

  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])

  return (
    <PlatformProvider value={platform}>
      <TooltipProvider delayDuration={400}>
        {/* key: remount on locale change so every t() call re-reads the catalog */}
        <div
          key={locale}
          className="flex h-full flex-col"
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes('Files')) {
              e.preventDefault()
              setDragging(true)
            }
          }}
          onDragLeave={(e) => e.currentTarget === e.target && setDragging(false)}
          onDrop={(e) => {
            if (!e.dataTransfer.files.length) return
            e.preventDefault()
            setDragging(false)
            void openDropped(platform, e.dataTransfer.files)
          }}
        >
          <Toolbar />
          <TabsBar />
          <div className="relative flex min-h-0 flex-1">
            <Sidebar />
            <main className="min-w-0 flex-1">
              {doc ? <Viewer key={doc.id} doc={doc} /> : <EmptyState />}
            </main>
            {dragging && (
              <div className="pointer-events-none absolute inset-2 rounded-lg border-2 border-dashed border-[var(--selection)] bg-[var(--selection)]/10" />
            )}
          </div>
          <StatusBar />
          <ConfirmDialog />
          <ProgressDialog />
          <AboutDialog />
          <PageDialogs />
        </div>
      </TooltipProvider>
    </PlatformProvider>
  )
}
