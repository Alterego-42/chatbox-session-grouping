import type { SessionGroup, SessionMeta } from '@shared/types'

export type DragEndAction =
  | { kind: 'noop' }
  | { kind: 'reorder-within-group'; groupId: string | null; oldIndex: number; newIndex: number }
  | { kind: 'move-session-to-group'; sessionId: string; targetGroupId: string | null; insertIndex: number | undefined }
  | { kind: 'reorder-groups'; oldIndex: number; newIndex: number }
  | { kind: 'reparent-group'; groupId: string; newParentId: string | null; insertIndex: number | undefined }

export type DropPosition = 'before' | 'after' | 'inside'

interface DragNode {
  id: string | number
  data?: { current?: { type?: string; groupId?: string | null } | undefined } | undefined
}

interface RouteInput {
  active: DragNode
  over: DragNode | null
  overPosition?: DropPosition
  sessions: SessionMeta[]
  groups: SessionGroup[]
}

function groupKey(groupId: string | null | undefined): string | null {
  return groupId ?? null
}

function sessionsInGroupSorted(sessions: SessionMeta[], groupId: string | null): SessionMeta[] {
  const inGroup = sessions.filter((s) => groupKey(s.groupId) === groupId)
  inGroup.sort((a, b) => {
    const ai = a.sortIndex ?? Number.POSITIVE_INFINITY
    const bi = b.sortIndex ?? Number.POSITIVE_INFINITY
    return ai - bi
  })
  return inGroup
}

export function routeDragEnd({ active, over, overPosition = 'after', sessions, groups }: RouteInput): DragEndAction {
  if (!over) return { kind: 'noop' }
  const activeId = String(active.id)
  const overId = String(over.id)
  if (activeId === overId) return { kind: 'noop' }

  const activeType = active.data?.current?.type
  const overType = over.data?.current?.type

  if (activeType === 'group' && overType === 'group') {
    const activeGroup = groups.find((g) => g.id === activeId)
    const overGroup = groups.find((g) => g.id === overId)
    if (!activeGroup || !overGroup) return { kind: 'noop' }

    const activeIsRoot = activeGroup.parentId === null
    const overIsRoot = overGroup.parentId === null
    const activeHasChildren = activeIsRoot && groups.some((g) => g.parentId === activeGroup.id)

    if (overPosition === 'inside') {
      // Reject moves that would create depth > 1 or a self-loop.
      if (activeId === overId) return { kind: 'noop' }
      if (activeHasChildren) return { kind: 'noop' }
      if (!overIsRoot) return { kind: 'noop' }
      return { kind: 'reparent-group', groupId: activeId, newParentId: overId, insertIndex: undefined }
    }

    // before / after
    if (activeIsRoot && overIsRoot) {
      const sortedRoots = groups.filter((g) => g.parentId === null).sort((a, b) => a.sortIndex - b.sortIndex)
      const oldIndex = sortedRoots.findIndex((g) => g.id === activeId)
      const overIndex = sortedRoots.findIndex((g) => g.id === overId)
      if (oldIndex < 0 || overIndex < 0) return { kind: 'noop' }
      let newIndex = overPosition === 'before' ? overIndex : overIndex + 1
      if (oldIndex < newIndex) newIndex -= 1
      if (newIndex < 0) newIndex = 0
      if (newIndex > sortedRoots.length - 1) newIndex = sortedRoots.length - 1
      if (oldIndex === newIndex) return { kind: 'noop' }
      return { kind: 'reorder-groups', oldIndex, newIndex }
    }

    if (!activeIsRoot && overIsRoot) {
      // Un-nest active and place it among the roots relative to overGroup.
      const sortedRoots = groups.filter((g) => g.parentId === null).sort((a, b) => a.sortIndex - b.sortIndex)
      const overIndex = sortedRoots.findIndex((g) => g.id === overId)
      if (overIndex < 0) return { kind: 'noop' }
      const insertIndex = overPosition === 'before' ? overIndex : overIndex + 1
      return { kind: 'reparent-group', groupId: activeId, newParentId: null, insertIndex }
    }

    if (!overIsRoot) {
      // overGroup is a child; sibling-reorder if same parent, otherwise reparent under overGroup's parent.
      const newParentId = overGroup.parentId
      if (activeHasChildren) return { kind: 'noop' }
      const siblings = groups
        .filter((g) => g.parentId === newParentId)
        .sort((a, b) => a.sortIndex - b.sortIndex)
      const overIndex = siblings.findIndex((g) => g.id === overId)
      if (overIndex < 0) return { kind: 'noop' }
      let insertIndex = overPosition === 'before' ? overIndex : overIndex + 1
      const oldIndex = siblings.findIndex((g) => g.id === activeId)
      if (oldIndex >= 0 && oldIndex < insertIndex) insertIndex -= 1
      return { kind: 'reparent-group', groupId: activeId, newParentId, insertIndex }
    }

    return { kind: 'noop' }
  }

  if (activeType !== 'session') return { kind: 'noop' }

  const activeSession = sessions.find((s) => s.id === activeId)
  if (!activeSession) return { kind: 'noop' }
  const activeGroupId = groupKey(activeSession.groupId)

  if (overType === 'group') {
    const targetGroupId = over.data?.current?.groupId ?? null
    // For session-on-group, before/after fall through to inside — the row itself
    // represents the bucket and users expect the session to land in it.
    if (activeGroupId === targetGroupId) return { kind: 'noop' }
    return {
      kind: 'move-session-to-group',
      sessionId: activeId,
      targetGroupId,
      insertIndex: undefined,
    }
  }

  // over is a session row
  const overSession = sessions.find((s) => s.id === overId)
  if (!overSession) return { kind: 'noop' }
  const targetGroupId = groupKey(overSession.groupId)
  const inTarget = sessionsInGroupSorted(sessions, targetGroupId)
  const overIdxInGroup = inTarget.findIndex((s) => s.id === overId)
  if (overIdxInGroup < 0) return { kind: 'noop' }

  if (activeGroupId === targetGroupId) {
    const oldIndex = inTarget.findIndex((s) => s.id === activeId)
    if (oldIndex < 0) return { kind: 'noop' }
    let newIndex = overPosition === 'before' ? overIdxInGroup : overIdxInGroup + 1
    if (oldIndex < newIndex) newIndex -= 1
    if (newIndex < 0) newIndex = 0
    if (newIndex > inTarget.length - 1) newIndex = inTarget.length - 1
    if (oldIndex === newIndex) return { kind: 'noop' }
    return { kind: 'reorder-within-group', groupId: targetGroupId, oldIndex, newIndex }
  }

  const insertIndex = overPosition === 'before' ? overIdxInGroup : overIdxInGroup + 1
  return {
    kind: 'move-session-to-group',
    sessionId: activeId,
    targetGroupId,
    insertIndex,
  }
}
