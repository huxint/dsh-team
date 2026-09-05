import { createContext, useContext, useSyncExternalStore } from 'react'
import type { Stagecraft } from '../stagecraft.ts'

export const StageContext = createContext<Stagecraft | undefined>(undefined)

export function useStagecraft(): Stagecraft {
  const stage = useContext(StageContext)
  if (stage === undefined) throw new Error('Crew must be mounted inside the room')
  return stage
}

export function useRoomActivity(): { visible: boolean, reducedMotion: boolean } {
  const stage = useStagecraft()
  const activity = useSyncExternalStore(stage.subscribeActivity, stage.getActivity, stage.getActivity)
  return { visible: activity !== 'hidden', reducedMotion: activity === 'still' }
}
