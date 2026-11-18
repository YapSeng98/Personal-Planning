// A short message at the bottom of the screen (components/Toaster.tsx, one at
// a time, a new one replaces it): goals a finished task moved, or a note with
// an optional action (Undo).
import type { GoalMove } from './goals'

export type Toast =
  | { kind: 'goals'; moves: GoalMove[] }
  | { kind: 'note'; text: string; action?: { label: string; run: () => void } }

export const TOAST = 'planner:toast'

export const showToast = (toast: Toast) => window.dispatchEvent(new CustomEvent<Toast>(TOAST, { detail: toast }))
