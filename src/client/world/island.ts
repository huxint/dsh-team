import { Group, MeshBasicMaterial } from 'three'
import { appearance } from './appearance.ts'
import { FLOOR_HEIGHT, LAND, POOL, STAIR_COUNT, TRAY, TREES, type Station } from './layout.ts'
import { Voxels } from './voxels.ts'

const C = {
  cream: '#f4e9d4', white: '#fff7e8', sand: '#e4c89b', rock: '#b59878', soil: '#9c7861',
  grass: '#91ab76', grassLight: '#a7be87', leaf: '#477c61', leafLight: '#719b6a',
  wood: '#b88058', woodLight: '#d7ab7d', woodDark: '#755844', teal: '#559c9c',
  coral: '#d68573', pink: '#edb6a0', blue: '#86b9ca', dark: '#344b52', metal: '#849995',
} as const

export interface Island { group: Group; upper: Group; desks: Group; lights: Group; maxX: number; minX: number }

function planter(v: Voxels, x: number, y: number, z: number, scale = 1): void {
  v.box(x, y + 0.2 * scale, z, 0.55 * scale, 0.4 * scale, 0.55 * scale, C.coral)
  v.box(x, y + 0.4 * scale, z, 0.64 * scale, 0.1 * scale, 0.64 * scale, C.pink)
  v.box(x, y + 0.46 * scale, z, 0.48 * scale, 0.06 * scale, 0.48 * scale, C.soil)
  for (let i = 0; i < 5; i += 1) {
    const angle = i * Math.PI * 2 / 5
    v.box(x + Math.cos(angle) * 0.17 * scale, y + 0.76 * scale, z + Math.sin(angle) * 0.17 * scale, 0.17 * scale, 0.68 * scale, 0.2 * scale, i % 2 ? C.leaf : C.leafLight, { rz: Math.cos(angle) * 0.4, rx: Math.sin(angle) * 0.4 })
  }
}

function palm(v: Voxels, x: number, z: number, height: number, lean: number): void {
  for (let i = 0; i < 9; i += 1) {
    v.box(x + i * lean / 9, height * (i + 0.5) / 9, z, 0.34 - i * 0.012, height / 9 + 0.035, 0.34 - i * 0.012, i % 2 ? C.woodDark : C.wood)
  }
  const top = x + lean
  for (let leaf = 0; leaf < 7; leaf += 1) {
    const angle = leaf * Math.PI * 2 / 7
    for (let segment = 0; segment < 5; segment += 1) {
      const radius = 0.25 + segment * 0.34
      v.box(top + Math.cos(angle) * radius, height + 0.2 - segment * segment * 0.053, z + Math.sin(angle) * radius,
        0.65 - segment * 0.075, 0.18, 0.55 - segment * 0.055, (leaf + segment) % 3 === 0 ? C.leafLight : C.leaf, { ry: -angle })
    }
  }
  for (const offset of [-0.2, 0.16]) v.box(top + offset, height - 0.22, z + 0.15, 0.28, 0.3, 0.26, C.woodDark)
  v.box(x, 0.05, z, 1, 0.1, 0.9, C.sand)
}

function parasol(v: Voxels, x: number, y: number, z: number, paint: string, size = 1): void {
  v.box(x, y + 1.15 * size, z, 0.09, 2.3 * size, 0.09, C.woodDark)
  v.box(x, y + 0.04, z, 0.5, 0.08, 0.5, C.cream)
  for (let layer = 0; layer < 4; layer += 1) {
    const width = (2.9 - layer * 0.65) * size
    const top = y + (2.08 + layer * 0.13) * size
    v.box(x, top, z, width, 0.16 * size, width, layer % 2 ? C.white : paint)
  }
  v.box(x, y + 2.65 * size, z, 0.15, 0.17, 0.15, C.woodDark)
}

function lounger(v: Voxels, x: number, z: number, paint: string): void {
  for (const dz of [-0.55, 0.55]) v.box(x, 0.18, z + dz, 0.65, 0.35, 0.1, C.wood)
  v.box(x, 0.4, z, 0.78, 0.16, 1.7, C.white)
  v.box(x, 0.5, z - 0.55, 0.76, 0.12, 0.65, paint, { rx: -0.35 })
  v.box(x, 0.51, z + 0.25, 0.58, 0.05, 0.65, paint)
}

function railing(v: Voxels, x1: number, z1: number, x2: number, z2: number, y: number): void {
  const length = Math.hypot(x2 - x1, z2 - z1)
  const count = Math.ceil(length / 0.8)
  for (let i = 0; i <= count; i += 1) {
    v.box(x1 + (x2 - x1) * i / count, y + 0.48, z1 + (z2 - z1) * i / count, 0.065, 0.96, 0.065, C.white)
  }
  const alongX = Math.abs(x1 - x2) > Math.abs(z1 - z2)
  for (const height of [0.48, 0.96]) v.box((x1 + x2) / 2, y + height, (z1 + z2) / 2, alongX ? length + 0.06 : 0.06, 0.065, alongX ? 0.06 : length + 0.06, C.cream)
}

