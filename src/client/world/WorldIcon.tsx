export type WorldIconName = 'island' | 'sun' | 'moon' | 'pool' | 'sea' | 'run' | 'snack' | 'lookout' | 'relax' | 'work' | 'pause' | 'play' | 'resume' | 'garden' | 'camp' | 'read' | 'reset' | 'plus' | 'minus' | 'left' | 'right' | 'close' | 'expand' | 'map' | 'stairs' | 'elevator' | 'arrow' | 'layers' | 'ground' | 'terrace' | 'speed'

const paths: Record<WorldIconName, string> = {
  island: 'm3 14 9-5 9 5-9 5-9-5Zm0 0v4l9 5 9-5v-4M12 9V2m-5 4 5-4 5 4M8 9l4-7 4 7',
  sun: 'M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5M16.5 12a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0Z',
  moon: 'M20 14A8 8 0 0 1 10 4 8.5 8.5 0 1 0 20 14Z',
  pool: 'M3 18q2-2 4 0t4 0 4 0 4 0 3 0M3 21q2-2 4 0t4 0 4 0 4 0 3 0M7 16V5a2 2 0 0 1 4 0m3 11V5a2 2 0 0 1 4 0M7 8h7m-7 4h7',
  sea: 'M2 10q3-3 6 0t6 0 6 0M2 15q3-3 6 0t6 0 6 0M2 20q3-3 6 0t6 0 6 0M15 4h4m-2-2v4',
  run: 'M16 5a2 2 0 1 1-4 0 2 2 0 0 1 4 0ZM4 11l5-3 5 2 4 3h3M10 9l-1 6 5 2-1 5M9 15l-3 5H2',
  snack: 'M4 10h13v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5v-5Zm13 1h2a3 3 0 0 1 0 6h-2M7 3v3m4-3v3m4-3v3M2 22h18',
  lookout: 'm3 11 13-7 3 5-13 7-3-5Zm13-7 3-2 3 5-3 2M12 13v9m0-6-5 6m5-6 5 6',
  relax: 'M4 11V7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v4M4 11a2 2 0 0 0-2 2v6h20v-6a2 2 0 0 0-4 0v2H6v-2a2 2 0 0 0-2-2ZM4 19v3m16-3v3',
  work: 'M3 4h18v12H3V4Zm6 16h6m-3-4v4M1 22h22',
  pause: 'M7 5h3v14H7V5Zm7 0h3v14h-3V5Z',
  resume: 'm7 4 13 8-13 8V4Z',
  play: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM6 5l12 14M3 11l18 2M11 3q-6 12 5 17M17 4q0 8-10 15',
  garden: 'M12 22V11m0 5C3 16 3 10 3 7c8 0 9 6 9 9Zm0-5c0-8 4-9 9-9 0 6-2 9-9 9Z',
  camp: 'm2 21 10-18 10 18H2Zm6 0 4-8 4 8M12 3V1',
  read: 'M12 6Q7 2 2 4v16q5-2 10 2 5-4 10-2V4q-5-2-10 2Zm0 0v16',
  layers: 'm2 8 10-5 10 5-10 5L2 8Zm0 5 10 5 10-5M2 18l10 5 10-5',
  ground: 'm2 14 10-5 10 5-10 5-10-5Zm0 0v5l10 4 10-4v-5',
  terrace: 'm2 7 10-5 10 5-10 5L2 7Zm0 0v11l10 5 10-5V7M12 12v11M2 13l10 5 10-5',
  speed: 'm3 6 8 6-8 6V6Zm10 0 8 6-8 6V6Z',
  reset: 'M3 10a9 9 0 1 1 2 9M3 4v6h6',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  left: 'm15 5-7 7 7 7',
  right: 'm9 5 7 7-7 7',
  close: 'm6 6 12 12M18 6 6 18',
  expand: 'M3 9V3h6m6 0h6v6M3 15v6h6m6 0h6v-6',
  map: 'm3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2V5Zm6-2v16m6-14v16',
  stairs: 'M2 20h5v-5h5v-5h5V5h5M3 10l9-8M7 2h5v5',
  elevator: 'M4 2h16v20H4V2Zm8 5v10m-3-7 3-3 3 3m-6 4 3 3 3-3',
  arrow: 'M4 12h16m-6-6 6 6-6 6',
}

export function WorldIcon({ name, size = 18 }: { readonly name: WorldIconName; readonly size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={paths[name]} /></svg>
}
