import type { SessionGroup, SessionMeta } from '@shared/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const storageState: { groups: SessionGroup[]; sessions: SessionMeta[] } = {
  groups: [],
  sessions: [],
}
const setItemNowSpy = vi.fn(async (key: string, value: unknown) => {
  if (key === 'session-groups-list') {
    storageState.groups = value as SessionGroup[]
  } else if (key === 'chat-sessions-list') {
    storageState.sessions = value as SessionMeta[]
  }
})

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
      setItemNow: setItemNowSpy,
      setItem: vi.fn(),
      removeItem: vi.fn(),
      getAllKeys: vi.fn(async () => []),
    },
    StorageKey,
  }
})

vi.mock('@/router', () => ({ router: { navigate: vi.fn() } }))

vi.mock('../lib/utils', () => ({
  getLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
}))

const metaStorageMock = {
  update: vi.fn(async (id: string, patch: Partial<SessionMeta>) => {
    storageState.sessions = storageState.sessions.map((s) => (s.id === id ? { ...s, ...patch } : s))
    return storageState.sessions.find((s) => s.id === id) ?? null
  }),
}
const updateSessionListDataMock = vi.fn((updater: (items: SessionMeta[]) => SessionMeta[]) => {
  storageState.sessions = updater(storageState.sessions)
})

vi.mock('./chatStore', () => ({
  listSessionsMeta: async () => storageState.sessions,
  getMetaStorage: async () => metaStorageMock,
  updateSessionListData: (updater: (items: SessionMeta[]) => SessionMeta[]) => updateSessionListDataMock(updater),
}))

async function importFresh() {
  vi.resetModules()
  return await import('./groupStore.js')
}

