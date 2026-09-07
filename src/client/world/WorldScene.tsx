import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Vector3 } from 'three'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { TeamMessageView } from '../../contract.ts'
import { MemberAvatar } from '../MemberAvatar.tsx'
import { appearance } from './appearance.ts'
import { daylight } from './daylight.ts'
import { FACILITIES, FLOOR_HEIGHT, inside, TERRACE, type Activity, type Position } from './layout.ts'
import { WorldRenderer, type FloorView } from './renderer.ts'
import type { Motion, WorldMember } from './simulation.ts'
import { WorldIcon } from './WorldIcon.tsx'
import css from './World.module.css'

type Translate = PropsLocale<'team'>['t']
type Facility = Exclude<Activity, 'work' | 'relax'>
interface Marker { activity: Facility; position: Position; title: string }
const MARKERS: readonly Marker[] = [
  { activity: 'pool', position: { x: -4.5, y: 0.1, z: 0.3 }, title: 'POOL CLUB' },
  { activity: 'run', position: { x: 5.15, y: 3.28, z: -0.5 }, title: 'MOVE & BREATHE' },
  { activity: 'snack', position: { x: 6, y: 0.15, z: 0.4 }, title: 'TIDE BITES' },
  { activity: 'sea', position: { x: 5.5, y: 0.25, z: 9.4 }, title: 'OPEN WATER' },
  { activity: 'lookout', position: { x: 2.5, y: 3.35, z: -5.9 }, title: 'SLOW MOMENTS' },
  { activity: 'play', position: { x: 13.5, y: 0.15, z: 2.8 }, title: 'COURTSIDE' },
  { activity: 'garden', position: { x: 13.8, y: 2.9, z: -4.2 }, title: 'THE GREENHOUSE' },
  { activity: 'camp', position: { x: 13.3, y: 0.65, z: 5.2 }, title: 'AFTER HOURS' },
  { activity: 'read', position: { x: 5.3, y: 2.55, z: -9.2 }, title: 'THE READING GARDEN' },
]
const ACTIONS: readonly Activity[] = ['work', 'pool', 'run', 'snack', 'sea', 'relax', 'play', 'garden', 'camp', 'read']
const timeLabel = (hour: number): string => `${String(Math.floor(hour)).padStart(2, '0')}:${String(Math.floor((hour % 1) * 60)).padStart(2, '0')}`