function ladder(v: Voxels, x: number, z: number, bottom: number, alongX: boolean): void {
  for (const side of [-0.28, 0.28]) {
    v.box(x + (alongX ? 0 : side), (bottom + 0.6) / 2, z + (alongX ? side : 0), 0.055, 0.6 - bottom, 0.055, C.white)
    v.box(x + (alongX ? 0.2 : side), 0.6, z + (alongX ? side : 0.2), alongX ? 0.44 : 0.055, 0.055, alongX ? 0.055 : 0.44, C.white)
  }
  for (let y = bottom + 0.1; y < 0.15; y += 0.22) v.box(x, y, z, alongX ? 0.09 : 0.6, 0.06, alongX ? 0.6 : 0.09, C.metal)
}

function ring(v: Voxels, x: number, y: number, z: number, scale: number): void {
  for (let i = 0; i < 8; i += 1) {
    const angle = i * Math.PI / 4
    v.box(x + Math.sin(angle) * scale, y + Math.cos(angle) * scale, z, scale * 0.6, scale * 0.6, 0.13, i % 2 ? C.white : C.coral)
  }
}

function terrain(v: Voxels, west: number): void {
  const minX = Math.min(TRAY.minX, west - 1.7)
  const width = TRAY.maxX - minX
  const depth = TRAY.maxZ - TRAY.minZ
  const centerX = (TRAY.maxX + minX) / 2
  const centerZ = (TRAY.maxZ + TRAY.minZ) / 2
  v.box(centerX, -1.87, centerZ, width + 0.4, 0.4, depth + 0.4, C.cream)
  v.box(centerX, -1.66, centerZ, width, 0.07, depth, C.woodLight)
  v.box(centerX, -1.4, centerZ, width - 0.2, 0.35, depth - 0.2, '#429c9f')
  for (const side of [-1, 1]) {
    v.box(centerX + side * width / 2, -1.03, centerZ, 0.24, 1.35, depth + 0.2, C.cream)
    v.box(centerX, -1.03, centerZ + side * depth / 2, width + 0.2, 1.35, 0.24, C.cream)
    v.box(centerX + side * width / 2, -0.34, centerZ, 0.28, 0.06, depth + 0.3, C.white)
  }
  const groundParts = [
    [-9.5, -7.75, -10, 7], [-7.75, -1.25, -10, 0.5], [-7.75, -1.25, 5.5, 7], [-1.25, 17.5, -10, 7],
    ...west < -9.5 ? [[west, -9.5, -10, 0.6]] : [],
  ]
  for (const [x1, x2, z1, z2] of groundParts) {
    v.box((x1! + x2!) / 2, -0.64, (z1! + z2!) / 2, x2! - x1!, 1.22, z2! - z1!, C.sand)
    v.box((x1! + x2!) / 2, -0.04, (z1! + z2!) / 2, x2! - x1!, 0.08, z2! - z1!, C.cream)
  }
  for (let i = 0; i < 37; i += 1) {
    const x = -9.6 + i * 0.75
    const depth = 0.35 + Math.sin(i * 7.4) * 0.2
    v.box(x, -0.29, 7.02 + depth / 2, 0.75, 0.5, depth + 0.12, i % 4 === 0 ? C.rock : C.sand)
    if (i % 3 === 0) v.box(x, -0.55, 7.25 + depth, 0.5, 0.28, 0.6, C.rock)
  }
  for (let i = 0; i < 26; i += 1) {
    v.box(-9.55, -0.38, -9.7 + i * 0.66, 0.45 + (i % 3) * 0.12, 0.55, 0.7, i % 3 ? C.sand : C.rock)
    v.box(17.6, -0.36, -9.7 + i * 0.66, 0.4 + (i % 4) * 0.07, 0.5, 0.7, i % 4 ? C.sand : C.rock)
  }
  v.box(4.5, 0.02, 4.9, 8.7, 0.04, 3.2, C.grass)
  v.box(8.9, 0.02, -3.2, 0.6, 0.04, 6.6, C.grass)
  v.box(-8.75, 0.02, -4.4, 1.15, 0.04, 4.6, C.grassLight)
  v.box(13.5, 0.015, -1.5, 8, 0.03, 16.8, C.grass)
  v.box(0, 0.015, -8.5, 18.8, 0.03, 2.9, C.grassLight)
  for (let i = 0; i < 36; i += 1) {
    const x = 0.35 + (i * 1.71 % 8.5)
    const z = 4.1 + (i * 1.37 % 2.3)
    v.box(x, 0.055, z, 0.13, 0.05, 0.08, i % 3 ? C.grassLight : '#c5cb92')
  }
  for (let i = 0; i < 13; i += 1) v.box(0, 0.035, -5.8 + i * 0.95, 1.15, 0.07, 0.76, i % 3 ? '#dbc9ae' : '#e6d7c0')
  for (let i = 0; i < 9; i += 1) v.box(0.7 + i * 0.94, 0.035, 0.4, 0.78, 0.07, 1.15, i % 3 ? '#dbc9ae' : '#e6d7c0')
}

