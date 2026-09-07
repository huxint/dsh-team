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
  const backdrop = await page.locator('[data-room-layer="backdrop"]').evaluate(canvas => canvas.toDataURL())
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
  assert(await page.locator('[data-room-layer="backdrop"]').evaluate(canvas => canvas.toDataURL()) !== backdrop, 'Theme changes must repaint the 3D backdrop')
  await page.evaluate(dark => document.body.toggleAttribute('data-ds-dark-theme', dark), initialDark)
  await settle()
  const restored = await capture('restored')
  assert(await page.locator('[data-room-layer="backdrop"]').evaluate(canvas => canvas.toDataURL()) === backdrop, 'Restoring the theme must restore the 3D backdrop exactly')
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
        // Repainting SVG shadows can round an 8-bit channel by one; geometry is checked exactly above.
        if (pixels[0].slice(offset, offset + 4).every((channel, index) => Math.abs(channel - pixels[1][offset + index]) <= 1)) continue
        const x = offset / 4 % canvas.width, y = Math.floor(offset / 4 / canvas.width)
        left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y)
        count += 1
      }
      return { left, top, right, bottom, count }
    }, [resting.toString('base64'), restored.toString('base64')])
    if (difference.count > 0) failures.push(`Theme restoration differs: ${JSON.stringify(difference)}`)
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

export async function verifyChat(page, { output, url, settle }) {
  const stem = output.slice(0, -extname(output).length)
  const originalViewport = page.viewportSize()
  const capture = name => page.locator('#stage').screenshot({ path: `${stem}-${name}.png`, animations: 'disabled' })
  const fit = async () => {
    const overflow = await page.locator('[data-team-tool], [data-team-presence], [role="dialog"], .chat-preview').evaluateAll(elements =>
      elements.filter(element => element.scrollWidth > element.clientWidth + 1).map(element => element.className))
    assert.deepEqual(overflow, [], 'Chat team surfaces must fit their container')
  }
  const toggle = () => page.locator('[data-team-presence] > button')
  const roster = () => page.getByRole('dialog')
  await page.goto(url, { waitUntil: 'networkidle' })
  await page.evaluate(() => document.fonts.ready)
  await settle()
  assert.equal(await page.locator('[data-team-tool]').count(), 3)
  assert.equal(await page.locator('[data-team-avatar]').count(), 4)
  await fit()

  await page.locator('[data-team-avatar="child-1"]').click()
  assert.equal(await page.locator('body').getAttribute('data-opened-member'), 'leader-1/child-1')
  await toggle().click()
  assert.equal(await roster().locator('[data-team-member]').count(), 5)
  await capture('team')
  await page.keyboard.press('Escape')
  assert.equal(await roster().count(), 0)
  assert.equal(await toggle().evaluate(element => element === document.activeElement), true)

  const card = page.locator('[data-team-tool="team_task"]')
  await card.locator('[aria-expanded]').click()
  const detailsId = await card.locator('[aria-controls]').getAttribute('aria-controls')
  assert.equal(await page.locator(`[id="${detailsId}"] pre`).count(), 2)
  await card.locator('[id] button').click()
  assert.equal(await page.locator('body').getAttribute('data-inspected'), 'call-team_task')
  await capture('details')
  await card.locator('[aria-expanded]').click()

  await page.evaluate(() => {
    const { team, sessions } = window.teamPreview
    window.originalTeam = team.getSnapshot()
    const snapshot = team.getSnapshot()
    team.set({ ...snapshot, members: Array.from({ length: 8 }, (_, index) => ({ ...snapshot.members[index % 4], memberId: `member-${index}`, name: `Teammate ${index + 1}` })) })
    sessions.set({ ...sessions.getSnapshot(), byId: { 'member-7': { id: 'member-7', running: true } } })
  })
  assert.match(await toggle().textContent(), /9/)
  await toggle().click()
  assert.equal(await roster().locator('[data-team-member]').count(), 9)
  assert.equal(await roster().locator('[data-team-member="member-7"] [data-running="true"]').count(), 1)
  await fit()
  await capture('full-team')
  await page.keyboard.press('Escape')
  await page.evaluate(() => { window.teamPreview.team.set({ ...window.originalTeam, members: [] }) })
  assert.equal(await page.locator('[data-team-presence]').count(), 0)
  assert.equal(await page.locator('[data-team-tool]').count(), 3)

  await page.goto(url, { waitUntil: 'networkidle' })
  await page.evaluate(() => document.body.toggleAttribute('data-ds-dark-theme'))
  await settle()
  await capture('dark')
  await toggle().click()
  await capture('dark-team')
  await fit()
  await page.mouse.click(10, 10)
  assert.equal(await roster().count(), 0)

  await page.goto(url, { waitUntil: 'networkidle' })
  await page.setViewportSize({ width: 390, height: 760 })
  await settle()
  await fit()
  await capture('narrow')
  await toggle().click()
  await fit()
  const bounds = await roster().boundingBox()
  assert(bounds.x >= 0 && bounds.x + bounds.width <= 391, 'Team roster stays inside the narrow viewport')
  await capture('narrow-team')
  await page.keyboard.press('Escape')

  const english = new URL(url)
  english.searchParams.set('locale', 'en')
  await page.goto(english.href, { waitUntil: 'networkidle' })
  await fit()
  await capture('narrow-english')
  await toggle().click()
  await fit()
  await capture('narrow-english-team')
  await page.setViewportSize(originalViewport)
  await page.keyboard.press('Escape')
  await capture('english')
  console.log('Verified chat cards, direct member navigation, live status, full roster, disband, details, keyboard focus, both themes, and narrow English/Chinese layouts.')
}
