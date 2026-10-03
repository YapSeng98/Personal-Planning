// Sketch folders form a tree via parentId. A parent that's missing (deleted,
// or not synced yet) makes a folder top-level rather than invisible, and
// every walk up the tree is depth-capped so a cycle from bad data (two
// devices each moving a folder under the other) can't hang the UI.
import type { SketchFolder } from '../db/db'

const MAX_DEPTH = 32

/** Effective parent: undefined when the stored parent no longer exists. */
export function parentOf(f: SketchFolder, byId: Map<string, SketchFolder>): string | undefined {
  return f.parentId && byId.has(f.parentId) && f.parentId !== f.id ? f.parentId : undefined
}

/** Ancestors of `id`, root first, ending with the folder itself. */
export function folderPath(id: string, folders: SketchFolder[]): SketchFolder[] {
  const byId = new Map(folders.map((f) => [f.id, f]))
  const path: SketchFolder[] = []
  const seen = new Set<string>()
  let cur = byId.get(id)
  while (cur && !seen.has(cur.id) && path.length < MAX_DEPTH) {
    path.unshift(cur)
    seen.add(cur.id)
    const p = parentOf(cur, byId)
    cur = p ? byId.get(p) : undefined
  }
  return path
}

/** Direct children of `parentId` (undefined = top level), sorted by name. */
export function childFolders(parentId: string | undefined, folders: SketchFolder[]): SketchFolder[] {
  const byId = new Map(folders.map((f) => [f.id, f]))
  return folders
    .filter((f) => parentOf(f, byId) === parentId)
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** `id` plus everything nested under it. */
export function subtreeIds(id: string, folders: SketchFolder[]): Set<string> {
  const out = new Set([id])
  let grew = true
  while (grew) {
    grew = false
    for (const f of folders) {
      if (f.parentId && out.has(f.parentId) && !out.has(f.id)) {
        out.add(f.id)
        grew = true
      }
    }
  }
  return out
}

/** Every folder in tree order, labelled with its full path — for pickers.
    `exclude` drops a folder and its subtree (can't move a folder into itself). */
export function folderOptions(folders: SketchFolder[], exclude?: string): { value: string; label: string }[] {
  const skip = exclude ? subtreeIds(exclude, folders) : new Set<string>()
  const out: { value: string; label: string }[] = []
  const walk = (parentId: string | undefined, prefix: string, depth: number) => {
    if (depth > MAX_DEPTH) return
    for (const f of childFolders(parentId, folders)) {
      if (skip.has(f.id)) continue
      const label = prefix ? `${prefix} / ${f.name}` : f.name
      out.push({ value: f.id, label })
      walk(f.id, label, depth + 1)
    }
  }
  walk(undefined, '', 0)
  return out
}