function pool(v: Voxels): void {
  const cx = (POOL.minX + POOL.maxX) / 2
  const cz = (POOL.minZ + POOL.maxZ) / 2
  v.box(cx, -1.1, cz, 6.5, 0.2, 5, '#59a9ac')
  for (let x = POOL.minX + 0.25; x < POOL.maxX; x += 0.5) {
    for (let z = POOL.minZ + 0.25; z < POOL.maxZ; z += 0.5) {
      v.box(x, -0.99, z, 0.47, 0.02, 0.47, (Math.round(x * 2) + Math.round(z * 2)) % 3 ? '#92d0d1' : '#b6e1dd')
    }
  }
  for (const x of [POOL.minX, POOL.maxX]) {
    v.box(x, -0.55, cz, 0.16, 1, 5, '#93c9c4')
    v.box(x, 0.035, cz, 0.34, 0.13, 5.4, C.white)
  }
  for (const z of [POOL.minZ, POOL.maxZ]) {
    v.box(cx, -0.55, z, 6.5, 1, 0.16, '#93c9c4')
    v.box(cx, 0.035, z, 6.8, 0.13, 0.34, C.white)
  }
  for (let x = POOL.minX; x < POOL.maxX; x += 0.42) {
    v.box(x + 0.18, 0.105, POOL.minZ, 0.014, 0.01, 0.33, '#d9d4bf')
    v.box(x + 0.18, 0.105, POOL.maxZ, 0.014, 0.01, 0.33, '#d9d4bf')
  }
  for (const z of [1.2, 4.8]) {
    v.box(cx, -0.975, z, 4.5, 0.03, 0.08, C.white)
    for (const x of [-6.7, -2.3]) v.box(x, -0.974, z, 0.08, 0.035, 0.65, C.white)
  }
  ladder(v, -1.5, 3, -1.05, true)
  for (const z of [1.7, 4.2]) lounger(v, -8.65, z, z < 2 ? C.coral : C.teal)
  parasol(v, -8.6, 0, 3, C.coral, 0.62)
  v.box(-8.5, 1.12, -0.55, 0.055, 2.24, 0.055, C.metal)
  v.box(-8.28, 2.2, -0.55, 0.46, 0.07, 0.08, C.metal)
  v.box(-8.08, 2.17, -0.55, 0.23, 0.06, 0.23, C.dark)
  v.box(-8.5, 0.02, -0.55, 0.8, 0.04, 0.8, C.wood)
  v.box(-0.72, 0.75, 4.85, 0.08, 1.5, 0.08, C.wood)
  ring(v, -0.72, 1.03, 4.89, 0.34)
  for (let i = 0; i < 3; i += 1) {
    v.box(-8.6 + i * 0.12, 0.08, 5.7, 0.09, 0.08, 0.26, i % 2 ? C.white : C.coral)
  }
  v.box(-2.3, 0.12, 6.1, 1.3, 0.05, 0.55, C.teal)
  v.box(-2.65, 0.155, 6.1, 0.12, 0.03, 0.54, C.white)
}

function office(v: Voxels, stations: readonly Station[]): void {
  v.box(-4.5, -0.05, -5.15, 9.05, 0.1, 8.1, C.woodLight)
  for (let x = -8.95; x <= -0.1; x += 0.27) v.box(x, 0.007, -5.15, 0.018, 0.014, 8.1, '#bb956f')
  for (const x of [-8.9, -0.2]) {
    for (const z of [-9.13, -1.2]) v.box(x, 1.6, z, 0.16, 3.2, 0.16, C.white)
  }
  for (const z of [-9.13, -1.2]) v.box(-4.55, 3.13, z, 8.85, 0.21, 0.18, C.white)
  for (let x = -8.9; x <= -0.1; x += 0.7) v.box(x, 3.25, -5.15, 0.12, 0.18, 8.15, C.woodLight)
  for (const x of [-7, -5, -3]) {
    v.box(x, 2.7, -9.1, 1.65, 0.25, 0.16, C.teal)
    v.box(x, 2.48, -9.1, 0.06, 0.16, 0.08, '#edbc62')
  }
  for (let i = 0; i < stations.length; i += 1) {
    const station = stations[i]!
    const { x, z } = station.position
    const clothes = appearance(i - 1)
    for (const side of [-0.88, 0.88]) {
      for (const depth of [-1.04, -0.49]) v.box(x + side, 0.47, z + depth, 0.085, 0.78, 0.085, C.white)
    }
    v.box(x, 0.93, z - 0.8, 2.06, 0.14, 0.8, C.cream)
    v.box(x, 1.07, z - 0.97, 0.24, 0.2, 0.15, C.dark)
    v.box(x, 1.42, z - 1, 0.84, 0.59, 0.09, C.dark)
    v.box(x, 1.43, z - 0.944, 0.73, 0.47, 0.025, i % 3 === 0 ? '#77b0b5' : i % 3 === 1 ? '#849eb2' : '#bfab94')
    for (let line = 0; line < 4; line += 1) v.box(x - 0.13 + line % 2 * 0.04, 1.57 - line * 0.09, z - 0.925, 0.3 + line % 2 * 0.12, 0.035, 0.015, line % 2 ? '#dce3c7' : '#a3d7cc')
    v.box(x - 0.05, 1.013, z - 0.53, 0.6, 0.035, 0.21, C.dark)
    v.box(x + 0.43, 1.025, z - 0.52, 0.12, 0.06, 0.17, C.white)
    v.box(x - 0.78, 1.1, z - 0.68, 0.16, 0.2, 0.16, clothes.shirt)
    v.box(x - 0.78, 1.21, z - 0.68, 0.11, 0.015, 0.11, C.woodDark)
    v.box(x + 0.79, 1.04, z - 0.92, 0.22, 0.075, 0.26, i % 2 ? C.coral : C.teal)
    v.box(x, 0.31, z + 0.06, 0.12, 0.44, 0.12, C.dark)
    v.box(x, 0.49, z + 0.03, 0.65, 0.12, 0.6, clothes.shirt)
    v.box(x, 0.83, z + 0.3, 0.64, 0.6, 0.13, clothes.shirt)
    for (const dx of [-0.23, 0.23]) v.box(x + dx, 0.115, z + 0.04, 0.12, 0.12, 0.53, C.dark)
  }
  planter(v, -8.35, 0.1, -3.15, 0.68)
  planter(v, -0.7, 0.1, -5.8, 0.72)
}

