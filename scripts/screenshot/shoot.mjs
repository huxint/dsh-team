#!/usr/bin/env node
import { chromium } from 'playwright-core'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { dirname, extname, join, resolve, sep } from 'node:path'
import { parseArgs } from 'node:util'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const vite = join(dirname(createRequire(import.meta.url).resolve('vite/package.json')), 'bin/vite.js')
const dist = join(root, '.tmp-screenshot/dist')
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    theme: { type: 'string', default: 'light' },
    locale: { type: 'string', default: 'zh' },
    panel: { type: 'string' },
    width: { type: 'string', default: '1500' },
    height: { type: 'string', default: '760' },
    verify: { type: 'boolean', default: false },
  },
})
const output = resolve(positionals[0] ?? join(root, 'screenshots/image.png'))
const viewport = { width: Number(values.width), height: Number(values.height) }
assert(['light', 'dark'].includes(values.theme), 'theme must be light or dark')
assert(['zh', 'en'].includes(values.locale), 'locale must be zh or en')
assert(values.panel === undefined || ['feed', 'workspace', 'tasks'].includes(values.panel), 'unknown panel')
assert(Object.values(viewport).every(size => Number.isInteger(size) && size >= 240), 'viewport dimensions must be at least 240')

const executablePath = [process.env.CHROME_PATH, '/usr/bin/google-chrome-stable', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/opt/google/chrome/chrome'].find(path => path && existsSync(path))
assert(executablePath, 'No Chrome binary found; set CHROME_PATH')
const built = spawnSync('node', [vite, 'build', '--config', 'scripts/screenshot/vite.config.ts', '--logLevel', 'warn'], { cwd: root, encoding: 'utf8' })
assert.equal(built.status, 0, built.stderr || built.stdout)

const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }
const server = createServer((request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname
  if (pathname === '/favicon.ico') { response.writeHead(204).end(); return }
  const path = resolve(dist, `.${pathname === '/' ? '/index.html' : pathname}`)
  if (!path.startsWith(dist + sep)) { response.writeHead(403).end(); return }
  try {
    const body = readFileSync(path)
    response.writeHead(200, { 'content-type': mime[extname(path)] ?? 'application/octet-stream' }).end(body)
  } catch (error) {
    response.writeHead(error.code === 'ENOENT' ? 404 : 500).end()
  }
})
let browser
try {
  await new Promise((ready, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', ready)
  })
  browser = await chromium.launch({
    executablePath,
    headless: true,
    args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--font-render-hinting=none', '--disable-lcd-text', '--force-color-profile=srgb', '--hide-scrollbars'],
  })
  const page = await browser.newPage({ viewport, deviceScaleFactor: 2, reducedMotion: 'reduce', timezoneId: 'UTC', locale: values.locale === 'zh' ? 'zh-CN' : 'en-US' })
  const errors = []
  page.on('pageerror', error => { errors.push(error.message) })
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  const url = `http://127.0.0.1:${server.address().port}/?theme=${values.theme}&locale=${values.locale}`
  await page.goto(url, { waitUntil: 'networkidle' })
  await page.evaluate(() => document.fonts.ready)
  await page.waitForSelector('[data-renderer="webgl"] [data-room-ready="true"]')
  const settle = () => page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))))
  await settle()
  if (values.panel) {
    await page.locator(`[data-panel-id="${values.panel}"]`).click()
    await page.locator(`[data-panel="${values.panel}"]`).waitFor()
    await settle()
  }
  mkdirSync(dirname(output), { recursive: true })
  await page.locator('#stage').screenshot({ path: output, animations: 'disabled' })
  console.log(`Wrote ${output} (${statSync(output).size} bytes)`)

  if (values.verify) {
    const { verifyRoom } = await import('./verify.mjs')
    await verifyRoom(page, { output, url, settle })
  }
  assert.deepEqual(errors, [], 'Browser errors')
} finally {
  await browser?.close()
  await new Promise(done => server.close(done))
}
