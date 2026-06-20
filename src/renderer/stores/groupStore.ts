import type { SessionGroup, UpdaterFn } from '@shared/types'
import { useQuery } from '@tanstack/react-query'
import { v4 as uuidv4 } from 'uuid'
import storage, { StorageKey } from '@/storage'
import { getLogger } from '../lib/utils'
import * as chatStore from './chatStore'
import queryClient from './queryClient'
import { UpdateQueue } from './updateQueue'

const log = getLogger('group-store')

const QueryKeys = {
  SessionGroupsList: ['session-groups-list'] as const,
}

async function _listGroups(): Promise<SessionGroup[]> {
  console.debug('groupStore', 'listGroups')
  try {
    const list = await storage.getItem<SessionGroup[]>(StorageKey.SessionGroupsList, [])
    return list
  } catch (error) {
    log.error(`Failed to read group list from storage (key: ${StorageKey.SessionGroupsList}):`, error)
    throw error
  }
}

const listGroupsQueryOptions = {
  queryKey: QueryKeys.SessionGroupsList,
  queryFn: () => _listGroups(),
  staleTime: Infinity,
}

export async function listGroups(): Promise<SessionGroup[]> {
  return await queryClient.fetchQuery(listGroupsQueryOptions)
}

export function useGroups(): { groups: SessionGroup[] | undefined; refetch: () => void } {
  const { data: groups, refetch } = useQuery({ ...listGroupsQueryOptions })
  return { groups, refetch: () => refetch() }
}

let groupListUpdateQueue: UpdateQueue<SessionGroup[]> | null = null

export async function updateGroupList(updater: UpdaterFn<SessionGroup[]>): Promise<void> {
  if (!groupListUpdateQueue) {
    groupListUpdateQueue = new UpdateQueue<SessionGroup[]>(
      () => _listGroups(),
      async (groups) => {
        await storage.setItemNow(StorageKey.SessionGroupsList, groups ?? [])
      }
    )
  }
  const result = await groupListUpdateQueue.set(updater)
  queryClient.setQueryData(QueryKeys.SessionGroupsList, result)
}

export async function createGroup(input: {
  name: string
  parentId?: string | null
  color?: string
}): Promise<SessionGroup> {
  const now = Date.now()
  const id = `group:${uuidv4()}`
  let created: SessionGroup | null = null
  let validationError: Error | null = null
  await updateGroupList((groups) => {
    const existing = groups ?? []
    const parentId = input.parentId ?? null
    if (parentId !== null) {
      const parent = existing.find((g) => g.id === parentId)
      if (!parent) {
        validationError = new Error(`createGroup: parentId "${parentId}" does not exist`)
        return existing
      }
      if (parent.parentId !== null) {
        validationError = new Error(`createGroup: parentId "${parentId}" is itself nested; only one level of nesting is allowed`)
        return existing
      }
    }
    const sortIndex = existing.length === 0 ? 0 : existing.reduce((acc, g) => Math.max(acc, g.sortIndex), 0) + 1
    created = {
      id,
      name: input.name,
      parentId,
      sortIndex,
      createdAt: now,
      updatedAt: now,
      ...(input.color !== undefined ? { color: input.color } : {}),
    }
    return [...existing, created]
  })
  if (validationError) {
    throw validationError
  }
  if (!created) {
    throw new Error('createGroup failed: group not created')
  }
  return created
}

export async function updateGroup(id: string, patch: Partial<Omit<SessionGroup, 'id' | 'createdAt'>>): Promise<void> {
  let validationError: Error | null = null
  await updateGroupList((groups) => {
    const existing = groups ?? []
    if ('parentId' in patch) {
      const target = existing.find((g) => g.id === id)
      if (!target) return existing
      const newParentId = patch.parentId ?? null
      if (newParentId !== null) {
        if (newParentId === id) {
          validationError = new Error(`updateGroup: cannot set parentId to self ("${id}")`)
          return existing
        }
        const parent = existing.find((g) => g.id === newParentId)
        if (!parent) {
          validationError = new Error(`updateGroup: parentId "${newParentId}" does not exist`)
          return existing
        }
        if (parent.parentId !== null) {
          validationError = new Error(
            `updateGroup: parentId "${newParentId}" is itself nested; only one level of nesting is allowed`
          )
          return existing
        }
        const hasChildren = existing.some((g) => g.parentId === id)
        if (hasChildren) {
          validationError = new Error(
            `updateGroup: group "${id}" still owns children; un-nest them before nesting this group`
          )
          return existing
        }
      }
    }
    return existing.map((g) =>
      g.id === id ? { ...g, ...patch, id: g.id, createdAt: g.createdAt, updatedAt: Date.now() } : g
    )
  })
  if (validationError) {
    throw validationError
  }
}

export async function deleteGroup(id: string): Promise<void> {
  // Step (a): clear groupId on all sessions that belong to this group (persist to the meta store)
  const metaStorage = await chatStore.getMetaStorage()
  const affected = (await chatStore.listSessionsMeta()).filter((s) => s.groupId === id)
  if (affected.length > 0) {
    await Promise.all(affected.map((s) => metaStorage.update(s.id, { groupId: undefined })))
    const affectedIds = new Set(affected.map((s) => s.id))
    chatStore.updateSessionListData((items) =>
      items.map((it) => (affectedIds.has(it.id) ? { ...it, groupId: undefined } : it))
    )
  }
  // Step (b): remove the group itself
  await updateGroupList((groups) => {
    const existing = groups ?? []
    return existing.filter((g) => g.id !== id)
  })
}