function clubhouse(v: Voxels, upper: Voxels): void {
  const y = FLOOR_HEIGHT
  v.box(5.5, -0.055, -3.2, 6.3, 0.11, 5.5, C.woodLight)
  for (const x of [2.35, 7.12, 8.65]) {
    for (const z of [-6.1, -0.65]) v.box(x, y / 2, z, 0.2, y, 0.2, C.white)
  }
  v.box(5.1, 1.25, -5.9, 5.5, 2.5, 0.15, C.teal)
  v.box(5.1, 2.56, -5.9, 5.6, 0.15, 0.19, C.cream)
  v.box(5.1, 0.65, -4.15, 3.8, 1.2, 1.5, C.coral)
  v.box(5.1, 1.3, -4.15, 3.95, 0.13, 1.65, C.cream)
  for (let x = 3.35; x < 7; x += 0.28) v.box(x, 0.65, -3.39, 0.09, 1.05, 0.05, C.pink)
  for (const x of [3.7, 5.1, 6.5]) {
    v.box(x, 1.79, -5.65, 0.95, 0.8, 0.18, C.woodDark)
    for (let row = 0; row < 3; row += 1) {
      v.box(x, 1.46 + row * 0.28, -5.52, 1, 0.05, 0.46, C.woodLight)
      for (let jar = 0; jar < 3; jar += 1) v.box(x - 0.28 + jar * 0.28, 1.58 + row * 0.28, -5.45, 0.15, 0.19, 0.16, [C.cream, C.coral, '#c3c485'][(row + jar) % 3]!)
    }
  }
  v.box(6.2, 1.6, -4.35, 0.53, 0.48, 0.5, C.dark)
  v.box(6.2, 1.6, -4.09, 0.35, 0.19, 0.04, C.metal)
  v.box(6.2, 1.4, -3.96, 0.17, 0.2, 0.16, C.white)
  for (let i = 0; i < 4; i += 1) v.box(3.8 + i * 0.24, 1.43, -3.9, 0.2, 0.13 + i % 2 * 0.04, 0.23, i % 2 ? '#bca862' : '#e2ad61')
  for (let i = 0; i < 14; i += 1) v.box(3.3 + i * 0.285, 2.28, -3.65, 0.285, 0.1, 1.15, i % 2 ? C.white : C.teal, { rx: 0.1 })
  planter(v, 2.75, 0.1, -1.5, 0.68)
  for (const [x1, x2, z1, z2] of [[2.25, 7.25, -6.25, -0.5], [7.25, 8.75, -6.25, -2.75], [7.25, 8.75, -1.25, -0.5]]) {
    upper.box((x1! + x2!) / 2, y - 0.13, (z1! + z2!) / 2, x2! - x1!, 0.26, z2! - z1!, C.cream)
  }
  for (let x = 2.4; x <= 7.1; x += 0.3) upper.box(x, y + 0.013, -3.4, 0.018, 0.026, 5.45, '#d5bda2')
  railing(upper, 2.3, -0.57, 8.7, -0.57, y)
  railing(upper, 8.65, -2.9, 8.65, -6.15, y)
  railing(upper, 2.35, -6.15, 8.65, -6.15, y)
  railing(upper, 2.35, -4.65, 2.35, -0.57, y)
  for (const x of [4, 6]) {
    upper.box(x, y + 0.11, -4.3, 1.18, 0.22, 1.85, C.dark)
    upper.box(x, y + 0.225, -4.3, 0.82, 0.015, 1.62, '#5c696c')
    for (const side of [-0.52, 0.52]) {
      upper.box(x + side, y + 0.64, -4.98, 0.09, 1.1, 0.09, C.metal)
      upper.box(x + side, y + 0.95, -4.63, 0.09, 0.07, 0.8, C.dark)
    }
    upper.box(x, y + 1.21, -5, 1.12, 0.29, 0.22, C.dark, { rx: -0.18 })
    upper.box(x, y + 1.25, -4.86, 0.39, 0.15, 0.025, '#91c8b4')
    upper.box(x + 0.38, y + 1.24, -4.855, 0.085, 0.08, 0.035, C.coral)
  }
  upper.box(7, y + 0.07, -5.5, 0.7, 0.12, 1.1, C.teal)
  for (const z of [-5.85, -5.45]) {
    upper.box(7, y + 0.25, z, 0.55, 0.09, 0.09, C.metal)
    for (const side of [-0.25, 0.25]) upper.box(7 + side, y + 0.25, z, 0.14, 0.27, 0.27, C.dark)
  }
  upper.box(3.2, y + 0.03, -1.7, 0.65, 0.04, 1.15, C.pink)
  upper.box(3.2, y + 0.06, -2.1, 0.6, 0.06, 0.23, C.coral)
  planter(upper, 8.15, y, -5.65, 0.8)
  planter(upper, 2.85, y, -0.9, 0.65)

  for (let step = 0; step < STAIR_COUNT; step += 1) {
    const height = (step + 1) * y / STAIR_COUNT
    const depth = 5.5 / STAIR_COUNT
    const z = -0.5 - (step + 0.5) * depth
    v.box(1.5, height / 2, z, 1.35, height, depth, C.cream)
    v.box(1.5, height + 0.01, z + depth * 0.33, 1.34, 0.025, 0.04, C.woodLight)
    if (step % 3 === 0) for (const side of [-0.67, 0.67]) v.box(1.5 + side, height + 0.44, z, 0.055, 0.88, 0.055, C.white)
  }
  v.box(1.75, y - 0.13, -5.95, 1.6, 0.26, 0.65, C.cream)
  for (const side of [-0.67, 0.67]) v.box(1.5 + side, y / 2 + 0.94, -3.25, 0.065, 0.065, Math.hypot(5.5, y), C.wood, { rx: Math.atan2(y, 5.5) })

  for (const x of [7.25, 8.75]) {
    for (const z of [-2.75, -1.25]) v.box(x, 2.25, z, 0.1, 4.5, 0.1, C.teal)
    v.box(x, 4.49, -2, 0.16, 0.14, 1.6, C.teal)
  }
  v.box(8, 4.49, -2, 1.6, 0.15, 1.6, C.teal)
  for (const level of [0, y]) {
    v.box(8, level + 1.18, -1.24, 1.6, 0.12, 0.13, C.teal)
    v.box(7.35, level + 0.68, -1.14, 0.18, 0.25, 0.07, C.dark)
    v.box(7.35, level + 0.7, -1.095, 0.07, 0.06, 0.02, '#e6cb84')
  }
}

