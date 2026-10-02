const ALLOWED = new Set(['http:', 'https:', 'mailto:'])

/** Returns the normalized URL if it is safe to open outside the app (http/https/mailto), else null. */
export function safeExternalUrl(url: string): string | null {
  try {
    const u = new URL(url)
    return ALLOWED.has(u.protocol) ? u.href : null
  } catch {
    return null
  }
}
