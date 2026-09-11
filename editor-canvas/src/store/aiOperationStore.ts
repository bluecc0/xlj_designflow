import { create } from 'zustand'
import type { AIOperationState } from '../types'

interface AIOperationStore {
  state: AIOperationState
  claimOperation: (type: NonNullable<AIOperationState['type']>, message?: string) => boolean
  updateOperation: (patch: Partial<AIOperationState>) => void
  releaseOperation: () => void
}

const IDLE_STATE: AIOperationState = {
  type: null,
  status: 'idle',
}

export const useAIOperationStore = create<AIOperationStore>((set, get) => ({
  state: IDLE_STATE,

  claimOperation: (type, message) => {
    const current = get().state
    if (current.status === 'running') {
      return false
    }
    set({
      state: {
        type,
        status: 'running',
        progress: 0,
        message: message || '正在启动任务...',
      },
    })
    return true
  },

  updateOperation: (patch) => {
    set((s) => ({
      state: { ...s.state, ...patch },
    }))
  },

  releaseOperation: () => {
    set({ state: IDLE_STATE })
  },
}))