function beach(v: Voxels): void {
  for (let i = 0; i < 13; i += 1) v.box(5.5, -0.06, 6.4 + i * 0.245, 1.5, 0.12, 0.225, i % 3 ? C.woodLight : C.wood)
  for (const x of [4.87, 6.13]) {
    for (const z of [7.1, 8.7, 9.4]) v.box(x, -0.6, z, 0.13, 1.3, 0.13, C.woodDark)
    for (const z of [7.15, 9.25]) v.box(x, 0.32, z, 0.15, 0.56, 0.15, C.wood)
  }
  ladder(v, 6.2, 9, -1.1, true)
  ring(v, 4.84, 0.45, 8.2, 0.25)
  v.box(4.75, 0.24, 3.48, 4.2, 0.45, 0.74, C.wood)
  v.box(4.75, 0.52, 3.53, 4.12, 0.13, 0.83, C.white)
  v.box(4.75, 0.88, 3.09, 4.15, 0.65, 0.2, C.teal)
  for (const x of [2.7, 6.8]) v.box(x, 0.7, 3.5, 0.16, 0.6, 0.85, C.woodDark)
  for (const x of [3.45, 5.9]) v.box(x, 0.9, 3.26, 0.48, 0.44, 0.19, C.pink)
  parasol(v, 7.2, 0, 4.25, C.teal, 0.92)
  v.box(4.6, 0.32, 4.83, 0.12, 0.6, 0.12, C.woodDark)
  v.box(4.6, 0.62, 4.83, 1.45, 0.12, 0.7, C.cream)
  for (const x of [4.2, 5]) v.box(x, 0.77, 4.8, 0.16, 0.23, 0.16, C.coral)
  v.box(2.8, 0.1, 5.55, 1.1, 0.06, 1.45, '#d99c87')
  for (let stripe = 0; stripe < 4; stripe += 1) v.box(2.8, 0.136, 5.08 + stripe * 0.3, 1.08, 0.012, 0.085, C.cream)
  for (let i = 0; i < 3; i += 1) {
    v.box(7.8 + i * 0.31, 0.8, 5.85, 0.25, 1.65, 0.1, [C.coral, C.white, C.teal][i]!, { rz: -0.14 })
    v.box(7.8 + i * 0.31, 0.8, 5.92, 0.08, 1.35, 0.04, C.woodLight, { rz: -0.14 })
  }
  for (const x of [7.4, 8.8]) v.box(x, 0.42, 5.75, 0.13, 0.8, 0.13, C.woodDark)
  v.box(8.1, 0.65, 5.73, 1.5, 0.1, 0.1, C.woodDark)
  for (const [x, z] of [[7.3, 7.65], [9.3, 7.65], [11.3, 7.65], [11.3, 9.9], [9.3, 10.25], [7.3, 10.25]]) {
    v.box(x!, -0.65, z!, 0.19, 0.23, 0.19, C.coral)
    v.box(x!, -0.49, z!, 0.08, 0.12, 0.08, C.white)
  }
  for (let i = 0; i < 17; i += 1) {
    v.box(7.3 + i * 0.25, -0.63, 7.65, 0.2, 0.035, 0.035, C.cream)
    v.box(7.3 + i * 0.25, -0.63, 10.25, 0.2, 0.035, 0.035, C.cream)
  }
}

function broadleaf(v: Voxels, x: number, z: number, height: number): void {
  v.box(x, height * 0.35, z, 0.27, height * 0.7, 0.27, C.woodDark)
  for (let layer = 0; layer < 3; layer += 1) {
    for (let branch = 0; branch < 5; branch += 1) {
      const angle = branch * Math.PI * 2 / 5
      const radius = layer === 1 ? 0.7 : 0.35
      v.box(x + Math.cos(angle) * radius, height * 0.63 + layer * 0.38, z + Math.sin(angle) * radius, 0.95 - layer * 0.12, 0.75, 0.95 - layer * 0.12, (branch + layer) % 3 ? C.leafLight : C.leaf)
      if (layer === 0 && branch % 2) v.box(x + Math.cos(angle) * 0.8, height * 0.65, z + Math.sin(angle) * 0.8, 0.16, 0.17, 0.16, '#dda259')
    }
  }
}

