export interface Appearance { shirt: string; trim: string; skin: string; hair: string; trousers: string; hat: boolean; glasses: boolean }
const WARDROBE = [
  ['#eead53', '#f9df93', '#efbd92', '#49362e', '#334d5b'],
  ['#6b9ea5', '#c4e7dc', '#e9ae83', '#343a40', '#334a5b'],
  ['#d98577', '#f4c5ad', '#aa7152', '#2d2831', '#524553'],
  ['#7e91c5', '#d1d9f3', '#f1c9aa', '#735743', '#41485c'],
  ['#8eab7c', '#dce8b3', '#c18a65', '#493629', '#4b5351'],
  ['#c594b1', '#f0d6df', '#e6b9a0', '#372e43', '#424960'],
  ['#dcab69', '#f4e1b3', '#9d6c4c', '#2d2924', '#53645d'],
  ['#78a8ca', '#d7e9ef', '#eec5a5', '#a87844', '#3d5361'],
  ['#bd7768', '#f1c5a0', '#c18c6c', '#4a352e', '#4d515e'],
] as const

export function appearance(seat: number): Appearance {
  const index = ((seat + 1) % WARDROBE.length + WARDROBE.length) % WARDROBE.length
  const [shirt, trim, skin, hair, trousers] = WARDROBE[index]!
  return { shirt, trim, skin, hair, trousers, hat: index === 0 || index === 4 || index === 7, glasses: index === 1 || index === 5 }
}
