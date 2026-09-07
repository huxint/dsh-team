import { describe, expect, it } from 'vitest'
import { distance, FLOOR_HEIGHT, LIFT, POOL_LEVEL, type Activity } from '../src/client/world/layout.ts'
import { WorldSimulation, type WorldMember } from '../src/client/world/simulation.ts'

function member(id: string, seat: number, running = false): WorldMember {
  return { id, name: id, seat, running, task: '', role: '' }
}

function atDesks(count = 3): { world: WorldSimulation; members: WorldMember[] } {
  const members = Array.from({ length: count }, (_, index) => member(`resident-${index}`, index))
  const world = new WorldSimulation(members.map(member => ({ ...member, running: true })))
  world.setMembers(members)
  return { world, members }
}

function until(world: WorldSimulation, condition: () => boolean, seconds = 150): void {
  for (let step = 0; step < seconds * 20 && !condition(); step += 1) world.step(0.05)
  expect(condition(), 'The requested transition did not complete').toBe(true)
}

describe('resident activities', () => {
  it('keeps active work at the desk and rejects leisure commands', () => {
    const world = new WorldSimulation([member('worker', 0, true)])
    const start = { ...world.residents.get('worker')!.position }
    expect(world.command('worker', 'pool')).toBe('working')
    world.step(90)
    expect(world.residents.get('worker')).toMatchObject({ position: start, motion: 'work', activity: 'work' })
  })

  it.each<Activity>(['pool', 'sea', 'run', 'snack', 'relax', 'lookout', 'play', 'garden', 'camp', 'read'])('reaches %s through a continuous route', activity => {
    const { world } = atDesks(1)
    const actor = world.residents.get('resident-0')!
    const origin = { ...actor.position }
    expect(world.command(actor.member.id, activity)).toBe('ok')
    expect(actor.position).toEqual(origin)
    let previous = { ...actor.position }
    until(world, () => {
      expect(distance(previous, actor.position)).toBeLessThanOrEqual(0.085)
      previous = { ...actor.position }
      return actor.motion === activity && actor.routeIndex === actor.route.length
    })
    expect(actor.position.x).toBeCloseTo(actor.destination.position.x, 1)
    expect(actor.position.y).toBeCloseTo(actor.destination.position.y, 1)
  })

  it('reserves both treadmills and reports a full facility to the next resident', () => {
    const { world } = atDesks()
    expect(world.command('resident-0', 'run')).toBe('ok')
    expect(world.command('resident-1', 'run')).toBe('ok')
    const third = world.residents.get('resident-2')!
    const position = { ...third.position }
    expect(world.command('resident-2', 'run')).toBe('full')
    expect(third.position).toEqual(position)
    expect(world.residents.get('resident-0')!.destination.id).not.toBe(world.residents.get('resident-1')!.destination.id)
  })

  it('gets out of the pool by the ladder when a new task starts', () => {
    const members = [member('swimmer', 2)]
    const world = new WorldSimulation(members)
    const actor = world.residents.get('swimmer')!
    world.step(2)
    expect(actor.position.y).toBe(POOL_LEVEL)
    world.setMembers([{ ...members[0]!, running: true }])
    const positions: number[][] = []
    until(world, () => { if (actor.motion === 'ladder') positions.push([actor.position.x, actor.position.y, actor.position.z]); return actor.motion === 'work' })
    expect(positions.some(([x, y, z]) => Math.abs(x! + 1.5) < 0.03 && y! > -0.3 && y! < -0.05 && z === 3)).toBe(true)
    expect(actor.position.y).toBe(0)
  })

  it('gives idle residents autonomous activities over time', () => {
    const { world } = atDesks(1)
    const actor = world.residents.get('resident-0')!
    until(world, () => actor.activity !== 'work', 60)
    expect(actor.destination.activity).not.toBe('work')
  })

  it('lets only one resident use a pool ladder at a time', () => {
    const world = new WorldSimulation([member('leaving', 2), member('entering', 0)])
    const leaving = world.residents.get('leaving')!
    const entering = world.residents.get('entering')!
    leaving.position = { x: -2, y: -0.35, z: 3 }
    entering.position = { x: -0.5, y: 0, z: 3 }
    entering.floor = 'ground'
    world.command('leaving', 'work')
    world.command('entering', 'pool')
    let waited = false
    const crossed = new Set<string>()
    for (let step = 0; step < 200; step += 1) {
      world.step(0.05)
      const actors = [...world.residents.values()]
      const onLadder = actors.filter(actor => actor.motion === 'ladder')
      expect(onLadder.length).toBeLessThanOrEqual(1)
      for (const actor of onLadder) crossed.add(actor.member.id)
      waited ||= actors.some(actor => actor.motion === 'waiting')
    }
    expect(waited).toBe(true)
    expect(crossed.size).toBe(2)
  })

  it('keeps a remaining member at the same physical workstation after another leaves', () => {
    const members = [member('a', 0, true), member('b', 1, true), member('c', 2, true)]
    const world = new WorldSimulation(members)
    const actor = world.residents.get('c')!
    const position = { ...actor.position }
    world.setMembers(members.slice(1))
    world.step(2)
    expect(actor.position).toEqual(position)
    expect(actor.motion).toBe('work')
    world.setMembers(members.slice(1).map(member => ({ ...member, running: member.id !== 'c' })))
    world.command('c', 'snack')
    until(world, () => actor.motion === 'snack')
    world.setMembers(members.slice(1))
    until(world, () => actor.motion === 'work')
    expect(actor.position).toEqual(position)
  })

  it('seats the supported 64 teammates and lets the farthest one reach the island', () => {
    const members = Array.from({ length: 65 }, (_, index) => member(`member-${index}`, index - 1, true))
    const world = new WorldSimulation(members)
    expect(new Set([...world.residents.values()].map(actor => `${actor.position.x},${actor.position.z}`)).size).toBe(65)
    world.setMembers(members.map((member, index) => ({ ...member, running: index !== 64 })))
    const actor = world.residents.get('member-64')!
    expect(world.command(actor.member.id, 'pool')).toBe('ok')
    until(world, () => actor.motion === 'pool', 180)
    expect(actor.floor).toBe('pool')
  })

  it('brings a message to a free place beside the recipient and returns to work', () => {
    const world = new WorldSimulation([member('sender', 0, true), member('recipient', 1, true)])
    const sender = world.residents.get('sender')!
    const recipient = world.residents.get('recipient')!
    const home = { ...sender.position }
    world.deliver('sender', 'recipient', 'The review is ready.')
    expect(sender.speech).toBe('The review is ready.')
    until(world, () => sender.motion === 'talk')
    expect(distance(sender.position, recipient.position)).toBeGreaterThan(0.65)
    expect(distance(sender.position, recipient.position)).toBeLessThan(2)
    until(world, () => sender.motion === 'work')
    expect(sender.position).toEqual(home)
  })
})

