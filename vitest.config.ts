import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    css: false,
    // The whole suite runs on the fast node pool; the panel spec opts itself
    // into jsdom with a `@vitest-environment` docblock.
    environment: 'node',
    include: ['tests/**/*.spec.ts', 'tests/**/*.spec.tsx'],
    server: {
      deps: {
        // The primitives package ships component CSS (and pulls katex's) through
        // plain imports: Vite must transform it, node's ESM loader cannot.
        inline: [/@deepseek-ai\/dsh-client-ui-/],
      },
    },
  },
})
