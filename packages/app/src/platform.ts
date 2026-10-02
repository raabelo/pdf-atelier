import type { Platform } from '@pdf-atelier/platform'
import { createContext, useContext } from 'react'

const PlatformContext = createContext<Platform | null>(null)

export const PlatformProvider = PlatformContext.Provider

export function usePlatform(): Platform {
  const p = useContext(PlatformContext)
  if (!p) throw new Error('PlatformProvider missing')
  return p
}
