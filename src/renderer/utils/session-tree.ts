import type { SessionGroup, SessionMeta } from '@shared/types'
import { isSystemSession, sortSessions } from './session-utils'

export type FlatRow =
  | { kind: 'group'; id: string; group: SessionGroup; depth: number; childCount: number; expanded: boolean }
  | { kind: 'session'; id: string; session: SessionMeta; depth: number; groupId: string | null }
  | { kind: 'unassigned-root'; id: '__unassigned__'; depth: 0; childCount: number; expanded: boolean }

const UNASSIGNED_KEY = '__unassigned__'

function isExpanded(expanded: Record<string, boolean>, key: string): boolean {
  const v = expanded[key]
  return v === undefined ? true : v
}

function sortInGroup(sessions: SessionMeta[]): SessionMeta[] {
  const withIndex: SessionMeta[] = []
  const withoutIndex: SessionMeta[] = []
  for (const s of sessions) {
    if (typeof s.sortIndex === 'number') {
      withIndex.push(s)
    } else {
      withoutIndex.push(s)
    }
  }
  withIndex.sort((a, b) => (a.sortIndex ?? 0) - (b.sortIndex ?? 0))
  return [...withIndex, ...sortSessions(withoutIndex)]
}

export function buildFlatTree(
  groups: SessionGroup[],
  sessions: SessionMeta[],
  expanded: Record<string, boolean>
): FlatRow[] {
  const visibleSessions = sessions.filter((s) => !isSystemSession(s) && !s.hidden)
  const knownGroupIds = new Set(groups.map((g) => g.id))
  const sessionsByGroup = new Map<string, SessionMeta[]>()
  const unassigned: SessionMeta[] = []
  for (const s of visibleSessions) {
    if (s.groupId && knownGroupIds.has(s.groupId)) {
      const arr = sessionsByGroup.get(s.groupId) ?? []
      arr.push(s)
      sessionsByGroup.set(s.groupId, arr)
    } else {
      unassigned.push(s)
    }
  }

  const rows: FlatRow[] = []
  const groupById = new Map(groups.map((g) => [g.id, g]))
  const rootGroups: SessionGroup[] = []
  const childrenByParent = new Map<string, SessionGroup[]>()
  const orphanedAsRoot: SessionGroup[] = []
  for (const g of groups) {
    if (g.parentId === null) {
      rootGroups.push(g)
      continue
    }
    const parent = groupById.get(g.parentId)
    // Render orphans (parent missing) and depth-violators (parent is itself a child) at root.
    if (!parent || parent.parentId !== null) {
      orphanedAsRoot.push(g)
      continue
    }
    const arr = childrenByParent.get(g.parentId) ?? []
    arr.push(g)
    childrenByParent.set(g.parentId, arr)
  }

  const allRoots = [...rootGroups, ...orphanedAsRoot].sort((a, b) => a.sortIndex - b.sortIndex)

  const emitGroup = (g: SessionGroup, depth: number) => {
    const ownSessions = sessionsByGroup.get(g.id) ?? []
    const childGroups = (childrenByParent.get(g.id) ?? []).slice().sort((a, b) => a.sortIndex - b.sortIndex)
    const groupExpanded = isExpanded(expanded, g.id)
    const childCount = ownSessions.length + childGroups.length
    rows.push({
      kind: 'group',
      id: g.id,
      group: g,
      depth,
      childCount,
      expanded: groupExpanded,
    })
    if (!groupExpanded) return
    for (const s of sortInGroup(ownSessions)) {
      rows.push({ kind: 'session', id: s.id, session: s, depth: depth + 1, groupId: g.id })
    }
    for (const child of childGroups) {
      emitGroup(child, depth + 1)
    }
  }

  for (const g of allRoots) {
    emitGroup(g, 0)
  }

  const unassignedExpanded = isExpanded(expanded, UNASSIGNED_KEY)
  rows.push({
    kind: 'unassigned-root',
    id: UNASSIGNED_KEY,
    depth: 0,
    childCount: unassigned.length,
    expanded: unassignedExpanded,
  })
  if (unassignedExpanded) {
    for (const s of sortInGroup(unassigned)) {
      rows.push({ kind: 'session', id: s.id, session: s, depth: 1, groupId: null })
    }
  }

  return rows
}