describe('the shared elevator', () => {
  it('returns an empty cabin to the ground smoothly when its passenger leaves the team', () => {
    const { world, members } = atDesks(2)
    world.command('resident-1', 'run')
    until(world, () => world.elevator.phase === 'moving')
    world.step(0.8)
    const height = world.elevator.y
    expect(height).toBeGreaterThan(0.1)
    world.setMembers(members.slice(0, 1))
    expect(world.elevator.y).toBe(height)
    until(world, () => world.elevator.phase === 'idle')
    expect(world.elevator.y).toBe(0)
    expect(world.elevator.passenger).toBeUndefined()
  })

  it('closes the doors before travelling and carries its passenger at the cabin height', () => {
    const { world } = atDesks(2)
    const actor = world.residents.get('resident-1')!
    expect(world.command(actor.member.id, 'run')).toBe('ok')
    until(world, () => world.elevator.phase === 'moving')
    expect(world.elevator.doors).toBe(0)
    for (let frame = 0; frame < 20; frame += 1) {
      world.step(0.05)
      expect(actor.position).toEqual({ x: LIFT.x, y: world.elevator.y, z: LIFT.z })
      expect(world.elevator.doors).toBe(0)
    }
    until(world, () => actor.motion === 'run')
    expect(actor.floor).toBe('terrace')
    expect(actor.position.y).toBeCloseTo(FLOOR_HEIGHT + 0.22)
  })

  it('finishes a lift transfer safely before returning a newly busy passenger to work', () => {
    const { world, members } = atDesks(2)
    const actor = world.residents.get('resident-1')!
    world.command(actor.member.id, 'run')
    until(world, () => world.elevator.phase === 'moving')
    world.step(0.8)
    const position = { ...actor.position }
    world.setMembers(members.map(member => ({ ...member, running: member.id === actor.member.id })))
    expect(actor.position).toEqual(position)
    let previous = { ...actor.position }
    until(world, () => {
      expect(distance(previous, actor.position)).toBeLessThan(0.09)
      previous = { ...actor.position }
      return actor.motion === 'work'
    })
    expect(actor.position.y).toBe(0)
    expect(world.elevator.passenger).toBeUndefined()
  })
})

describe('island time', () => {
  it('wraps midnight into the next morning', () => {
    const world = new WorldSimulation()
    world.hour = 23.95
    world.step(2)
    expect(world.hour).toBeCloseTo(0.05, 5)
  })

  it('holds the selected time when the day cycle is disabled', () => {
    const world = new WorldSimulation()
    world.hour = 18
    world.cycle = false
    world.step(30)
    expect(world.hour).toBe(18)
  })
})
