import type { ProjectColor } from '../db/db'

// Amber is excluded — tokens.css documents it as decorative-only, never a
// data/identity mark, and a project color functionally identifies a project.
export const PROJECT_COLORS: ProjectColor[] = ['coral', 'green', 'blue', 'purple', 'teal', 'gray']

const VAR: Record<ProjectColor, string> = {
  coral: 'var(--accent)',
  green: 'var(--ok)',
  blue: 'var(--project-blue)',
  purple: 'var(--project-purple)',
  teal: 'var(--project-teal)',
  gray: 'var(--text-3)',
}

export function projectColorVar(color: ProjectColor): string {
  return VAR[color] ?? VAR.coral
}
