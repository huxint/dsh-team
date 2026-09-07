import {
  deskStation, distance, FACILITIES, FLOOR_HEIGHT, LIFT, point, POOL_LEVEL, SEA_LEVEL,
  type Activity, type Floor, type Position, type Station, type Travel, type Waypoint,
} from './layout.ts'
import { Navigation } from './navigation.ts'

export interface WorldMember { id: string; name: string; seat: number; running: boolean; task: string; role: string }
export type Motion = Activity | Travel | 'waiting' | 'talk'
export interface Resident {
  member: WorldMember
  position: Position
  floor: Floor
  facing: number
  motion: Motion
  activity: Activity
  destination: Station
  route: Waypoint[]
  routeIndex: number
  elapsed: number
  nextActivity: number
  phase: number
  pending: Activity | undefined
  speech: string | undefined
  speechUntil: number
  delivery: boolean
  waitingAt: { retreat: Position; entry: Position } | undefined
  transport: 'stairs' | 'elevator'
}

export interface Elevator {
  y: number
  doors: number
  phase: 'idle' | 'calling' | 'boarding' | 'closing' | 'moving' | 'opening' | 'leaving' | 'parking'
  passenger: string | undefined
  from: number
  to: number
  elapsed: number
}

const LEISURE: readonly Activity[] = ['relax', 'snack', 'pool', 'run', 'sea', 'lookout', 'play', 'garden', 'camp', 'read']
const WALK_SPEED = 1.25
const SWIM_SPEED = 0.85
const AUTO_BREAK_SECONDS = 24

function seed(id: string): number {
  let hash = 2166136261
  for (const char of id) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619)
  return hash >>> 0
}

function move(position: Position, target: Position, amount: number): boolean {
  const length = distance(position, target)
  if (length <= amount) {
    position.x = target.x
    position.y = target.y
    position.z = target.z
    return true
  }
  const ratio = amount / length
  position.x += (target.x - position.x) * ratio
  position.y += (target.y - position.y) * ratio
  position.z += (target.z - position.z) * ratio
  return false
}

export class WorldSimulation {
  readonly residents = new Map<string, Resident>()
  readonly elevator: Elevator = { y: 0, doors: 1, phase: 'idle', passenger: undefined, from: 0, to: 0, elapsed: 0 }
  navigation!: Navigation
  stations: readonly Station[] = []
  seconds = 0
  hour = 10.5
  cycle = true
  private readonly reservations = new Map<string, string>()
  private rosterKey = ''
  private readonly liftQueue: string[] = []
  private readonly homeSlots = new Map<string, number>()
  private readonly homes = new Map<string, Station>()
  private readonly crossings = new Map<string, string>()

  constructor(members: readonly WorldMember[] = []) {
    this.setMembers(members)
  }