function courtyard(v: Voxels, glass: Voxels): void {
  v.box(13.5, 0.024, 0.45, 6.1, 0.04, 5.65, '#779d91')
  v.box(13.1, 0.049, -0.78, 2.8, 0.016, 2.85, '#c6917b')
  for (const x of [10.55, 16.42]) v.box(x, 0.057, 0.45, 0.06, 0.016, 5.6, C.cream)
  for (const z of [-2.25, 3.13]) v.box(13.5, 0.057, z, 5.9, 0.016, 0.06, C.cream)
  for (const x of [11.7, 14.5]) v.box(x, 0.061, -0.78, 0.055, 0.016, 2.85, C.cream)
  v.box(13.1, 0.061, 0.64, 2.8, 0.016, 0.055, C.cream)
  for (let segment = 0; segment < 20; segment += 1) {
    const angle = segment / 19 * Math.PI
    v.box(13.1 + Math.cos(angle) * 2.4, 0.062, -1.8 + Math.sin(angle) * 2.4, 0.16, 0.015, 0.045, C.cream, { ry: -angle + Math.PI / 2 })
  }
  for (const x of [10.43, 16.58]) {
    for (let z = -2.4; z < 3.5; z += 0.74) v.box(x, 0.72, z, 0.055, 1.44, 0.055, C.teal)
    for (const y of [0.45, 1.35]) v.box(x, y, 0.5, 0.035, 0.035, 5.8, '#a2b7a4')
  }
  for (let x = 10.45; x < 16.6; x += 0.73) v.box(x, 0.72, -2.4, 0.055, 1.44, 0.055, C.teal)
  v.box(13.5, 1.35, -2.4, 6.1, 0.035, 0.035, '#a2b7a4')
  for (const [left, right] of [[10.43, 11.6], [14.9, 16.58]]) railing(v, left!, 3.32, right!, 3.32, 0)
  v.box(13.1, 1.06, -2.04, 0.11, 2.12, 0.11, C.dark)
  v.box(13.1, 2.15, -1.94, 1.22, 0.83, 0.09, C.white)
  for (const x of [12.87, 13.33]) v.box(x, 2.1, -1.883, 0.025, 0.3, 0.02, C.coral)
  for (const y of [1.95, 2.25]) v.box(13.1, y, -1.883, 0.49, 0.025, 0.02, C.coral)
  for (const z of [-1.85, -1.46]) v.box(13.1, 1.94, z, 0.45, 0.045, 0.045, C.coral)
  for (const x of [12.87, 13.33]) v.box(x, 1.94, -1.655, 0.045, 0.045, 0.43, C.coral)
  for (const side of [-1, 1]) for (const end of [-1, 1]) v.box(13.1 + side * 0.16, 1.81, -1.65 + end * 0.15, 0.025, 0.24, 0.025, C.white)
  for (const x of [10.8, 15.85]) {
    v.box(x, 0.045, 2.75, 0.24, 0.09, 0.24, C.coral)
    v.box(x, 0.19, 2.75, 0.1, 0.23, 0.1, '#edb778')
  }
  v.box(15.65, 0.06, 3.65, 0.75, 0.08, 0.4, C.blue)
  v.box(15.65, 0.18, 3.65, 0.14, 0.2, 0.14, C.white)

  v.box(13.8, -0.045, -6.55, 5.9, 0.09, 5, C.woodLight)
  for (const x of [11.12, 16.47]) {
    for (const z of [-8.84, -6.5, -4.2]) v.box(x, 1.2, z, 0.085, 2.4, 0.085, C.white)
    v.box(x, 2.4, -6.52, 0.12, 0.12, 4.8, C.white)
    glass.box(x, 1.22, -6.52, 0.035, 2.2, 4.5, '#c7e5d5')
  }
  for (const z of [-8.84, -4.2]) {
    v.box(13.8, 3, z, 5.58, 0.1, 0.1, C.white)
    v.box(13.8, 2.4, z, 5.5, 0.1, 0.1, C.white)
  }
  for (let x = 11.2; x <= 16.5; x += 1.07) {
    v.box(x, 2.73, -6.52, 0.055, 0.06, 4.7, '#d6c6a5')
    for (const z of [-8.85, -4.2]) v.box(x, 2.69, z, 0.055, 0.61, 0.065, C.white)
  }
  glass.box(13.8, 2.75, -6.55, 5.35, 0.025, 4.6, '#d7eadd')
  glass.box(13.8, 1.2, -8.85, 5.35, 2.3, 0.03, '#c7e5d5')
  for (const x of [12.25, 15.3]) {
    v.box(x, 0.22, -6.7, 1.5, 0.44, 3.3, C.wood)
    v.box(x, 0.45, -6.7, 1.35, 0.055, 3.15, C.soil)
    for (let row = 0; row < 6; row += 1) {
      for (const offset of [-0.34, 0.34]) {
        const z = -7.98 + row * 0.5
        v.box(x + offset, 0.56, z, 0.36, 0.18, 0.3, C.leaf)
        v.box(x + offset, 0.71, z, 0.24, 0.18, 0.23, C.leafLight)
        if (row % 2 === 0) v.box(x + offset + 0.13, 0.67, z + 0.08, 0.14, 0.12, 0.12, x < 13 ? '#cf7560' : '#d8ba65')
      }
    }
  }
  v.box(15.75, 0.11, -4.45, 0.65, 0.2, 0.48, C.woodDark)
  for (let i = 0; i < 4; i += 1) v.box(15.53 + i * 0.15, 0.28, -4.45, 0.12, 0.2, 0.13, i % 2 ? C.coral : C.leafLight)
  v.box(11.46, 0.15, -4.55, 0.32, 0.3, 0.32, C.teal)
  v.box(11.36, 0.8, -4.53, 0.07, 1.3, 0.07, C.woodDark, { rz: -0.15 })
  v.box(11.28, 0.19, -4.53, 0.22, 0.3, 0.055, C.metal, { rz: -0.15 })
}

