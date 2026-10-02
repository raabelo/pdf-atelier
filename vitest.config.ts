import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      { test: { name: 'node', include: ['packages/{core,pdf,platform,tts}/**/*.test.ts', 'apps/desktop/**/*.test.ts'], environment: 'node' } },
      { test: { name: 'dom', include: ['packages/app/**/*.test.{ts,tsx}'], environment: 'jsdom' } },
    ],
  },
})
