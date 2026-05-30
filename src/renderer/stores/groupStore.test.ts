import type { SessionGroup, SessionMeta, UpdaterFn } from '@shared/types'
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

const updateSessionListMock = vi.fn(async (updater: UpdaterFn<SessionMeta[]>) => {
  storageState.sessions = updater(storageState.sessions)
  await setItemNowSpy('chat-sessions-list', storageState.sessions)
})

vi.mock('./chatStore', () => ({
  updateSessionList: (updater: UpdaterFn<SessionMeta[]>) => updateSessionListMock(updater),
  listSessionsMeta: async () => storageState.sessions,
}))

async function importFresh() {
  vi.resetModules()
  return await import('./groupStore')
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
    updateSessionListMock.mockClear()
    updateSessionListMock.mockImplementation(async (updater: UpdaterFn<SessionMeta[]>) => {
      storageState.sessions = updater(storageState.sessions)
      await setItemNowSpy('chat-sessions-list', storageState.sessions)
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
    updateSessionListMock.mockImplementationOnce(async (updater: UpdaterFn<SessionMeta[]>) => {
      order.push('sessions')
      storageState.sessions = updater(storageState.sessions)
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
})