describe('groupStore', () => {
  beforeEach(() => {
    storageState.groups = []
    storageState.sessions = []
    setItemNowSpy.mockClear()
    setItemNowSpy.mockImplementation(async (key: string, value: unknown) => {
      if (key === 'session-groups-list') {
        storageState.groups = value as SessionGroup[]
      } else if (key === 'chat-sessions-list') {
        storageState.sessions = value as SessionMeta[]
      }
    })
    metaStorageMock.update.mockClear()
    metaStorageMock.update.mockImplementation(async (id: string, patch: Partial<SessionMeta>) => {
      storageState.sessions = storageState.sessions.map((s) => (s.id === id ? { ...s, ...patch } : s))
      return storageState.sessions.find((s) => s.id === id) ?? null
    })
    updateSessionListDataMock.mockClear()
    updateSessionListDataMock.mockImplementation((updater: (items: SessionMeta[]) => SessionMeta[]) => {
      storageState.sessions = updater(storageState.sessions)
    })
  })

  it('createGroup appends with auto-incrementing sortIndex and group:* id', async () => {
    const mod = await importFresh()

    const a = await mod.createGroup({ name: 'A' })
    expect(a.id).toMatch(/^group:/)
    expect(a.sortIndex).toBe(0)
    expect(a.parentId).toBe(null)
    expect(a.createdAt).toBeGreaterThan(0)
    expect(a.updatedAt).toBe(a.createdAt)

    const b = await mod.createGroup({ name: 'B' })
    expect(b.sortIndex).toBe(1)

    const c = await mod.createGroup({ name: 'C' })
    expect(c.sortIndex).toBe(2)

    expect(storageState.groups.map((g) => g.name)).toEqual(['A', 'B', 'C'])
  })

  it('updateGroup bumps updatedAt and preserves id/createdAt', async () => {
    const mod = await importFresh()
    const created = await mod.createGroup({ name: 'A' })
    const originalCreatedAt = created.createdAt
    const originalUpdatedAt = created.updatedAt

    await new Promise((r) => setTimeout(r, 5))
    await mod.updateGroup(created.id, { name: 'A2', color: '#fff' })

    const after = storageState.groups.find((g) => g.id === created.id)
    expect(after).toBeDefined()
    expect(after?.id).toBe(created.id)
    expect(after?.createdAt).toBe(originalCreatedAt)
    expect(after?.name).toBe('A2')
    expect(after?.color).toBe('#fff')
    expect(after?.updatedAt).toBeGreaterThan(originalUpdatedAt)
  })

  it('deleteGroup clears session.groupId before removing the group (order matters)', async () => {
    const mod = await importFresh()
    const g = await mod.createGroup({ name: 'A' })
    storageState.sessions = [
      { id: 's1', name: 's1', groupId: g.id } as SessionMeta,
      { id: 's2', name: 's2', groupId: g.id } as SessionMeta,
      { id: 's3', name: 's3' } as SessionMeta,
    ]

    const order: string[] = []
    metaStorageMock.update.mockImplementation(async (id: string, patch: Partial<SessionMeta>) => {
      if (!order.includes('sessions')) order.push('sessions')
      storageState.sessions = storageState.sessions.map((s) => (s.id === id ? { ...s, ...patch } : s))
      return storageState.sessions.find((s) => s.id === id) ?? null
    })
    setItemNowSpy.mockImplementation(async (key: string, value: unknown) => {
      if (key === 'session-groups-list') {
        order.push('groups')
        storageState.groups = value as SessionGroup[]
      } else if (key === 'chat-sessions-list') {
        storageState.sessions = value as SessionMeta[]
      }
    })

    await mod.deleteGroup(g.id)

    expect(order[0]).toBe('sessions')
    expect(order.indexOf('groups')).toBeGreaterThan(order.indexOf('sessions'))
    expect(storageState.sessions.find((s) => s.id === 's1')?.groupId).toBeUndefined()
    expect(storageState.sessions.find((s) => s.id === 's2')?.groupId).toBeUndefined()
    expect(storageState.groups.find((x) => x.id === g.id)).toBeUndefined()
  })

  it('createGroup rejects parentId pointing to a non-root group', async () => {
    const mod = await importFresh()
    const root = await mod.createGroup({ name: 'root' })
    const child = await mod.createGroup({ name: 'child', parentId: root.id })
    await expect(mod.createGroup({ name: 'grand', parentId: child.id })).rejects.toThrow(/only one level/)
  })

  it('updateGroup rejects parentId === id (self-loop)', async () => {
    const mod = await importFresh()
    const g = await mod.createGroup({ name: 'A' })
    await expect(mod.updateGroup(g.id, { parentId: g.id })).rejects.toThrow(/cannot set parentId to self/)
  })

  it('updateGroup rejects parentId pointing to a non-root group', async () => {
    const mod = await importFresh()
    const root = await mod.createGroup({ name: 'root' })
    const child = await mod.createGroup({ name: 'child', parentId: root.id })
    const other = await mod.createGroup({ name: 'other' })
    await expect(mod.updateGroup(other.id, { parentId: child.id })).rejects.toThrow(/only one level/)
  })

  it('updateGroup rejects nesting a group that still owns children', async () => {
    const mod = await importFresh()
    const a = await mod.createGroup({ name: 'A' })
    const b = await mod.createGroup({ name: 'B' })
    await mod.createGroup({ name: 'A-child', parentId: a.id })
    await expect(mod.updateGroup(a.id, { parentId: b.id })).rejects.toThrow(/still owns children/)
  })

  it('updateGroup happy path: reparent a leaf root under another root, then un-nest', async () => {
    const mod = await importFresh()
    const a = await mod.createGroup({ name: 'A' })
    const b = await mod.createGroup({ name: 'B' })
    await mod.updateGroup(a.id, { parentId: b.id })
    expect(storageState.groups.find((g) => g.id === a.id)?.parentId).toBe(b.id)
    await mod.updateGroup(a.id, { parentId: null })
    expect(storageState.groups.find((g) => g.id === a.id)?.parentId).toBe(null)
  })
})
