import 'fake-indexeddb/auto'
import type { SessionMetaRecord } from '@shared/types'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { IndexedDBSessionMetaStorage } from '../SessionMetaStorage'

const DB_NAME = 'chatbox-session-meta'

function deleteDb(): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
    req.onblocked = () => resolve()
  })
}

function rec(
  id: string,
  sortOrder: number,
  groupId?: string,
  extra: Partial<SessionMetaRecord> = {}
): SessionMetaRecord {
  return { id, name: id, sortOrder, createdAt: sortOrder, groupId, ...extra }
}

describe('IndexedDBSessionMetaStorage — group-filtered pagination', () => {
  let store: IndexedDBSessionMetaStorage
  beforeEach(async () => {
    await deleteDb()
    store = new IndexedDBSessionMetaStorage()
    await store.initialize()
  })
  afterEach(() => {
    ;(store as unknown as { db: IDBDatabase | null }).db?.close()
  })

  it('returns only the requested group, newest sortOrder first, paging via keyset cursor', async () => {
    await store.createMany([
      rec('a3', 100, 'group:A'),
      rec('a2', 90, 'group:A'),
      rec('a1', 80, 'group:A'),
      rec('b1', 95, 'group:B'),
      rec('u1', 70),
    ])

    const p1 = await store.getPageByGroup('group:A', null, 2)
    expect(p1.items.map((r) => r.id)).toEqual(['a3', 'a2'])
    expect(p1.total).toBe(3)
    expect(p1.nextCursor).toEqual({ pinned: false, sortOrder: 90 })

    const p2 = await store.getPageByGroup('group:A', p1.nextCursor, 2)
    expect(p2.items.map((r) => r.id)).toEqual(['a1'])
    expect(p2.nextCursor).toBeNull()
  })

  it('floats pinned sessions to the top of the group and pages across the pin boundary', async () => {
    await store.createMany([
      rec('n3', 300, 'group:A'),
      rec('p1', 250, 'group:A', { starred: true }),
      rec('n2', 200, 'group:A'),
      rec('p2', 150, 'group:A', { starred: true }),
      rec('n1', 100, 'group:A'),
      rec('other', 999, 'group:B', { starred: true }),
    ])

    const p1 = await store.getPageByGroup('group:A', null, 3)
    expect(p1.items.map((r) => r.id)).toEqual(['p1', 'p2', 'n3'])
    expect(p1.total).toBe(5)
    expect(p1.nextCursor).toEqual({ pinned: false, sortOrder: 300 })

    const p2 = await store.getPageByGroup('group:A', p1.nextCursor, 3)
    expect(p2.items.map((r) => r.id)).toEqual(['n2', 'n1'])
    expect(p2.nextCursor).toBeNull()
  })

  it('keeps paging inside the pinned run while it still has more than a page', async () => {
    await store.createMany([
      rec('p3', 300, 'group:A', { starred: true }),
      rec('p2', 200, 'group:A', { starred: true }),
      rec('p1', 100, 'group:A', { starred: true }),
      rec('n1', 50, 'group:A'),
    ])

    const p1 = await store.getPageByGroup('group:A', null, 2)
    expect(p1.items.map((r) => r.id)).toEqual(['p3', 'p2'])
    expect(p1.nextCursor).toEqual({ pinned: true, sortOrder: 200 })

    const p2 = await store.getPageByGroup('group:A', p1.nextCursor, 2)
    expect(p2.items.map((r) => r.id)).toEqual(['p1', 'n1'])
    expect(p2.nextCursor).toBeNull()
  })

  it('rolls over to the unpinned run when a page is filled exactly by pinned sessions', async () => {
    await store.createMany([
      rec('p2', 200, 'group:A', { starred: true }),
      rec('p1', 100, 'group:A', { starred: true }),
      rec('n1', 50, 'group:A'),
    ])

    const p1 = await store.getPageByGroup('group:A', null, 2)
    expect(p1.items.map((r) => r.id)).toEqual(['p2', 'p1'])
    expect(p1.nextCursor).toEqual({ pinned: true, sortOrder: 100 })

    const p2 = await store.getPageByGroup('group:A', p1.nextCursor, 2)
    expect(p2.items.map((r) => r.id)).toEqual(['n1'])
    expect(p2.nextCursor).toBeNull()
  })

  it('treats groupId null as the ungrouped bucket', async () => {
    await store.createMany([rec('u1', 70), rec('u2', 60), rec('g', 50, 'group:A')])
    const page = await store.getPageByGroup(null, null, 10)
    expect(page.items.map((r) => r.id)).toEqual(['u1', 'u2'])
    expect(page.total).toBe(2)
    expect(await store.getTotalByGroup(null)).toBe(2)
  })

  it('omits hidden sessions from the page and follows group changes via update', async () => {
    await store.createMany([rec('a', 100, 'group:A'), rec('h', 90, 'group:A', { hidden: true })])
    expect((await store.getPageByGroup('group:A', null, 10)).items.map((r) => r.id)).toEqual(['a'])

    await store.update('a', { groupId: 'group:B' })
    expect((await store.getPageByGroup('group:A', null, 10)).items).toEqual([])
    expect((await store.getPageByGroup('group:B', null, 10)).items.map((r) => r.id)).toEqual(['a'])
  })

  it('moving a session to ungrouped (groupId undefined) makes it appear under null', async () => {
    await store.create(rec('s', 100, 'group:A'))
    await store.update('s', { groupId: undefined })
    expect((await store.getPageByGroup('group:A', null, 10)).items).toEqual([])
    expect((await store.getPageByGroup(null, null, 10)).items.map((r) => r.id)).toEqual(['s'])
  })
})
