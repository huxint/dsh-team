import assert from 'node:assert/strict'
import { extname } from 'node:path'

export async function verifyRoom(page, { output, url, settle }) {
  const failures = []
  const stem = output.slice(0, -extname(output).length)
  const originalViewport = page.viewportSize()
  const capture = name => page.locator('#stage').screenshot({ path: `${stem}-${name}.png`, animations: 'disabled' })
  const ready = async () => {
    await page.waitForSelector('[data-renderer="webgl"] [data-room-ready="true"]')
    await page.evaluate(() => document.fonts.ready)
    await settle()
  }
  const fit = async selector => {
    const overflowing = await page.locator(selector).evaluateAll(elements => elements.filter(element => element.scrollWidth > element.clientWidth + 1).map(element => element.className))
    assert.deepEqual(overflowing, [], `${selector} overflows horizontally`)
  }
  await page.goto(url, { waitUntil: 'networkidle' })
  await ready()
  const resting = await page.locator('#stage').screenshot()
  await page.reload({ waitUntil: 'networkidle' })
  await ready()
  assert(resting.equals(await page.locator('#stage').screenshot()), 'Reduced-motion captures must be repeatable')
  assert.equal(await page.locator('[data-member]').count(), 5)

  for (const [panel, selector, count] of [['feed', '[data-message-kind]', 5], ['workspace', '[data-note-key]', 3], ['tasks', '[data-task-status]', 5]]) {
    const door = page.locator(`[data-panel-id="${panel}"]`)
    await door.click()
    const drawer = page.locator(`[data-panel="${panel}"]`)
    await drawer.waitFor()
    assert.equal(await drawer.locator(selector).count(), count)
    assert.equal(await door.getAttribute('aria-controls'), await drawer.getAttribute('id'))
    await fit('[data-agent-team-stage], [data-panel], [data-column]')
    await capture(panel)
    await page.keyboard.press('Escape')
    assert.equal(await page.locator('[data-panel]').count(), 0)
    assert.equal(await door.evaluate(element => element === document.activeElement), true)
  }
  await page.locator('[data-panel-id="feed"]').click()
  await page.locator('[data-message-kind="report"]').hover()
  assert.equal(await page.locator('[data-member="child-3"]').getAttribute('data-focus'), 'true')
  await page.keyboard.press('Escape')
  await page.mouse.move(0, 0)
  await page.evaluate(() => document.activeElement?.blur())

  const initialDark = await page.evaluate(() => document.body.hasAttribute('data-ds-dark-theme'))
  await page.evaluate(() => document.body.toggleAttribute('data-ds-dark-theme'))
  await settle()
  const themed = await capture(initialDark ? 'light' : 'dark')
  assert(!resting.equals(themed), 'Theme changes must repaint the room')
  await page.evaluate(dark => document.body.toggleAttribute('data-ds-dark-theme', dark), initialDark)
  await settle()
  const restored = await capture('restored')
  if (!resting.equals(restored)) {
    const difference = await page.evaluate(async images => {
      const canvas = document.createElement('canvas')
      const decoded = await Promise.all(images.map(async source => {
        const image = new Image()
        image.src = `data:image/png;base64,${source}`
        await image.decode()
        return image
      }))
      canvas.width = decoded[0].width
      canvas.height = decoded[0].height
      const context = canvas.getContext('2d')
      const pixels = decoded.map(image => {
        context.drawImage(image, 0, 0)
        return context.getImageData(0, 0, canvas.width, canvas.height).data
      })
      let left = canvas.width, top = canvas.height, right = 0, bottom = 0, count = 0
      for (let offset = 0; offset < pixels[0].length; offset += 4) {
        if (pixels[0].slice(offset, offset + 4).every((channel, index) => channel === pixels[1][offset + index])) continue
        const x = offset / 4 % canvas.width, y = Math.floor(offset / 4 / canvas.width)
        left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y)
        count += 1
      }
      return { left, top, right, bottom, count }
    }, [resting.toString('base64'), restored.toString('base64')])
    failures.push(`Theme restoration differs: ${JSON.stringify(difference)}`)
  }

  await page.setViewportSize({ width: 390, height: 760 })
  await ready()
  await fit('[data-agent-team-stage]')
  await capture('narrow')
  for (const panel of ['feed', 'workspace', 'tasks']) {
    await page.locator(`[data-panel-id="${panel}"]`).click()
    await fit('[data-panel], [data-column]')
    await capture(`narrow-${panel}`)
    await page.keyboard.press('Escape')
  }
  await page.setViewportSize(originalViewport)
  const english = new URL(url)
  english.searchParams.set('locale', 'en')
  await page.goto(english.href, { waitUntil: 'networkidle' })
  await ready()
  assert.equal(await page.getByRole('button', { name: 'Back to the main session', exact: true }).count(), 1)
  await capture('english')

  await page.evaluate(() => {
    window.roomFrames = 0
    window.roomDraws = 0
    const copy = CanvasRenderingContext2D.prototype.drawImage
    CanvasRenderingContext2D.prototype.drawImage = function (...args) {
      if (this.canvas.dataset.roomLayer === 'backdrop') window.roomFrames += 1
      return copy.apply(this, args)
    }
    for (const method of ['drawElements', 'drawArrays']) {
      const draw = WebGL2RenderingContext.prototype[method]
      WebGL2RenderingContext.prototype[method] = function (...args) {
        window.roomDraws += 1
        return draw.apply(this, args)
      }
    }
  })
  await settle()
  assert.equal(await page.evaluate(() => window.roomDraws), 0, 'A still room must not keep rendering')
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.waitForFunction(() => window.roomFrames >= 5)
  const drawCost = await page.evaluate(() => ({ frames: window.roomFrames, draws: window.roomDraws }))
  console.log(`Ambient rendering: ${Math.round(drawCost.draws / drawCost.frames)} draw calls per frame`)
  await page.evaluate(() => { document.getElementById('stage').style.display = 'none' })
  await page.waitForFunction(() => document.querySelector('[data-room-paused="true"]'))
  await page.evaluate(() => { window.roomDraws = 0 })
  await settle()
  await settle()
  assert.equal(await page.evaluate(() => window.roomDraws), 0, 'An offscreen room must stop rendering')
  await page.evaluate(() => { document.getElementById('stage').style.display = '' })
  await page.waitForFunction(() => window.roomDraws > 0)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await settle()
  await page.evaluate(() => { window.roomDraws = 0 })
  await settle()
  assert.equal(await page.evaluate(() => window.roomDraws), 0, 'Changing reduced motion must stop the loop')
  assert.equal(await page.evaluate(() => document.getAnimations().filter(animation => animation.playState === 'running').length), 0)

  await page.evaluate(() => {
    const canvas = document.querySelector('[data-room-layer="overlay"]')
    window.roomContext = canvas.getContext('webgl2').getExtension('WEBGL_lose_context')
    window.roomContext.loseContext()
  })
  await page.waitForSelector('[data-renderer="fallback"]')
  assert.equal(await page.locator('[data-member]:visible').count(), 5)
  await capture('fallback')
  await page.evaluate(() => window.roomContext.restoreContext())
  await ready()
  assert.equal(await page.locator('[data-renderer="webgl"]').count(), 1)
  assert.deepEqual(failures, [], 'Visual regressions')
  console.log('Verified repeatable captures, all drawers, both themes, narrow layout, English, rendering suspension, and context recovery.')
}