  setMembers(members: readonly WorldMember[]): void {
    const key = members.map(member => member.id).join('\0')
    if (key !== this.rosterKey || this.stations.length === 0) {
      this.rosterKey = key
      for (const id of this.homeSlots.keys()) {
        if (members.some(member => member.id === id)) continue
        this.homeSlots.delete(id)
        this.homes.delete(id)
      }
      for (const member of members) {
        if (this.homeSlots.has(member.id)) continue
        let slot = 0
        const occupied = new Set(this.homeSlots.values())
        while (occupied.has(slot)) slot += 1
        this.homeSlots.set(member.id, slot)
      }
      const deskCount = Math.ceil(Math.max(0, ...[...this.homeSlots.values()].map(slot => slot + 1)) / 9) * 9
      const desks = Array.from({ length: deskCount }, (_, index) => deskStation(index))
      for (const [id, slot] of this.homeSlots) this.homes.set(id, desks[slot]!)
      const visits = desks.map((desk): Station => ({
        ...desk, id: `visit-${desk.id}`, activity: 'lookout',
        position: point(desk.position.x + 1.18, 0, desk.position.z + 0.15),
        approach: point(desk.position.x + 1.18, 0, desk.position.z + 0.15),
      }))
      this.stations = [...desks, ...FACILITIES, ...visits]
      this.navigation = new Navigation(this.stations)
      for (const [id] of this.residents) {
        if (members.some(member => member.id === id)) continue
        this.residents.delete(id)
        this.release(id)
        for (const [crossing, owner] of this.crossings) if (owner === id) this.crossings.delete(crossing)
        const queued = this.liftQueue.indexOf(id)
        if (queued >= 0) this.liftQueue.splice(queued, 1)
        if (this.elevator.passenger === id) {
          this.elevator.passenger = undefined
          this.elevator.phase = 'parking'
        }
      }
      for (const actor of this.residents.values()) {
        actor.pending = actor.member.running ? 'work' : actor.activity
      }
    }
    members.forEach(member => {
      const existing = this.residents.get(member.id)
      if (existing) {
        const started = member.running && !existing.member.running
        existing.member = member
        if (started) existing.pending = 'work'
        return
      }
      const home = this.homes.get(member.id)!
      const destination = member.running ? home : this.available(LEISURE[(member.seat + LEISURE.length) % LEISURE.length]!, member.id) ?? home
      const phase = seed(member.id) % 1000 / 1000 * Math.PI * 2
      const actor: Resident = {
        member, position: { ...destination.position }, floor: destination.floor,
        facing: destination.facing, motion: destination.activity, activity: destination.activity,
        destination, route: [], routeIndex: 0, elapsed: 0, phase,
        nextActivity: this.seconds + AUTO_BREAK_SECONDS + seed(member.id) % 17,
        pending: undefined, speech: undefined, speechUntil: 0, delivery: false, waitingAt: undefined,
        transport: member.seat % 2 === 0 ? 'stairs' : 'elevator',
      }
      this.residents.set(member.id, actor)
      this.reservations.set(destination.id, member.id)
    })
  }

  command(id: string, activity: Activity): 'ok' | 'working' | 'full' | 'unreachable' {
    const actor = this.residents.get(id)
    if (!actor) return 'unreachable'
    if (actor.member.running && activity !== 'work') return 'working'
    if (actor.activity === activity && actor.pending === undefined && !actor.delivery) return 'ok'
    const home = this.homes.get(id)
    const station = activity === 'work' ? home : this.available(activity, id)
    if (!station) return 'full'
    if (this.transferring(actor)) {
      for (const [reserved, owner] of this.reservations) if (owner === id && reserved !== actor.destination.id) this.reservations.delete(reserved)
      this.reservations.set(station.id, id)
      actor.pending = activity
      return 'ok'
    }
    return this.send(actor, station) ? 'ok' : 'unreachable'
  }

  deliver(from: string, to: string, speech: string): void {
    const sender = this.residents.get(from)
    const recipient = this.residents.get(to)
    if (!sender || !recipient || from === to) return
    sender.speech = speech
    sender.speechUntil = this.seconds + 12
    recipient.speech = '···'
    recipient.speechUntil = this.seconds + 12
    if (this.transferring(sender) || sender.floor !== 'ground' || recipient.destination.activity !== 'work') return
    const meeting = this.stations.find(station => station.id === `visit-${recipient.destination.id}`)
    if (meeting && this.send(sender, meeting)) {
      sender.delivery = true
      sender.nextActivity = Infinity
    }
  }

  step(seconds: number): void {
    if (!Number.isFinite(seconds) || seconds <= 0) return
    const steps = Math.ceil(seconds / 0.05)
    const dt = seconds / steps
    for (let step = 0; step < steps; step += 1) this.advance(dt)
  }

  occupancy(activity: Activity): number {
    return [...this.residents.values()].filter(actor => actor.activity === activity).length
  }

