import { defineConfig } from '@playwright/test'

// Run `pnpm build` first: web tests use `vite preview`, desktop tests launch the built Electron app.
export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  projects: [
    { name: 'web', testMatch: /web\.spec\.ts/, use: { channel: 'chrome', baseURL: 'http://localhost:4173' } },
    { name: 'desktop', testMatch: /desktop\.spec\.ts/ },
  ],
  webServer: {
    command: 'pnpm --filter @pdf-atelier/web preview --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: true,
  },
})