export function WorldScene(props: {
  readonly members: readonly WorldMember[]
  readonly currentId: string | undefined
  readonly leaderId: string
  readonly focus: string | undefined
  readonly message: TeamMessageView | undefined
  readonly onOpen: (id: string) => void
  readonly onFocus: (id: string | undefined) => void
  readonly controls: ReactNode
  readonly t: Translate
}) {
  const { members, currentId, leaderId, focus, message, onOpen, onFocus, controls, t } = props
  const screenId = useId()
  const host = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const runtime = useRef<WorldRenderer>()
  const memberLabels = useRef(new Map<string, HTMLButtonElement>())
  const markerLabels = useRef(new Map<Facility, HTMLButtonElement>())
  const rosterButtons = useRef(new Map<string, HTMLButtonElement>())
  const clockButton = useRef<HTMLButtonElement>(null)
  const [status, setStatus] = useState<'loading' | 'webgl' | 'fallback'>('loading')
  const [selected, setSelected] = useState<string>()
  const [facility, setFacility] = useState<Facility>()
  const [guest, setGuest] = useState<string>()
  const [hoveredResident, setHoveredResident] = useState<string>()
  const [clockOpen, setClockOpen] = useState(false)
  const [floor, setFloor] = useState<FloorView>('all')
  const [playing, setPlaying] = useState(true)
  const [reduced, setReduced] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [markers, setMarkers] = useState(true)
  const [notice, setNotice] = useState('')
  const [snapshot, setSnapshot] = useState({ hour: 10.5, fps: 0, cycle: true, revision: 0 })
  const membersRef = useRef(members)
  membersRef.current = members
  const playingRef = useRef(playing)
  playingRef.current = playing

  const refresh = useCallback(() => {
    const world = runtime.current
    if (!world) return
    setSnapshot(current => ({ hour: world.simulation.hour, fps: world.stats.fps, cycle: world.simulation.cycle, revision: current.revision + 1 }))
  }, [])

  useEffect(() => {
    const element = host.current
    const surface = canvas.current
    if (!element || !surface) return
    if (typeof WebGL2RenderingContext === 'undefined') { setStatus('fallback'); return }
    let world: WorldRenderer
    try {
      world = new WorldRenderer(surface, membersRef.current, id => { setSelected(id); setFacility(undefined); setNotice('') }, onFocus)
      runtime.current = world
      setStatus('webgl')
    } catch (error) {
      console.warn('The miniature world could not start', error)
      setStatus('fallback')
      return
    }
    const projected = new Vector3()
    const eye = new Vector3()
    world.onFrame = () => {
      world.view.camera.getWorldPosition(eye)
      for (const actor of world.simulation.residents.values()) {
        const button = memberLabels.current.get(actor.member.id)
        if (!button) continue
        const swimming = actor.motion === 'swim' || actor.motion === 'pool' || actor.motion === 'sea'
        const position = { x: actor.position.x, y: actor.position.y + (swimming ? 0.5 : 1.7), z: actor.position.z }
        world.view.project(position, projected)
        let covered = false
        if (world.floor !== 'ground' && actor.position.y < 2.5 && eye.y > FLOOR_HEIGHT) {
          const amount = (FLOOR_HEIGHT - actor.position.y - 1.1) / (eye.y - actor.position.y - 1.1)
          covered = amount > 0 && inside({ x: actor.position.x + (eye.x - actor.position.x) * amount, y: 0, z: actor.position.z + (eye.z - actor.position.z) * amount }, TERRACE)
        }
        const visible = !covered && !(world.floor === 'ground' && actor.position.y > 2.9) && projected.x > 8 && projected.x < world.view.width - 8 && projected.y > 50 && projected.y < world.view.height - 55 && projected.z < 1
        button.style.transform = `translate3d(${projected.x.toFixed(2)}px,${projected.y.toFixed(2)}px,0) translate(-50%,-100%)`
        button.style.visibility = visible ? 'visible' : 'hidden'
        button.dataset.motion = actor.motion
        button.dataset.activity = actor.activity
        button.dataset.floor = actor.floor
        button.dataset.position = `${actor.position.x.toFixed(3)},${actor.position.y.toFixed(3)},${actor.position.z.toFixed(3)}`
        const bubble = button.querySelector<HTMLElement>('[data-speech]')
        if (bubble) {
          const speech = actor.speech ?? ''
          if (bubble.textContent !== speech) bubble.textContent = speech.length > 52 ? `${speech.slice(0, 52)}…` : speech
          bubble.hidden = speech === ''
        }
      }
      for (const marker of MARKERS) {
        const button = markerLabels.current.get(marker.activity)
        if (!button) continue
        world.view.project(marker.position, projected)
        button.style.transform = `translate3d(${projected.x.toFixed(2)}px,${projected.y.toFixed(2)}px,0) translate(-50%,-100%)`
        button.style.visibility = world.floor === 'ground' && marker.position.y > 2.9 || projected.x < 0 || projected.x > world.view.width || projected.y < 40 || projected.y > world.view.height - 70 ? 'hidden' : 'visible'
      }
    }
    world.onStats = () => {
      surface.dataset.worldFps = String(world.stats.fps)
      surface.dataset.worldFrameMs = world.stats.frameMs.toFixed(2)
      surface.dataset.worldDraws = String(world.stats.calls)
      surface.dataset.worldTriangles = String(world.stats.triangles)
      surface.dataset.worldCpuMs = world.stats.cpuMs.toFixed(2)
      refresh()
    }
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
    let seen = true
    const activity = (): void => {
      setReduced(motion.matches)
      world.setActivity(seen && document.visibilityState !== 'hidden', motion.matches, playingRef.current)
    }
    const sizes = new ResizeObserver(() => { world.resize(element.clientWidth, element.clientHeight) })
    sizes.observe(element)
    const sight = new IntersectionObserver(entries => { seen = entries.at(-1)?.isIntersecting ?? seen; activity() })
    sight.observe(element)
    const lost = (event: Event): void => {
      event.preventDefault()
      world.contextLost = true
      activity()
      setStatus('fallback')
    }
    const restored = (): void => {
      world.contextLost = false
      setStatus('webgl')
      activity()
    }
    surface.addEventListener('webglcontextlost', lost)
    surface.addEventListener('webglcontextrestored', restored)
    motion.addEventListener('change', activity)
    document.addEventListener('visibilitychange', activity)
    world.resize(element.clientWidth, element.clientHeight)
    activity()
    return () => {
      sizes.disconnect()
      sight.disconnect()
      motion.removeEventListener('change', activity)
      document.removeEventListener('visibilitychange', activity)
      surface.removeEventListener('webglcontextlost', lost)
      surface.removeEventListener('webglcontextrestored', restored)
      world.dispose()
      runtime.current = undefined
    }
  }, [refresh, onFocus])

  useEffect(() => { runtime.current?.setMembers(members); refresh() }, [members, refresh])
  useEffect(() => {
    const world = runtime.current
    if (!world) return
    world.focus = focus
    world.selected = selected
    world.invalidate()
  }, [focus, selected])
  useEffect(() => {
    const world = runtime.current
    if (world) world.setActivity(world.visible, reduced, playing)
  }, [playing, reduced])
  useEffect(() => {
    if (selected && !members.some(member => member.id === selected)) setSelected(undefined)
  }, [members, selected])

  const lastMessage = useRef(message?.messageId)
  useEffect(() => {
    if (!message || message.messageId === lastMessage.current) return
    lastMessage.current = message.messageId
    if (message.kind !== 'settled') {
      runtime.current?.simulation.deliver(message.from ?? leaderId, message.to ?? leaderId, message.text)
      runtime.current?.invalidate()
    }
  }, [message, leaderId])

  const closeInspector = (): void => {
    if (selected) rosterButtons.current.get(selected)?.focus({ preventScroll: true })
    if (facility) markerLabels.current.get(facility)?.focus({ preventScroll: true })
    setSelected(undefined)
    setFacility(undefined)
    setNotice('')
  }
  const chooseFloor = (value: FloorView): void => { setFloor(value); runtime.current?.setFloor(value) }
  const setHour = (hour: number, manual = false): void => {
    const world = runtime.current
    if (!world) return
    world.simulation.hour = hour
    if (manual) world.simulation.cycle = false
    world.invalidate()
    refresh()
  }
  const command = (id: string, activity: Activity): void => {
    const world = runtime.current
    if (!world) return
    const result = world.simulation.command(id, activity)
    setNotice(result === 'ok' ? t('world.onTheWay', { name: members.find(member => member.id === id)?.name ?? '', activity: t(`world.activity.${activity}`) }) : t(`world.result.${result}`))
    world.invalidate()
    refresh()
  }
  const fullscreen = async (): Promise<void> => {
    const element = host.current?.parentElement
    if (!element) return
    try {
      if (document.fullscreenElement === element) await document.exitFullscreen()
      else await element.requestFullscreen()
    } catch {
      setNotice(t('world.fullscreenUnavailable'))
    }
  }
  const active = members.find(member => member.id === selected)
  const actor = selected ? runtime.current?.simulation.residents.get(selected) : undefined
  const guestId = guest && members.some(member => member.id === guest && !member.running) ? guest : members.find(member => !member.running)?.id
  const motionLabel = (motion: Motion): string => t(`world.motion.${motion}`)
  const transportControls = (id: string | undefined): ReactNode => {
    const resident = id ? runtime.current?.simulation.residents.get(id) : undefined
    return <div className={css.transport}>{(['stairs', 'elevator'] as const).map(transport => <button key={transport} type="button" disabled={!resident} aria-label={t(`world.transport.${transport}`)} aria-pressed={resident?.transport === transport} onClick={() => { if (resident) resident.transport = transport; refresh() }}><WorldIcon name={transport} size={17} /><span className={css.tip}>{t(`world.transport.${transport}`)}</span></button>)}</div>
  }
  const night = daylight(snapshot.hour).night
  const disabled = status !== 'webgl'
  const paused = !playing || reduced
  const selectFacility = (marker: Marker): void => {
    setSelected(undefined)
    setFacility(marker.activity)
    setNotice('')
  }

  return (
    <section className={css.world} aria-label={t('world.title')} data-world data-status={status} data-night={night ? 'true' : undefined} onKeyDown={event => {
      if (event.key !== 'Escape') return
      if (clockOpen) { setClockOpen(false); clockButton.current?.focus(); event.stopPropagation() }
      else if (selected || facility) { closeInspector(); event.stopPropagation() }
    }}>
      <div ref={host} className={css.viewport} data-renderer={status}>
        <canvas ref={canvas} className={css.canvas} aria-label={t('world.canvas')} aria-describedby={`${screenId}-hint`} tabIndex={disabled ? -1 : 0} onKeyDown={event => {
          const world = runtime.current
          if (!world) return
          if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); world.rotate(event.key === 'ArrowLeft' ? 1 : -1) }
          if (event.key === '+' || event.key === '=' || event.key === '-') { event.preventDefault(); world.view.zoom(event.key === '-' ? 1 / 1.2 : 1.2); world.invalidate() }
          if (event.key === 'Home') { event.preventDefault(); world.resetCamera() }
        }} />
        <button className={css.worldMark} type="button" aria-label={t('world.title')} onClick={() => { runtime.current?.resetCamera() }}><WorldIcon name="island" size={26} /><span className={css.tip}>{t('world.title')}</span></button>
        <div className={css.skyControls}>
          <button ref={clockButton} className={css.clock} type="button" onClick={() => { setClockOpen(value => !value) }} aria-label={t('world.clock')} aria-expanded={clockOpen} disabled={disabled}>
            <WorldIcon name={night ? 'moon' : 'sun'} size={24} /><span className={css.tip}>{timeLabel(snapshot.hour)} · {t('world.islandTime')}</span>
          </button>
          {clockOpen && <div className={css.clockPanel} role="dialog" aria-label={t('world.clock')}>
            <div className={css.panelTitle}><span>{t('world.dayCycle')}</span><span>{timeLabel(snapshot.hour)}</span></div>
            <input className={css.timeRange} aria-label={t('world.time')} type="range" min="0" max="23.99" step="0.25" value={snapshot.hour} onChange={event => { setHour(Number(event.target.value), true) }} />
            <div className={css.timeTicks}><span>00:00</span><span>12:00</span><span>24:00</span></div>
            <div className={css.presets}>{([['morning', 7], ['noon', 12], ['sunset', 18], ['night', 23]] as const).map(([name, hour]) => <button key={name} type="button" onClick={() => { setHour(hour, true) }}>{t(`world.${name}`)}</button>)}</div>
            <label className={css.cycleToggle}><input type="checkbox" checked={snapshot.cycle} onChange={event => { if (runtime.current) runtime.current.simulation.cycle = event.target.checked; refresh() }} />{t('world.dayCycle')}</label>
          </div>}
        </div>

        <div className={css.memberLabels}>
          {members.map(member => <button
            ref={element => { if (element) memberLabels.current.set(member.id, element); else memberLabels.current.delete(member.id) }}
            key={member.id} className={css.memberLabel} type="button" data-member={member.id}
            data-running={member.running ? 'true' : undefined} data-focus={focus === member.id ? 'true' : undefined}
            aria-label={member.id === leaderId ? t('member.openLeader') : t('member.open', { name: member.name })}
            aria-current={currentId === member.id} aria-describedby={`${screenId}-${member.id}`}
            onClick={() => { onOpen(member.id) }} onMouseEnter={() => { onFocus(member.id) }} onMouseLeave={() => { onFocus(undefined) }}
            onFocus={() => { onFocus(member.id) }} onBlur={() => { onFocus(undefined) }}
            style={{ '--resident-color': appearance(member.seat).shirt } as React.CSSProperties}
          ><span className={css.fallbackPortrait}><MemberAvatar seat={member.seat} name={member.name} /></span><span className={css.nameplate}><i />{member.name}<span className={css.nameArrow}>↗</span></span><span hidden className={css.speech} data-speech={member.id} /><span id={`${screenId}-${member.id}`} className={css.srOnly}>{member.task}</span></button>)}
        </div>

        {status === 'webgl' && markers && <div className={css.markers}>{MARKERS.map(marker => <button
          ref={element => { if (element) markerLabels.current.set(marker.activity, element); else markerLabels.current.delete(marker.activity) }}
          key={marker.activity} type="button" className={css.marker} data-facility={marker.activity} aria-label={t(`world.facility.${marker.activity}`)} aria-pressed={facility === marker.activity}
          onClick={() => { selectFacility(marker) }}
        ><WorldIcon name={marker.activity} size={16} /><span className={css.tip}>{t(`world.facility.${marker.activity}`)}</span></button>)}</div>}

        {status === 'loading' && <div className={css.loading}><WorldIcon name="island" size={30} /><span>{t('world.loading')}</span></div>}
        {status === 'fallback' && <p className={css.fallbackNotice}>{t('world.fallback')}</p>}

        {(active || facility) && <aside className={css.inspector} aria-label={t(active ? 'world.memberDetails' : 'world.facilityDetails')} data-world-inspector>
          <button className={css.inspectorClose} type="button" aria-label={t('world.closeDetails')} onClick={closeInspector}><WorldIcon name="close" size={15} /></button>
          {active ? <>
            <div className={css.inspectorMember}><span className={css.inspectorAvatar}><MemberAvatar seat={active.seat} name={active.name} /></span><div><strong>{active.name}</strong><span>{t(active.running ? 'status.running' : 'status.idle')} · {motionLabel(actor?.motion ?? (active.running ? 'work' : 'relax'))}</span></div></div>
            <p className={css.memberRole}>{active.role}</p>
            <p className={css.memberTask} title={active.task}>{active.task || t('world.freeTime')}</p>
            <div className={css.actions}>{ACTIONS.map(activity => <button type="button" key={activity} data-activity-command={activity} disabled={disabled || paused || active.running && activity !== 'work'} onClick={() => { command(active.id, activity) }}><WorldIcon name={activity} size={17} /><span>{t(`world.activity.${activity}`)}</span></button>)}</div>
            {transportControls(active.id)}
            <p className={css.actionHint}>{t(active.running ? 'world.workingHint' : paused ? 'world.pausedHint' : 'world.autonomy')}</p>
            <button className={css.openSession} type="button" onClick={() => { onOpen(active.id) }}>{t(active.id === leaderId ? 'member.openLeader' : 'world.openSession')}<WorldIcon name="arrow" size={15} /></button>
          </> : facility && <>
            <span className={css.facilityEyebrow}>{MARKERS.find(marker => marker.activity === facility)?.title}</span>
            <h3 className={css.facilityTitle}><WorldIcon name={facility} size={20} />{t(`world.facility.${facility}`)}</h3>
            <p className={css.facilityDescription}>{t(`world.description.${facility}`)}</p>
            <div className={css.facilityCount}><span>{t('world.occupancy')}</span><strong>{runtime.current?.simulation.occupancy(facility) ?? 0} / {FACILITIES.filter(station => station.activity === facility).length}</strong></div>
            <label className={css.guestLabel}>{t('world.invite')}<select aria-label={t('world.chooseMember')} value={guestId ?? ''} onChange={event => { setGuest(event.target.value) }}>
              {!guestId && <option value="">{t('world.allWorking')}</option>}
              {members.map(member => <option key={member.id} value={member.id} disabled={member.running}>{member.name}{member.running ? ` · ${t('status.running')}` : ''}</option>)}
            </select></label>
            {transportControls(guestId)}
            <button className={css.primaryAction} type="button" disabled={!guestId || paused} onClick={() => { if (guestId) command(guestId, facility) }}>{t(`world.activity.${facility}`)}<WorldIcon name="arrow" size={16} /></button>
            {paused && <p className={css.actionHint}>{t('world.pausedHint')}</p>}
          </>}
          {notice && <p className={css.notice} role="status">{notice}</p>}
        </aside>}

        <div className={css.residents} aria-label={t('world.residents')}><span className={css.residentName}>{members.find(member => member.id === hoveredResident)?.name}</span><div className={css.residentList}>{members.map(member => <button
          ref={element => { if (element) rosterButtons.current.set(member.id, element); else rosterButtons.current.delete(member.id) }}
          className={css.resident} key={member.id} type="button" data-resident={member.id} data-running={member.running ? 'true' : undefined}
          aria-label={t('world.inspectMember', { name: member.name })} aria-pressed={selected === member.id}
          onMouseEnter={() => { setHoveredResident(member.id) }} onMouseLeave={() => { setHoveredResident(undefined) }} onFocus={() => { setHoveredResident(member.id) }} onBlur={() => { setHoveredResident(undefined) }}
          onClick={() => { setSelected(current => current === member.id ? undefined : member.id); setFacility(undefined); setNotice('') }}
        ><MemberAvatar seat={member.seat} name={member.name} /><i /></button>)}</div></div>

        <div className={css.viewControls}>
          <div className={css.floorSwitch} aria-label={t('world.floors')}>{(['all', 'ground', 'terrace'] as const).map(value => <button type="button" key={value} data-floor-view={value} disabled={disabled} aria-label={t(`world.floor.${value}`)} aria-pressed={floor === value} onClick={() => { chooseFloor(value) }}><WorldIcon name={value === 'all' ? 'layers' : value} size={17} /><span className={css.tip}>{t(`world.floor.${value}`)}</span></button>)}</div>
          <div className={css.cameraControls}>
            {([['left', 'rotateLeft', () => runtime.current?.rotate(1)], ['right', 'rotateRight', () => runtime.current?.rotate(-1)], ['minus', 'zoomOut', () => { runtime.current?.view.zoom(1 / 1.2); runtime.current?.invalidate() }], ['plus', 'zoomIn', () => { runtime.current?.view.zoom(1.2); runtime.current?.invalidate() }], ['reset', 'reset', () => runtime.current?.resetCamera()]] as const).map(([icon, title, action]) => <button type="button" key={title} disabled={disabled} aria-label={t(`world.${title}`)} onClick={action}><WorldIcon name={icon} size={16} /><span className={css.tip}>{t(`world.${title}`)}</span></button>)}
          </div>
        </div>

        <div className={css.simControls}>
          <button type="button" disabled={disabled || reduced} aria-label={t(playing && !reduced ? 'world.pause' : 'world.play')} data-world-control="pause" onClick={() => { setPlaying(value => !value) }}><WorldIcon name={playing && !reduced ? 'pause' : 'resume'} size={15} /><span className={css.tip}>{t(playing && !reduced ? 'world.pause' : 'world.play')}</span></button>
          <button type="button" disabled={disabled || reduced} aria-label={t('world.speed', { speed })} onClick={() => { const next = speed === 4 ? 1 : speed * 2; setSpeed(next); if (runtime.current) runtime.current.speed = next }}><WorldIcon name="speed" size={16} /><span className={css.tip}>{t('world.speed', { speed })}</span></button>
          <span />
          <button type="button" disabled={disabled} aria-label={t('world.markers')} aria-pressed={markers} onClick={() => { setMarkers(value => !value); runtime.current?.invalidate() }}><WorldIcon name="map" size={16} /><span className={css.tip}>{t('world.markers')}</span></button>
          <button type="button" disabled={disabled} aria-label={t('world.fullscreen')} onClick={() => { void fullscreen() }}><WorldIcon name="expand" size={16} /><span className={css.tip}>{t('world.fullscreen')}</span></button>
        </div>
        {notice && !active && !facility && <p className={css.worldNotice} role="status">{notice}</p>}
      </div>
      <footer className={css.footer}><div className={css.live} tabIndex={0}><i data-paused={paused ? 'true' : undefined} /><span className={css.tip}>{t(reduced ? 'world.reducedMotion' : playing ? 'world.live' : 'world.paused')}{snapshot.fps > 0 && !paused && status === 'webgl' ? ` · ${snapshot.fps} FPS` : ''}</span></div><span id={`${screenId}-hint`} className={css.srOnly}>{t('world.hint')}</span>{controls}</footer>
    </section>
  )
}