  private advance(dt: number): void {
    this.seconds += dt
    if (this.cycle) this.hour = (this.hour + dt / 20) % 24
    const carried = this.elevator.passenger ?? this.liftQueue[0]
    this.advanceElevator(dt)
    for (const actor of this.residents.values()) {
      actor.elapsed += dt
      if (actor.speech !== undefined && this.seconds >= actor.speechUntil) actor.speech = undefined
      if (carried === actor.member.id) {
        if (this.elevator.passenger === actor.member.id) actor.motion = this.elevator.phase === 'calling' ? 'waiting' : 'elevator'
        continue
      }
      if (actor.pending !== undefined && !this.transferring(actor)) {
        const activity = actor.pending
        actor.pending = undefined
        this.command(actor.member.id, activity)
      }
      let next = actor.route[actor.routeIndex]
      if (next) {
        while (next.travel === 'walk' && distance(actor.position, next) < 0.7) {
          const after = actor.route[actor.routeIndex + 1]
          if (!after || after.travel !== 'walk' || after.floor !== next.floor || !this.navigation.clear(actor.position, after, next.floor)) break
          actor.routeIndex += 1
          next = after
        }
        if (next.travel === 'elevator') {
          actor.motion = this.elevator.passenger === actor.member.id ? 'elevator' : 'waiting'
          if (!this.liftQueue.includes(actor.member.id) && this.elevator.passenger !== actor.member.id) this.liftQueue.push(actor.member.id)
          continue
        }
        const crossing = next.travel === 'stairs' ? 'stairs' : next.travel === 'ladder' ? (next.z < 6 ? 'pool-ladder' : 'sea-ladder') : undefined
        if (crossing) {
          const owner = this.crossings.get(crossing)
          if (owner !== undefined && owner !== actor.member.id) {
            actor.motion = 'waiting'
            if (!actor.waitingAt) {
              const dx = actor.position.x - next.x
              const dz = actor.position.z - next.z
              const length = Math.hypot(dx, dz) || 1
              const choices = [1, -1].map(side => point(actor.position.x - dz / length * 0.7 * side, actor.position.y, actor.position.z + dx / length * 0.7 * side))
              const retreat = choices.find(candidate => this.navigation.clear(actor.position, candidate, actor.floor)) ?? { ...actor.position }
              actor.waitingAt = { retreat, entry: { ...actor.position } }
            }
            move(actor.position, actor.waitingAt.retreat, dt * WALK_SPEED)
            continue
          }
          this.crossings.set(crossing, actor.member.id)
          if (actor.waitingAt) {
            actor.motion = actor.floor === 'pool' || actor.floor === 'sea' ? 'swim' : 'walk'
            if (!this.blockedByResident(actor, actor.waitingAt.entry, dt * WALK_SPEED) && move(actor.position, actor.waitingAt.entry, dt * WALK_SPEED)) actor.waitingAt = undefined
            continue
          }
        }
        actor.motion = next.travel
        const dx = next.x - actor.position.x
        const dz = next.z - actor.position.z
        if (Math.abs(dx) + Math.abs(dz) > 0.005) actor.facing = Math.atan2(dx, dz)
        const swimming = next.travel === 'swim'
        const speed = swimming ? SWIM_SPEED : next.travel === 'ladder' ? 0.55 : next.travel === 'stairs' ? 0.95 : WALK_SPEED
        if (this.blockedByResident(actor, next, speed * dt)) continue
        if (move(actor.position, next, speed * dt)) {
          actor.floor = next.floor
          actor.routeIndex += 1
          if (crossing && actor.route[actor.routeIndex]?.travel !== next.travel) {
            this.crossings.delete(crossing)
            actor.motion = actor.route[actor.routeIndex]?.travel ?? actor.activity
          }
          if (actor.routeIndex === actor.route.length) this.arrive(actor)
        }
        continue
      }
      if (actor.delivery) {
        actor.motion = 'talk'
        if (actor.elapsed > 3) {
          actor.delivery = false
          actor.pending = 'work'
        }
      } else if (actor.activity === 'pool' || actor.activity === 'sea') this.swim(actor, dt)
      if (actor.member.running && actor.activity !== 'work' && !actor.delivery) actor.pending = 'work'
      if (!actor.member.running && !actor.delivery && this.seconds > actor.nextActivity) {
        const turn = Math.floor((this.seconds + seed(actor.member.id) % 31) / AUTO_BREAK_SECONDS)
        const activity = LEISURE[(turn + actor.member.seat + LEISURE.length) % LEISURE.length]!
        this.command(actor.member.id, activity)
        actor.nextActivity = this.seconds + AUTO_BREAK_SECONDS + seed(actor.member.id) % 13
      }
    }
  }

