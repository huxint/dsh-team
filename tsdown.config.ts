/**
 * Two build halves from one package: the node library the Loader mounts as a
 * plugin row, and the browser closure-factory bundle the web shell loads as
 * `dsh-team/client`.
 *
 * The browser half runs inside the shell's frozen module table: a `require()`
 * the table cannot answer throws at boot, so every `@deepseek-ai` import in
 * `src/client` must be a platform module, a shared store engine, or
 * type-only. The purity plugin below fails the BUILD instead of the page.
 */
import { readFile } from 'node:fs/promises'
import { basename, dirname, resolve as resolvePath } from 'node:path'
import type { UserConfig } from 'tsdown'
import { transform } from 'lightningcss'

const ID = 'dsh-team'

/** Specifiers the web shell shares into the frozen module table. */
const PLATFORM_MODULES = [
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
] as const

const CLIENT_EXTERNALS: readonly string[] = [...PLATFORM_MODULES]

/** Wire/type layers with no cross-plugin runtime identity, safe to inline. */
const INLINE_SAFE = /^@deepseek-ai\/dsh-(host-apiproxy|session|llm|tools|brand|session-projection)(\/|$)/

const CSS_VIRTUAL_PREFIX = '\0dsh-css:'
const CSS_VIRTUAL_SUFFIX = '.mjs'

/** The node half: ESM plus declarations into dist/. */
const library: UserConfig = {
  name: ID,
  entry: ['src/index.ts'],
  outDir: 'dist',
  format: ['esm'],
  platform: 'node',
  target: 'es2023',
  fixedExtension: false,
  dts: true,
  clean: true,
  external: [/^@deepseek-ai\//, /^node:/, 'zod'],
}

/** The browser half: one closure factory registered with the shell's loader. */
const client: UserConfig = {
  name: `${ID}/client`,
  entry: { client: 'src/client/index.ts' },
  outDir: 'dist',
  format: 'cjs',
  platform: 'browser',
  sourcemap: true,
  minify: true,
  clean: false,
  external: [...CLIENT_EXTERNALS],
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
  },
  noExternal: (id: string) => (CLIENT_EXTERNALS.includes(id) ? undefined : true),
  plugins: [{
    name: 'dsh-team-client-bundle-purity',
    resolveId(source: string) {
      if (!source.startsWith('@deepseek-ai/')) return null
      if (CLIENT_EXTERNALS.includes(source)) return null
      if (INLINE_SAFE.test(source)) return null
      throw new Error(
        `client bundle purity: "${source}" is neither a platform module nor an inline-safe wire layer — `
        + 'cross-plugin value imports are forbidden; collaborate through cordis services',
      )
    },
  }, {
    name: 'dsh-team-css-modules-inline',
    resolveId(source: string, importer: string | undefined) {
      if (!source.endsWith('.module.css')) return null
      const absolute = importer !== undefined ? resolvePath(dirname(importer), source) : source
      return CSS_VIRTUAL_PREFIX + absolute + CSS_VIRTUAL_SUFFIX
    },
    async load(virtualId: string) {
      if (!virtualId.startsWith(CSS_VIRTUAL_PREFIX)) return null
      const file = virtualId.slice(CSS_VIRTUAL_PREFIX.length, -CSS_VIRTUAL_SUFFIX.length)
      this.addWatchFile(file)
      const { code, exports: cssExports } = transform({
        filename: file,
        code: await readFile(file),
        cssModules: { pattern: '[hash]_[local]' },
        minify: true,
      })
      const classMap: Record<string, string> = {}
      for (const [local, exported] of Object.entries(cssExports ?? {})) classMap[local] = exported.name
      const tagId = `${ID}/${basename(file)}`
      return [
        `const css = ${JSON.stringify(code.toString())};`,
        `const tagId = ${JSON.stringify(tagId)};`,
        "if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css=' + JSON.stringify(tagId) + ']') === null) {",
        "  const tag = document.createElement('style');",
        `  tag.dataset.plugin = ${JSON.stringify(ID)};`,
        '  tag.dataset.pluginCss = tagId;',
        '  tag.textContent = css;',
        '  document.head.appendChild(tag);',
        '}',
        `export default ${JSON.stringify(classMap)};`,
      ].join('\n')
    },
  }],
  outputOptions: {
    entryFileNames: 'client.js',
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(ID)}, factory: (require) => {`,
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
}

export default [library, client]
