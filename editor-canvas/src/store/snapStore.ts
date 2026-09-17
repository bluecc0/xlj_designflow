import { create } from 'zustand'
import type { SnapLine } from '../utils/snapping'

interface SnapState {
  snapLines: SnapLine[]
  setSnapLines: (lines: SnapLine[]) => void
  clearSnapLines: () => void
}

export const useSnapStore = create<SnapState>((set) => ({
  snapLines: [],
  setSnapLines: (lines) => set({ snapLines: lines }),
  clearSnapLines: () => set({ snapLines: [] }),
}))
