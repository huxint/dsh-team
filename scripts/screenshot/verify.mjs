import assert from 'node:assert/strict'
import { extname } from 'node:path'

export async function verifyWorld(page, { output, url, settle }) {
  const stem = output.slice(0, -extname(output).length)
  const originalViewport = page.viewportSize()
  const capture = name => page.locator('#stage').screenshot({ path: `${stem}-${name}.png`, animations: 'disabled' })
  const ready = async () => {
    await page.waitForSelector('[data-renderer="webgl"] [data-world-ready="true"]')
    await page.evaluate(() => document.fonts.ready)
    await settle()
  }
  const fit = async () => {
    const overflow = await page.locator('[data-agent-team-stage], [data-world], [data-panel], [data-column], [data-world-inspector]').evaluateAll(elements => elements.filter(element => element.scrollWidth > element.clientWidth + 1).map(element => element.className))
    assert.deepEqual(overflow, [], 'World surfaces must fit their container')
  }
  const canvas = () => page.locator('canvas[data-world-ready]')
  await page.goto(url, { waitUntil: 'networkidle' })
  await ready()
  const english = await page.locator('html').getAttribute('lang') === 'en'
  const text = (zh, en) => english ? en : zh
  const control = (zh, en) => page.getByRole('button', { name: text(zh, en), exact: true })
  const resting = await canvas().screenshot()
  await page.reload({ waitUntil: 'networkidle' })
  await ready()
  assert(resting.equals(await canvas().screenshot()), 'A reduced-motion world must render reproducibly')
  assert.equal(await page.locator('[data-member]').count(), 5)
  assert.equal(await page.locator('[data-facility]').count(), 9)
  await fit()

  const labels = await page.locator('[data-member] > span:nth-child(2), [data-facility] > span').evaluateAll(elements => elements.map(element => {
    const style = getComputedStyle(element)
    return { opacity: style.opacity, background: style.backgroundColor, border: style.borderTopWidth }
  }))
  assert(labels.every(label => label.opacity === '0' && label.background === 'rgba(0, 0, 0, 0)' && label.border === '0px'), 'Scene labels are hidden and have no text boxes')
  await page.locator('[data-facility="pool"]').hover()
  assert.equal(await page.locator('[data-facility="pool"] > span').evaluate(element => getComputedStyle(element).opacity), '1')
  await capture('hover')
  await page.mouse.move(3, 3)

  for (const [panel, selector, count] of [['feed', '[data-message-kind]', 5], ['workspace', '[data-note-key]', 3], ['tasks', '[data-task-status]', 5]]) {
    const button = page.locator(`[data-panel-id="${panel}"]`)
    await button.click()
    const drawer = page.locator(`[data-panel="${panel}"]`)
    await drawer.waitFor()
    assert.equal(await drawer.locator(selector).count(), count)
    assert.equal(await button.getAttribute('aria-controls'), await drawer.getAttribute('id'))
    await fit()
    await capture(panel)
    await page.keyboard.press('Escape')
    assert.equal(await page.locator('[data-panel]').count(), 0)
    assert.equal(await button.evaluate(element => element === document.activeElement), true)
  }
  await page.locator('[data-resident="child-1"]').click()
  await page.locator('[data-world-inspector]').waitFor()
  assert.equal(await page.locator('[data-activity-command="pool"]').isDisabled(), true)
  await control('打开会话', 'Open session').click()
  assert.equal(await page.locator('body').getAttribute('data-opened-member'), 'leader-1/child-1')
  await page.keyboard.press('Escape')
  assert.equal(await page.locator('[data-world-inspector]').count(), 0)

  await control('放大', 'Zoom in').click()
  await settle()
  assert(Number(await canvas().getAttribute('data-world-zoom')) > 1)
  const rect = await canvas().boundingBox()
  await page.mouse.move(rect.x + rect.width * 0.7, rect.y + rect.height * 0.7)
  await page.mouse.wheel(0, -240)
  await settle()
  assert(Number(await canvas().getAttribute('data-world-zoom')) > 1.2)
  const angle = await canvas().getAttribute('data-world-angle')
  await page.mouse.down()
  await page.mouse.move(rect.x + rect.width * 0.7 + 130, rect.y + rect.height * 0.7 - 40, { steps: 9 })
  await page.mouse.up()
  await settle()
  assert.notEqual(await canvas().getAttribute('data-world-angle'), angle)
  await capture('orbit')
  await control('复位视角', 'Reset view').click()
  await settle()
  assert.equal(Number(await canvas().getAttribute('data-world-zoom')), 1)

  for (const floor of ['ground', 'terrace']) {
    await page.locator(`[data-floor-view="${floor}"]`).click()
    await settle()
    await capture(floor)
    await fit()
  }
  await page.locator('[data-floor-view="all"]').click()
  await control('调整岛上时间', 'Adjust island time').click()
  await control('夜晚', 'Night').click()
  await settle()
  assert.equal(await page.locator('[data-world]').getAttribute('data-night'), 'true')
  assert.equal(Number(await canvas().getAttribute('data-world-hour')), 23)
  assert(!resting.equals(await canvas().screenshot()), 'Night changes the rendered light and sky')
  await page.keyboard.press('Escape')
  await page.mouse.move(3, 3)
  await page.evaluate(() => document.activeElement?.blur())
  await capture('night')
  await control('调整岛上时间', 'Adjust island time').click()
  await control('日落', 'Dusk').click()
  await page.keyboard.press('Escape')
  await page.evaluate(() => document.activeElement?.blur())
  await settle()
  await capture('dusk')
  await page.goto(url, { waitUntil: 'networkidle' })
  await ready()

  await page.evaluate(() => document.body.toggleAttribute('data-ds-dark-theme'))
  await page.locator('[data-panel-id="tasks"]').click()
  await fit()
  await capture('dark-tasks')
  await page.keyboard.press('Escape')
  await page.evaluate(() => document.body.toggleAttribute('data-ds-dark-theme'))
  await page.evaluate(() => document.activeElement?.blur())
  await page.mouse.move(3, 3)
  await page.setViewportSize({ width: 390, height: 760 })
  await ready()
  await fit()
  await capture('narrow')
  const touch = await page.context().newCDPSession(page)
  await touch.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 })
  const narrow = await canvas().boundingBox()
  const touchY = narrow.y + narrow.height * 0.22
  const zoomBeforePinch = Number(await canvas().getAttribute('data-world-zoom'))
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: narrow.x + narrow.width * 0.4, y: touchY, id: 1 }, { x: narrow.x + narrow.width * 0.6, y: touchY, id: 2 }] })
  await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: narrow.x + narrow.width * 0.28, y: touchY, id: 1 }, { x: narrow.x + narrow.width * 0.72, y: touchY, id: 2 }] })
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await settle()
  assert(Number(await canvas().getAttribute('data-world-zoom')) > zoomBeforePinch, 'Pinching must zoom the island')
  assert.equal(await page.locator('[data-world-inspector]').count(), 0, 'Pinching must not select a resident')
  await touch.send('Emulation.setTouchEmulationEnabled', { enabled: false })
  await touch.detach()
  await control('复位视角', 'Reset view').click()
  await settle()
  await page.locator('[data-resident="child-3"]').click()
  await fit()
  await capture('narrow-resident')
  await page.keyboard.press('Escape')
  for (const panel of ['feed', 'workspace', 'tasks']) {
    await page.locator(`[data-panel-id="${panel}"]`).click()
    await fit()
    await page.keyboard.press('Escape')
  }
  await page.setViewportSize(originalViewport)

  await page.evaluate(() => {
    window.worldDraws = 0
    for (const method of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced']) {
      const draw = WebGL2RenderingContext.prototype[method]
      WebGL2RenderingContext.prototype[method] = function (...args) { window.worldDraws += 1; return draw.apply(this, args) }
    }
  })
  await settle()
  await page.evaluate(() => { window.worldDraws = 0 })
  await settle()
  assert.equal(await page.evaluate(() => window.worldDraws), 0, 'Reduced motion stops the animation loop')
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.waitForFunction(() => window.worldDraws > 0 && Number(document.querySelector('canvas').dataset.worldFps) > 0)
  assert(await page.evaluate(() => window.worldDraws) > 0)
  await page.locator('[data-resident="child-1"]').click()
  assert.equal(await page.locator('[data-activity-command="pool"]').isDisabled(), true, 'Active work cannot be interrupted by a leisure command')
  await page.keyboard.press('Escape')
  await control('暂停世界', 'Pause the world').click()
  await settle()
  await page.evaluate(() => { window.worldDraws = 0 })
  await settle()
  assert.equal(await page.evaluate(() => window.worldDraws), 0, 'The pause control stops animation')
  await control('继续世界', 'Resume the world').click()
  await page.locator('[data-resident="child-3"]').click()
  await page.locator('[data-activity-command="snack"]').click()
  await page.waitForFunction(() => document.querySelector('[data-member="child-3"]').dataset.activity === 'snack')
  await page.keyboard.press('Escape')

  await page.evaluate(() => { document.getElementById('stage').style.display = 'none' })
  await page.waitForFunction(() => document.querySelector('canvas').dataset.worldPaused === 'true')
  await page.evaluate(() => { window.worldDraws = 0 })
  await settle()
  assert.equal(await page.evaluate(() => window.worldDraws), 0, 'Offscreen worlds stop rendering')
  await page.evaluate(() => { document.getElementById('stage').style.display = '' })
  await page.waitForFunction(() => window.worldDraws > 0)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await settle()
  await page.evaluate(() => {
    window.worldContext = document.querySelector('canvas').getContext('webgl2').getExtension('WEBGL_lose_context')
    window.worldContext.loseContext()
  })
  await page.waitForSelector('[data-renderer="fallback"]')
  assert.equal(await page.locator('[data-member]:visible').count(), 5)
  await capture('fallback')
  await page.evaluate(() => window.worldContext.restoreContext())
  await ready()
  const englishUrl = new URL(url)
  englishUrl.searchParams.set('locale', 'en')
  await page.goto(englishUrl.href, { waitUntil: 'networkidle' })
  await ready()
  await capture('english')
  console.log('Verified hover-only labels, all team panels, session navigation, orbit and zoom, both floors, day/night, responsive layouts, resident commands, pause, visibility suspension, and WebGL recovery.')
}