function gardenLife(v: Voxels): void {
  for (let i = 0; i < 16; i += 1) v.box(9.8, 0.04, -8.9 + i * 0.88, 0.9, 0.08, 0.72, i % 3 ? '#d2c5a6' : C.cream)
  for (let i = 0; i < 9; i += 1) v.box(9.9 + i * 0.86, 0.04, -3.25, 0.74, 0.08, 0.85, '#d2c5a6')
  for (let i = 0; i < 8; i += 1) v.box(9.9 + i * 0.86, 0.04, 3.8, 0.72, 0.08, 0.74, '#d2c5a6')
  for (let i = 0; i < 23; i += 1) v.box(-8.5 + i * 0.8, 0.04, -7.2, 0.64, 0.08, 0.63, '#d2c5a6')
  for (let flower = 0; flower < 15; flower += 1) {
    const x = -8.2 + flower * 0.55
    const z = -9.6
    v.box(x, 0.18, z, 0.045, 0.36, 0.045, C.leaf)
    v.box(x, 0.4, z, 0.19, 0.14, 0.19, [C.pink, '#e8c77d', '#acb7d1'][flower % 3]!)
    v.box(x + 0.08, 0.18, z, 0.16, 0.06, 0.12, C.leafLight, { rz: 0.2 })
  }
  for (const x of [-8.55, 0]) v.box(x, 0.18, -9.62, 0.08, 0.36, 0.6, C.wood)
  for (const z of [-9.93, -9.32]) v.box(-4.3, 0.18, z, 8.6, 0.36, 0.08, C.wood)
  broadleaf(v, 1.5, -8.9, 3.5)
  broadleaf(v, 7.9, -9.1, 3.4)
  v.box(5.3, 0.52, -8.5, 3.1, 0.16, 0.73, C.cream)
  v.box(5.3, 0.92, -8.88, 3.1, 0.71, 0.14, C.teal)
  for (const x of [3.85, 6.75]) v.box(x, 0.29, -8.53, 0.14, 0.58, 0.63, C.woodDark)
  v.box(5.3, 1.22, -9.48, 3.2, 2.44, 0.3, C.woodDark)
  for (let row = 0; row < 4; row += 1) {
    v.box(5.3, 0.43 + row * 0.52, -9.2, 3.2, 0.08, 0.56, C.woodLight)
    for (let book = 0; book < 14; book += 1) v.box(3.86 + book * 0.22, 0.69 + row * 0.52, -9.13, 0.12 + book % 2 * 0.04, 0.3 + book % 3 * 0.045, 0.25, [C.coral, C.teal, C.cream, '#b3a28b'][book % 4]!)
  }
  v.box(7.1, 0.35, -7.9, 0.1, 0.7, 0.1, C.woodDark)
  v.box(7.1, 0.74, -7.9, 0.65, 0.08, 0.65, C.cream)
  v.box(7.1, 0.87, -7.9, 0.14, 0.18, 0.14, C.coral)

  v.box(13.4, 0.012, 5.35, 6.95, 0.024, 3.1, '#b6af88')
  for (let i = 0; i < 12; i += 1) {
    const angle = i * Math.PI / 6
    v.box(13.3 + Math.cos(angle) * 0.56, 0.17, 5.18 + Math.sin(angle) * 0.48, 0.27, 0.29, 0.24, i % 3 ? '#a59e86' : '#c1bba3', { ry: angle })
  }
  for (const angle of [-0.6, 0.6]) v.box(13.3, 0.2, 5.18, 0.18, 0.17, 0.78, C.woodDark, { ry: angle })
  for (const [x, angle] of [[12, Math.PI * 0.75], [14.6, -Math.PI * 0.75]]) {
    v.box(x!, 0.5, 6, 0.72, 0.12, 0.65, C.coral, { ry: angle! })
    const behindX = x! - Math.sin(angle!) * 0.3
    const behindZ = 6 - Math.cos(angle!) * 0.3
    v.box(behindX, 0.9, behindZ, 0.7, 0.75, 0.12, C.cream, { ry: angle! })
    for (const side of [-0.25, 0.25]) v.box(x! + side, 0.25, 6, 0.06, 0.5, 0.6, C.woodDark)
  }
  for (let layer = 0; layer < 7; layer += 1) {
    const width = 1.8 - layer * 0.235
    v.box(16.4, 0.12 + layer * 0.24, 5.3, width, 0.245, 2.45, layer % 3 === 0 ? '#c59962' : '#d9b57e')
  }
  v.box(16.4, 0.65, 6.54, 0.69, 1.06, 0.025, C.woodDark)
  v.box(16.4, 0.08, 6.65, 0.8, 0.08, 0.3, C.cream)
  for (const x of [15.42, 17.35]) {
    v.box(x, 0.08, 6.5, 0.07, 0.16, 0.07, C.metal)
    v.box((x + 16.4) / 2, 0.6, 6.5, 0.025, 1.48, 0.025, C.white, { rz: x < 16 ? -0.7 : 0.7 })
  }
  v.box(10.6, 0.61, 5.02, 0.9, 0.43, 0.8, C.dark)
  for (const x of [10.25, 10.95]) v.box(x, 0.26, 5.02, 0.085, 0.52, 0.65, C.metal)
  for (let bar = 0; bar < 7; bar += 1) v.box(10.24 + bar * 0.12, 0.845, 5.02, 0.035, 0.035, 0.75, C.metal)
  for (let food = 0; food < 3; food += 1) v.box(10.34 + food * 0.25, 0.9, 5.01, 0.14, 0.08, 0.4, '#c38d67')
  v.box(10.1, 0.75, 5.6, 0.03, 0.5, 0.11, C.metal, { rz: -0.3 })
  v.box(11.15, 0.22, 5.8, 0.47, 0.44, 0.6, C.teal)
  v.box(11.15, 0.47, 5.8, 0.51, 0.08, 0.64, C.white)
  v.box(14.9, 0.1, 4.12, 1.1, 0.05, 0.6, C.pink)
  v.box(15.17, 0.17, 4.12, 0.26, 0.12, 0.57, C.cream)
  for (let i = 0; i < 13; i += 1) {
    const x = 9.8 + (i * 0.61 % 7.2)
    const z = i % 2 ? 6.8 : -9.7
    v.box(x, 0.1, z, 0.25, 0.17, 0.2, '#bbbc92')
    if (i % 3) v.box(x, 0.28, z, 0.13, 0.19, 0.12, C.leafLight)
  }
}

