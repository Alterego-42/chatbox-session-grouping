import { arrayMove } from '@dnd-kit/sortable'
import type { SessionMeta } from '@shared/types'
import * as chatStore from '../chatStore'
import * as groupStore from '../groupStore'

function groupKey(groupId: string | null | undefined): string | null {
  return groupId ?? null
}

export async function moveSessionToGroup(
  sessionId: string,
  targetGroupId: string | null,
  insertIndex?: number
): Promise<void> {
  await chatStore.updateSession(sessionId, (s) => ({
    ...s,
    groupId: targetGroupId === null ? undefined : targetGroupId,
    sortIndex: insertIndex,
  }))
}

export async function reorderWithinGroup(groupId: string | null, oldIndex: number, newIndex: number): Promise<void> {
  await chatStore.updateSessionList((sessions) => {
    const list = sessions ?? []
    const inGroup: SessionMeta[] = []
    for (const s of list) {
      if (groupKey(s.groupId) === groupId) {
        inGroup.push(s)
      }
    }
    inGroup.sort((a, b) => {
      const ai = a.sortIndex ?? Number.POSITIVE_INFINITY
      const bi = b.sortIndex ?? Number.POSITIVE_INFINITY
      return ai - bi
    })
    if (oldIndex < 0 || newIndex < 0 || oldIndex >= inGroup.length || newIndex >= inGroup.length) {
      return list
    }
    const reordered = arrayMove(inGroup, oldIndex, newIndex)
    const newSortIndex = new Map<string, number>()
    reordered.forEach((s, i) => {
      newSortIndex.set(s.id, i)
    })
    return list.map((s) => (newSortIndex.has(s.id) ? { ...s, sortIndex: newSortIndex.get(s.id) } : s))
  })
}

export async function reorderGroups(oldIndex: number, newIndex: number): Promise<void> {
  await groupStore.updateGroupList((groups) => {
    const existing = groups ?? []
    if (oldIndex < 0 || newIndex < 0 || oldIndex >= existing.length || newIndex >= existing.length) {
      return existing
    }
    const sorted = [...existing].sort((a, b) => a.sortIndex - b.sortIndex)
    const reordered = arrayMove(sorted, oldIndex, newIndex)
    return reordered.map((g, i) => ({ ...g, sortIndex: i, updatedAt: Date.now() }))
  })
}
