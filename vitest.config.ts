import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  test: {
    globals: true,
    include: ['tests/**/*.test.ts'],
    // The simplified macOS group-send flow has cumulative real `sleep()` calls
    // totaling ~4.7s per test that drives `sendWhatsAppGroupMessage` end-to-end
    // (Phase 3 alone enforces a 2000ms minimum). The default 5000ms timeout
    // sits right on that edge and flakes under CPU load. Give all tests headroom.
    testTimeout: 15000
  },
  resolve: {
    alias: {
      '@shared': resolve('shared')
    }
  }
})