export function createIsland(stations: readonly Station[]): Island {
  const group = new Group()
  group.name = 'tideline-island'
  const upper = new Group()
  upper.name = 'terrace'
  const desks = new Group()
  desks.name = 'workstations'
  const lights = new Group()
  const ground = new Voxels()
  const deck = new Voxels()
  const work = new Voxels()
  const glazing = new Voxels()
  const workstations = stations.filter(station => station.activity === 'work')
  const west = Math.min(LAND.minX, ...workstations.map(station => station.position.x - 1.6))
  terrain(ground, west)
  pool(ground)
  clubhouse(ground, deck)
  beach(ground)
  office(work, workstations)
  courtyard(ground, glazing)
  gardenLife(ground)
  for (const tree of TREES) palm(ground, tree.x, tree.z, tree.height, tree.lean)
  if (west < LAND.minX) {
    work.box((west - 9.5) / 2, -0.05, -4.5, -9.5 - west, 0.1, 10.7, C.woodLight)
    for (let x = west + 0.3; x < -9.5; x += 0.35) work.box(x, 0.007, -4.5, 0.014, 0.014, 10.65, C.wood)
    railing(work, west + 0.1, -9.6, -9.6, -9.6, 0)
  }
  for (const [x, z] of [[-0.7, 5.8], [8.8, 1.6], [8.8, 2.6]]) planter(ground, x!, 0, z!, 0.66)
  for (let i = 0; i < 6; i += 1) {
    ground.box(-8.7 + i * 0.5, 0.11, -6.9, 0.35, 0.2, 0.25, C.leafLight)
    ground.box(-8.7 + i * 0.5, 0.28, -6.9, 0.12, 0.14, 0.12, i % 2 ? C.pink : '#efc46e')
  }
  const lamps = new Voxels()
  for (const [x, z] of [[0, 5.9], [8.5, 0.8], [-8.5, 5.9], [2.55, 1.2]]) {
    ground.box(x!, 0.56, z!, 0.065, 1.1, 0.065, C.dark)
    ground.box(x!, 1.2, z!, 0.34, 0.3, 0.34, C.dark)
    lamps.box(x!, 1.2, z! + 0.01, 0.26, 0.21, 0.35, '#ffe8a9')
    ground.box(x!, 1.38, z!, 0.42, 0.07, 0.42, C.dark)
  }
  for (let i = 0; i < 14; i += 1) {
    const x = -8.4 + i * 0.59
    const y = 2.98 - Math.sin(i / 13 * Math.PI) * 0.27
    ground.box(x, y + 0.03, -0.52, 0.61, 0.022, 0.025, C.woodDark)
    lamps.box(x, y - 0.065, -0.52, 0.09, 0.12, 0.09, '#ffe8a9')
  }
  lights.add(lamps.build('lanterns', new MeshBasicMaterial({ color: '#ffe1a0' })))
  ground.box(-11.7, -1.67, 9.45, 0.75, 0.03, 0.1, '#cfb693')
  ground.box(-11.7, -1.67, 9.45, 0.1, 0.03, 0.75, '#cfb693')
  group.add(ground.build('island-voxels'), upper, desks, lights)
  const greenhouse = glazing.build('greenhouse', new MeshBasicMaterial({ transparent: true, opacity: 0.13, depthWrite: false }))
  greenhouse.castShadow = false
  group.add(greenhouse)
  upper.add(deck.build('terrace-voxels'))
  desks.add(work.build('desk-voxels'))
  return { group, upper, desks, lights, minX: Math.min(TRAY.minX, west - 1.7), maxX: TRAY.maxX }
}