  private swim(actor: Resident, dt: number): void {
    const pool = actor.activity === 'pool'
    const index = Number(actor.destination.id.split('-')[1]) || 0
    const centerX = pool ? -4.5 : 9
    const centerZ = pool ? 2 + index * 0.8 : 8.35 + index * 1.1
    const radiusX = pool ? 2.45 : 1.6
    const radiusZ = pool ? 0.5 : 0.45
    const phase = actor.phase + actor.elapsed * (pool ? 0.29 : 0.35)
    const target = point(centerX + Math.cos(phase) * radiusX, pool ? POOL_LEVEL : SEA_LEVEL, centerZ + Math.sin(phase) * radiusZ)
    actor.facing = Math.atan2(target.x - actor.position.x, target.z - actor.position.z)
    move(actor.position, target, SWIM_SPEED * dt)
  }

  private blockedByResident(actor: Resident, next: Position, step: number): boolean {
    if (actor.motion !== 'walk') return false
    const desired = { ...actor.position }
    move(desired, next, step)
    let blocked = false
    for (const other of this.residents.values()) {
      if (other === actor || Math.abs(other.position.y - actor.position.y) > 0.35) continue
      if (distance(desired, other.position) < 0.5 && distance(desired, other.position) < distance(actor.position, other.position)) { blocked = true; break }
    }
    if (!blocked) return false
    const heading = Math.atan2(next.x - actor.position.x, next.z - actor.position.z)
    for (const angle of [1.2, -1.2, Math.PI / 2, -Math.PI / 2]) {
      const candidate = point(actor.position.x + Math.sin(heading + angle) * step, actor.position.y, actor.position.z + Math.cos(heading + angle) * step)
      if (!this.navigation.clear(actor.position, candidate, actor.floor) || !this.navigation.clear(candidate, next, actor.floor)) continue
      if ([...this.residents.values()].some(other => other !== actor && Math.abs(other.position.y - candidate.y) < 0.35 && distance(candidate, other.position) < 0.5)) continue
      move(actor.position, candidate, step)
      actor.facing = heading + angle
      break
    }
    return true
  }

  private available(activity: Activity, id: string): Station | undefined {
    return FACILITIES.find(station => station.activity === activity && (!this.reservations.has(station.id) || this.reservations.get(station.id) === id))
  }

  private send(actor: Resident, destination: Station): boolean {
    const reservation = this.reservations.get(destination.id)
    if (reservation !== undefined && reservation !== actor.member.id) return false
    const route = this.navigation.route(actor.position, actor.floor, destination.id, actor.transport)
    if (!route) return false
    this.release(actor.member.id)
    this.reservations.set(destination.id, actor.member.id)
    actor.destination = destination
    actor.activity = destination.activity
    actor.route = route
    actor.routeIndex = 0
    actor.delivery = false
    actor.elapsed = 0
    actor.nextActivity = this.seconds + AUTO_BREAK_SECONDS + seed(actor.member.id) % 17
    if (route.length === 0) this.arrive(actor)
    return true
  }

