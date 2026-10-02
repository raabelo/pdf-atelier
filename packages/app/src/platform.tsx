import type { Platform } from '@pdf-atelier/platform'
import { createContext, useContext, type ReactNode } from 'react'

const PlatformContext = createContext<Platform | null>(null)

export function PlatformProvider({
  platform,
  children,
}: {
  platform: Platform
  children: ReactNode
}) {
  return <PlatformContext.Provider value={platform}>{children}</PlatformContext.Provider>
}

export function usePlatform(): Platform {
  const p = useContext(PlatformContext)
  if (!p) throw new Error('PlatformProvider missing')
  return p
}
