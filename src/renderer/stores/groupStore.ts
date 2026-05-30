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

export async function createGroup(input: { name: string; parentId?: string | null }): Promise<SessionGroup> {
  const now = Date.now()
  const id = `group:${uuidv4()}`
  let created: SessionGroup | null = null
  await updateGroupList((groups) => {
    const existing = groups ?? []
    const sortIndex = existing.length === 0 ? 0 : existing.reduce((acc, g) => Math.max(acc, g.sortIndex), 0) + 1
    created = {
      id,
      name: input.name,
      parentId: input.parentId ?? null,
      sortIndex,
      createdAt: now,
      updatedAt: now,
    }
    return [...existing, created]
  })
  if (!created) {
    throw new Error('createGroup failed: group not created')
  }
  return created
}

export async function updateGroup(id: string, patch: Partial<Omit<SessionGroup, 'id' | 'createdAt'>>): Promise<void> {
  await updateGroupList((groups) => {
    const existing = groups ?? []
    return existing.map((g) =>
      g.id === id ? { ...g, ...patch, id: g.id, createdAt: g.createdAt, updatedAt: Date.now() } : g
    )
  })
}

export async function deleteGroup(id: string): Promise<void> {
  // Step (a): clear groupId on all sessions that belong to this group
  await chatStore.updateSessionList((sessions) => {
    const list = sessions ?? []
    return list.map((s) => (s.groupId === id ? { ...s, groupId: undefined } : s))
  })
  // Step (b): remove the group itself
  await updateGroupList((groups) => {
    const existing = groups ?? []
    return existing.filter((g) => g.id !== id)
  })
}
