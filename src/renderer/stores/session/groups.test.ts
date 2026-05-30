import type { SessionGroup, SessionMeta, UpdaterFn } from '@shared/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const storageState: { groups: SessionGroup[]; sessions: SessionMeta[] } = {
  groups: [],
  sessions: [],
}

vi.mock('@/storage', () => {
  const StorageKey = {
    SessionGroupsList: 'session-groups-list',
    ChatSessionsList: 'chat-sessions-list',
  }
  return {
    default: {
      getItem: vi.fn(async (key: string, initial: unknown) => {
        if (key === StorageKey.SessionGroupsList) return storageState.groups
        if (key === StorageKey.ChatSessionsList) return storageState.sessions
        return initial
      }),
      setItemNow: vi.fn(async (key: string, value: unknown) => {
        if (key === StorageKey.SessionGroupsList) storageState.groups = value as SessionGroup[]
        else if (key === StorageKey.ChatSessionsList) storageState.sessions = value as SessionMeta[]
      }),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      getAllKeys: vi.fn(async () => []),
    },
    StorageKey,
  }
})

vi.mock('@/router', () => ({ router: { navigate: vi.fn() } }))

vi.mock('../../lib/utils', () => ({
  getLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
}))

const updateSessionListMock = vi.fn(async (updater: UpdaterFn<SessionMeta[]>) => {
  storageState.sessions = updater(storageState.sessions)
})

vi.mock('../chatStore', () => ({
  updateSessionList: (updater: UpdaterFn<SessionMeta[]>) => updateSessionListMock(updater),
  listSessionsMeta: async () => storageState.sessions,
}))

const updateGroupListMock = vi.fn(async (updater: UpdaterFn<SessionGroup[]>) => {
  storageState.groups = updater(storageState.groups)
})

vi.mock('../groupStore', () => ({
  updateGroupList: (updater: UpdaterFn<SessionGroup[]>) => updateGroupListMock(updater),
  listGroups: async () => storageState.groups,
}))

async function importFresh() {
  vi.resetModules()
  return await import('./groups')
}

describe('session/groups', () => {
  beforeEach(() => {
    storageState.groups = []
    storageState.sessions = []
    updateSessionListMock.mockClear()
    updateSessionListMock.mockImplementation(async (updater: UpdaterFn<SessionMeta[]>) => {
      storageState.sessions = updater(storageState.sessions)
    })
    updateGroupListMock.mockClear()
    updateGroupListMock.mockImplementation(async (updater: UpdaterFn<SessionGroup[]>) => {
      storageState.groups = updater(storageState.groups)
    })
  })

  it('moveSessionToGroup(id, null) clears groupId and sortIndex', async () => {
    const mod = await importFresh()
    storageState.sessions = [
      { id: 's1', name: 's1', groupId: 'group:x', sortIndex: 7 } as SessionMeta,
      { id: 's2', name: 's2' } as SessionMeta,
    ]
    await mod.moveSessionToGroup('s1', null)
    const s1 = storageState.sessions.find((s) => s.id === 's1')
    expect(s1?.groupId).toBeUndefined()
    expect(s1?.sortIndex).toBeUndefined()
  })

  it('moveSessionToGroup(id, "group:x", 2) sets groupId and sortIndex', async () => {
    const mod = await importFresh()
    storageState.sessions = [{ id: 's1', name: 's1' } as SessionMeta]
    await mod.moveSessionToGroup('s1', 'group:x', 2)
    const s1 = storageState.sessions.find((s) => s.id === 's1')
    expect(s1?.groupId).toBe('group:x')
    expect(s1?.sortIndex).toBe(2)
  })

  it('reorderWithinGroup only reassigns sortIndex for target-group sessions', async () => {
    const mod = await importFresh()
    storageState.sessions = [
      { id: 'a1', name: 'a1', groupId: 'group:a', sortIndex: 0 } as SessionMeta,
      { id: 'a2', name: 'a2', groupId: 'group:a', sortIndex: 1 } as SessionMeta,
      { id: 'a3', name: 'a3', groupId: 'group:a', sortIndex: 2 } as SessionMeta,
      { id: 'b1', name: 'b1', groupId: 'group:b', sortIndex: 5 } as SessionMeta,
      { id: 'n1', name: 'n1', sortIndex: 99 } as SessionMeta,
    ]
    // move a1 from index 0 to index 2 in group:a -> order becomes [a2, a3, a1]
    await mod.reorderWithinGroup('group:a', 0, 2)
    const byId = Object.fromEntries(storageState.sessions.map((s) => [s.id, s]))
    expect(byId.a2.sortIndex).toBe(0)
    expect(byId.a3.sortIndex).toBe(1)
    expect(byId.a1.sortIndex).toBe(2)
    // untouched groups/sessions
    expect(byId.b1.sortIndex).toBe(5)
    expect(byId.n1.sortIndex).toBe(99)
  })

  it('reorderGroups applies arrayMove and renumbers sortIndex from 0', async () => {
    const mod = await importFresh()
    storageState.groups = [
      { id: 'group:a', name: 'a', parentId: null, sortIndex: 0, createdAt: 1, updatedAt: 1 },
      { id: 'group:b', name: 'b', parentId: null, sortIndex: 1, createdAt: 2, updatedAt: 2 },
      { id: 'group:c', name: 'c', parentId: null, sortIndex: 2, createdAt: 3, updatedAt: 3 },
    ]
    // move 'c' (index 2) to index 0 -> order becomes [c, a, b]
    await mod.reorderGroups(2, 0)
    const sorted = [...storageState.groups].sort((a, b) => a.sortIndex - b.sortIndex)
    expect(sorted.map((g) => g.id)).toEqual(['group:c', 'group:a', 'group:b'])
    expect(sorted.map((g) => g.sortIndex)).toEqual([0, 1, 2])
  })
})
