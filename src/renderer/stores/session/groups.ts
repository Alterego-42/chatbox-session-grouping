import { arrayMove } from '@dnd-kit/sortable'
import type { SessionGroup, SessionMeta } from '@shared/types'
import * as chatStore from '../chatStore'
import * as groupStore from '../groupStore'
import { _copySession as copySession } from './crud'

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

export async function reorderChildGroups(parentId: string, oldIndex: number, newIndex: number): Promise<void> {
  await groupStore.updateGroupList((groups) => {
    const existing = groups ?? []
    const siblings = existing.filter((g) => g.parentId === parentId).sort((a, b) => a.sortIndex - b.sortIndex)
    if (oldIndex < 0 || newIndex < 0 || oldIndex >= siblings.length || newIndex >= siblings.length) {
      return existing
    }
    if (oldIndex === newIndex) return existing
    const reordered = arrayMove(siblings, oldIndex, newIndex)
    const newSortIndex = new Map<string, number>()
    reordered.forEach((g, i) => {
      newSortIndex.set(g.id, i)
    })
    const now = Date.now()
    return existing.map((g) =>
      newSortIndex.has(g.id) ? { ...g, sortIndex: newSortIndex.get(g.id) ?? g.sortIndex, updatedAt: now } : g
    )
  })
}

export async function duplicateGroup(groupId: string): Promise<SessionGroup> {
  const allGroups = await groupStore.listGroups()
  const source = allGroups.find((g) => g.id === groupId)
  if (!source) {
    throw new Error(`duplicateGroup: group "${groupId}" not found`)
  }

  const isRoot = source.parentId === null
  const childGroups = isRoot ? allGroups.filter((g) => g.parentId === source.id) : []
  const childGroupIds = new Set(childGroups.map((g) => g.id))

  const sessions = await chatStore.listSessionsMeta()
  const sessionsAtSource = sessions.filter((s) => s.groupId === source.id)
  const sessionsInChildren = sessions.filter((s) => s.groupId && childGroupIds.has(s.groupId))

  const newRoot = await groupStore.createGroup({
    name: `${source.name} (copy)`,
    parentId: source.parentId,
    color: source.color,
  })

  const oldChildIdToNewChildId = new Map<string, string>()
  for (const child of childGroups) {
    const created = await groupStore.createGroup({
      name: child.name,
      parentId: newRoot.id,
      color: child.color,
    })
    oldChildIdToNewChildId.set(child.id, created.id)
  }

  for (const s of sessionsAtSource) {
    const copied = await copySession(s)
    await moveSessionToGroup(copied.id, newRoot.id, undefined)
  }
  for (const s of sessionsInChildren) {
    const newChildId = s.groupId ? oldChildIdToNewChildId.get(s.groupId) : undefined
    if (!newChildId) continue
    const copied = await copySession(s)
    await moveSessionToGroup(copied.id, newChildId, undefined)
  }

  return newRoot
}