  private arrive(actor: Resident): void {
    actor.motion = actor.delivery ? 'talk' : actor.activity
    actor.facing = actor.destination.facing
    actor.floor = actor.destination.floor
    actor.elapsed = 0
    actor.nextActivity = this.seconds + AUTO_BREAK_SECONDS + seed(actor.member.id) % 17
  }

  private release(id: string): void {
    for (const [station, owner] of this.reservations) if (owner === id) this.reservations.delete(station)
  }

  private transferring(actor: Resident): boolean {
    const next = actor.route[actor.routeIndex]
    return this.elevator.passenger === actor.member.id || next?.travel === 'elevator' || next?.travel === 'stairs' || next?.travel === 'ladder'
  }

  private advanceElevator(dt: number): void {
    const lift = this.elevator
    if (lift.phase === 'parking') {
      if (lift.y > 0) {
        lift.doors = Math.max(0, lift.doors - dt / LIFT.doorSeconds)
        if (lift.doors === 0) lift.y = Math.max(0, lift.y - dt * LIFT.speed)
      } else {
        lift.doors = Math.min(1, lift.doors + dt / LIFT.doorSeconds)
        if (lift.doors === 1) lift.phase = 'idle'
      }
      return
    }
    if (lift.phase === 'idle') {
      const id = this.liftQueue.shift()
      if (id === undefined) return
      const actor = this.residents.get(id)
      if (!actor) return
      lift.passenger = id
      lift.from = actor.position.y > FLOOR_HEIGHT / 2 ? FLOOR_HEIGHT : 0
      lift.to = lift.from === 0 ? FLOOR_HEIGHT : 0
      lift.phase = 'calling'
      lift.elapsed = 0
    }
    lift.elapsed += dt
    const actor = this.residents.get(lift.passenger!)
    if (!actor) return
    if (lift.phase === 'calling') {
      if (Math.abs(lift.y - lift.from) > 0.01) {
        lift.doors = Math.max(0, lift.doors - dt / LIFT.doorSeconds)
        if (lift.doors === 0) lift.y += Math.sign(lift.from - lift.y) * Math.min(Math.abs(lift.from - lift.y), dt * LIFT.speed)
      } else {
        lift.y = lift.from
        lift.doors = Math.min(1, lift.doors + dt / LIFT.doorSeconds)
        if (lift.doors === 1) { lift.phase = 'boarding'; lift.elapsed = 0 }
      }
    } else if (lift.phase === 'boarding') {
      actor.facing = Math.PI
      if (move(actor.position, point(LIFT.x, lift.y, LIFT.z), dt * WALK_SPEED)) { lift.phase = 'closing'; lift.elapsed = 0 }
    } else if (lift.phase === 'closing') {
      lift.doors = Math.max(0, lift.doors - dt / LIFT.doorSeconds)
      if (lift.doors === 0) { lift.phase = 'moving'; lift.elapsed = 0 }
    } else if (lift.phase === 'moving') {
      const progress = Math.min(1, lift.elapsed / (FLOOR_HEIGHT / LIFT.speed + 0.5))
      const eased = progress * progress * (3 - 2 * progress)
      lift.y = lift.from + (lift.to - lift.from) * eased
      actor.position.y = lift.y
      if (progress === 1) { lift.phase = 'opening'; lift.elapsed = 0 }
    } else if (lift.phase === 'opening') {
      lift.doors = Math.min(1, lift.doors + dt / LIFT.doorSeconds)
      if (lift.doors === 1) { lift.phase = 'leaving'; lift.elapsed = 0 }
    } else if (lift.phase === 'leaving') {
      actor.facing = 0
      if (move(actor.position, point(LIFT.x, lift.to, LIFT.landingZ), dt * WALK_SPEED)) {
        actor.floor = lift.to === 0 ? 'ground' : 'terrace'
        actor.routeIndex += 1
        lift.passenger = undefined
        lift.phase = 'idle'
        if (actor.routeIndex === actor.route.length) this.arrive(actor)
      }
    }
  }
}