export async function benchmarkWorld(page, { url, settle }) {
  await page.goto(url, { waitUntil: 'networkidle' })
  await page.waitForSelector('canvas[data-world-ready="true"]')
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  const measure = milliseconds => page.evaluate(duration => new Promise(resolve => {
    const times = []
    const start = performance.now()
    let previous = start
    const frame = now => {
      times.push(now - previous)
      previous = now
      if (now - start < duration) { requestAnimationFrame(frame); return }
      const sorted = times.slice(1).sort((a, b) => a - b)
      const canvas = document.querySelector('canvas')
      const gl = canvas.getContext('webgl2')
      const debug = gl.getExtension('WEBGL_debug_renderer_info')
      resolve({
        frames: times.length, fps: Math.round(times.length * 10000 / (now - start)) / 10,
        medianMs: sorted[Math.floor(sorted.length * 0.5)], p95Ms: sorted[Math.floor(sorted.length * 0.95)],
        drawCalls: Number(canvas.dataset.worldDraws), triangles: Number(canvas.dataset.worldTriangles),
        cpuMs: Number(canvas.dataset.worldCpuMs),
        resolution: [canvas.width, canvas.height], renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      })
    }
    requestAnimationFrame(frame)
  }), milliseconds)
  await measure(8500)
  const normal = await measure(5000)
  console.log(`World performance (5 residents): ${JSON.stringify(normal)}`)
  assert(normal.drawCalls <= 40, 'Normal world exceeds the draw-call budget')
  await page.evaluate(() => {
    const { team, sessions } = window.teamPreview
    const original = team.getSnapshot()
    const members = Array.from({ length: 8 }, (_, index) => ({ ...original.members[index % original.members.length], memberId: `bench-${index}`, name: `Resident ${index + 1}` }))
    const byId = Object.fromEntries([original.leaderId, ...members.map(member => member.memberId)].map(id => [id, { id, running: false }]))
    sessions.set({ ...sessions.getSnapshot(), byId })
    team.set({ ...original, members })
  })
  await settle()
  await measure(2000)
  const full = await measure(5000)
  console.log(`World performance (9 residents): ${JSON.stringify(full)}`)
  assert(full.drawCalls <= 40, 'Full world exceeds the draw-call budget')
  return { normal, full }
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
