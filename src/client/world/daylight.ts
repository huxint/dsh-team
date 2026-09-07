import { Color, MathUtils, Vector3 } from 'three'

export function daylight(hour: number): { sun: Vector3; moon: Vector3; light: number; dusk: number; night: boolean } {
  const angle = (hour - 6) / 24 * Math.PI * 2
  const altitude = Math.sin(angle)
  const sun = new Vector3(-Math.cos(angle) * 18, altitude * 19, -10)
  const moon = new Vector3(-sun.x, -sun.y, -10)
  const light = MathUtils.smoothstep(altitude, -0.15, 0.45)
  const dusk = Math.max(0, 1 - Math.abs(altitude) / 0.45)
  return { sun, moon, light, dusk, night: altitude < -0.12 }
}

const DAY_SKY = new Color('#dfeae4')
const NIGHT_SKY = new Color('#172b42')
const DUSK_SKY = new Color('#dfc4b3')
export function skyColor(light: number, dusk: number, target = new Color()): Color {
  return target.copy(NIGHT_SKY).lerp(DAY_SKY, light).lerp(DUSK_SKY, dusk * 0.55)
}
