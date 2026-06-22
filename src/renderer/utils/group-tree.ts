import type { SessionGroup } from '@shared/types'

export interface GroupTreeNode {
  group: SessionGroup
  depth: number // 1-based: root groups are depth 1
  children: GroupTreeNode[]
}

/**
 * Build a nested tree from the flat group list, sorted by sortIndex at each level.
 * Orphaned groups (parentId points to a missing group) are promoted to the root so they stay visible.
 */
export function buildGroupTree(groups: SessionGroup[]): GroupTreeNode[] {
  const ids = new Set(groups.map((g) => g.id))
  const byParent = new Map<string | null, SessionGroup[]>()
  for (const g of groups) {
    const key = g.parentId && ids.has(g.parentId) ? g.parentId : null
    const arr = byParent.get(key) ?? []
    arr.push(g)
    byParent.set(key, arr)
  }
  const build = (parentId: string | null, depth: number): GroupTreeNode[] =>
    (byParent.get(parentId) ?? [])
      .slice()
      .sort((a, b) => a.sortIndex - b.sortIndex)
      .map((group) => ({ group, depth, children: build(group.id, depth + 1) }))
  return build(null, 1)
}

/**
 * Path from the root down to (and including) the group with `id`, for breadcrumbs.
 * Returns [] for null/unknown ids. Cycle- and orphan-safe.
 */
export function getGroupPath(groups: SessionGroup[], id: string | null): SessionGroup[] {
  if (id === null) return []
  const byId = new Map(groups.map((g) => [g.id, g]))
  const path: SessionGroup[] = []
  const seen = new Set<string>()
  let current = byId.get(id)
  while (current && !seen.has(current.id)) {
    seen.add(current.id)
    path.unshift(current)
    current = current.parentId ? byId.get(current.parentId) : undefined
  }
  return path
}
