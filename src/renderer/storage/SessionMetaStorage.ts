import type { SessionMetaRepositoryPort } from '@chatbox/core/ports'
import { sortSessionRecords } from '@chatbox/core/utils/session-sort'
import type { SessionMetaPage, SessionMetaRecord } from '@shared/types'
import { reportDbOpenSucceeded, toDbOpenError, watchDbOpenBlocked, watchDbVersionChange } from './db-schema-guard'

const DB_NAME = 'chatbox-session-meta'
const STORE_NAME = 'records'
const DEFAULT_PAGE_SIZE = 50
const GROUP_INDEX = 'byGroup'

// Records carry an internal `groupKey` (= groupId ?? '') so a [groupKey, sortOrder] compound index
// can range-query by group. IndexedDB skips records whose indexed key path is `undefined`, so a raw
// `groupId` index would lose all ungrouped sessions — the '' sentinel keeps them queryable.
const UNGROUPED_KEY = ''
type StoredMetaRecord = SessionMetaRecord & { groupKey: string }

function toStored(record: SessionMetaRecord): StoredMetaRecord {
  return { ...record, groupKey: record.groupId ?? UNGROUPED_KEY }
}

/** Drop the internal `groupKey` index field so callers only ever see a clean SessionMetaRecord. */
function fromStored(record: SessionMetaRecord & { groupKey?: string }): SessionMetaRecord {
  const { groupKey: _groupKey, ...rest } = record
  return rest
}

export interface SessionMetaStorage extends SessionMetaRepositoryPort {
  initialize(): Promise<void>
  create(record: SessionMetaRecord): Promise<void>
  createMany(records: SessionMetaRecord[]): Promise<void>
  update(id: string, updates: Partial<SessionMetaRecord>): Promise<SessionMetaRecord | null>
  getById(id: string): Promise<SessionMetaRecord | null>
  delete(id: string): Promise<void>
  deleteMany(ids: string[]): Promise<void>
  getAll(): Promise<SessionMetaRecord[]>
  getAllIncludingHidden(): Promise<SessionMetaRecord[]>
  getArchived(): Promise<SessionMetaRecord[]>
  getArchivedPage(cursor: number, limit?: number): Promise<SessionMetaPage>
  getPage(cursor: number, limit?: number): Promise<SessionMetaPage>
  /**
   * Keyset-paginated read of one group's visible (non-hidden) sessions (groupId null = ungrouped),
   * newest first by sortOrder. `cursor` is the previous page's last sortOrder (null = first page).
   * Uses the [groupKey, sortOrder] index when present; otherwise streams the sortOrder index with a
   * filter — never getAll() + slice.
   */
  getPageByGroup(groupId: string | null, cursor: number | null, limit?: number): Promise<SessionMetaPage>
  getTotal(): Promise<number>
  /** Visible (non-hidden) session count for one group (null = ungrouped). */
  getTotalByGroup(groupId: string | null): Promise<number>
  getAllTotal(): Promise<number>
  getArchivedTotal(): Promise<number>
  clear(): Promise<void>
}

// Sort logic shared with the native mobile shell.
export { sortSessionRecords }

function sortArchivedSessionRecords(records: SessionMetaRecord[]): SessionMetaRecord[] {
  return records
    .filter((record) => record.archivedAt !== undefined)
    .sort((a, b) => (b.archivedAt ?? 0) - (a.archivedAt ?? 0))
}

export class IndexedDBSessionMetaStorage implements SessionMetaStorage {
  private db: IDBDatabase | null = null
  private initPromise: Promise<void> | null = null

  initialize(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.openDatabase()
        .then(() => this.ensureGroupKeys())
        .catch((error) => {
          this.initPromise = null
          throw error
        })
    }
    return this.initPromise
  }

  private openDatabase(): Promise<void> {
    return new Promise((resolve, reject) => {
      // 这些索引只是性能优化，没有很强的 schema 迁移理由，去掉了强制指定 version。
      // bump 后用户回退版本会因 VersionError 打不开 session meta DB，导致降级使用失败：
      // `The requested version (X) is less than the existing version (Y)` —— 例如 1.22 → 1.21 降级后无法发消息。
      // 如确需引入 version/schema 变更：只做加法式变更（新 store/索引，keyPath 不变），
      // 并保留 db-schema-guard，让降级产生的 VersionError 显示更新引导，而不是静默改写数据。
      const request = indexedDB.open(DB_NAME)
      watchDbOpenBlocked(DB_NAME, request)

      request.onerror = () => reject(toDbOpenError(DB_NAME, request.error))

      request.onsuccess = () => {
        const db = request.result
        this.db = db
        reportDbOpenSucceeded(DB_NAME)
        watchDbVersionChange(DB_NAME, db, () => {
          if (this.db === db) {
            this.db = null
            this.initPromise = null
          }
        })
        resolve()
      }

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result
        const store = db.objectStoreNames.contains(STORE_NAME)
          ? request.transaction?.objectStore(STORE_NAME)
          : db.createObjectStore(STORE_NAME, { keyPath: 'id' })
        if (!store) {
          return
        }
        if (!store.indexNames.contains('sortOrder')) {
          store.createIndex('sortOrder', 'sortOrder', { unique: false })
        }
        if (!store.indexNames.contains('createdAt')) {
          store.createIndex('createdAt', 'createdAt', { unique: false })
        }
        if (!store.indexNames.contains('starredSortOrder')) {
          store.createIndex('starredSortOrder', ['starred', 'sortOrder'], { unique: false })
        }
        if (!store.indexNames.contains('archivedAt')) {
          store.createIndex('archivedAt', 'archivedAt', { unique: false })
        }
        if (!store.indexNames.contains(GROUP_INDEX)) {
          store.createIndex(GROUP_INDEX, ['groupKey', 'sortOrder'], { unique: false })
        }
      }
    })
  }

  /**
   * Records written by code paths that don't know about `groupKey` (e.g. an official build sharing
   * this DB) are invisible to the group index. Stamp them once on open so the index is complete.
   */
  private ensureGroupKeys(): Promise<void> {
    if (!this.db || !this.hasIndex(GROUP_INDEX)) return Promise.resolve()
    return new Promise((resolve, reject) => {
      const store = this.getStore('readwrite')
      const request = store.openCursor()
      request.onsuccess = () => {
        const cursor = request.result
        if (!cursor) {
          resolve()
          return
        }
        const rec = cursor.value as SessionMetaRecord & { groupKey?: string }
        const groupKey = rec.groupId ?? UNGROUPED_KEY
        if (rec.groupKey !== groupKey) cursor.update({ ...rec, groupKey })
        cursor.continue()
      }
      request.onerror = () => reject(request.error)
    })
  }

  private getStore(mode: IDBTransactionMode): IDBObjectStore {
    if (!this.db) throw new Error('Database not initialized')
    const tx = this.db.transaction(STORE_NAME, mode)
    return tx.objectStore(STORE_NAME)
  }

  async create(record: SessionMetaRecord): Promise<void> {
    await this.initialize()
    return new Promise((resolve, reject) => {
      const store = this.getStore('readwrite')
      const request = store.add(toStored(record))
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }

  async createMany(records: SessionMetaRecord[]): Promise<void> {
    await this.initialize()
    if (records.length === 0) return
    return new Promise((resolve, reject) => {
      if (!this.db) throw new Error('Database not initialized')
      const tx = this.db.transaction(STORE_NAME, 'readwrite')
      const store = tx.objectStore(STORE_NAME)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      for (const record of records) {
        store.put(toStored(record))
      }
    })
  }

  async update(id: string, updates: Partial<SessionMetaRecord>): Promise<SessionMetaRecord | null> {
    await this.initialize()
    const existing = await this.getById(id)
    if (!existing) return null

    const updated = toStored({ ...existing, ...updates })
    return new Promise((resolve, reject) => {
      const store = this.getStore('readwrite')
      const request = store.put(updated)
      request.onsuccess = () => resolve(fromStored(updated))
      request.onerror = () => reject(request.error)
    })
  }

  async getById(id: string): Promise<SessionMetaRecord | null> {
    await this.initialize()
    return new Promise((resolve, reject) => {
      const store = this.getStore('readonly')
      const request = store.get(id)
      request.onsuccess = () => resolve(request.result ? fromStored(request.result) : null)
      request.onerror = () => reject(request.error)
    })
  }

  async delete(id: string): Promise<void> {
    await this.initialize()
    return new Promise((resolve, reject) => {
      const store = this.getStore('readwrite')
      const request = store.delete(id)
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }

  async deleteMany(ids: string[]): Promise<void> {
    await this.initialize()
    if (ids.length === 0) return
    return new Promise((resolve, reject) => {
      if (!this.db) throw new Error('Database not initialized')
      const tx = this.db.transaction(STORE_NAME, 'readwrite')
      const store = tx.objectStore(STORE_NAME)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      for (const id of ids) {
        store.delete(id)
      }
    })
  }

  async getAll(): Promise<SessionMetaRecord[]> {
    await this.initialize()
    const records = await this.getAllRecords()
    return sortSessionRecords(records)
  }

  async getAllIncludingHidden(): Promise<SessionMetaRecord[]> {
    await this.initialize()
    const records = await this.getAllRecords()
    return records.sort((a, b) => b.sortOrder - a.sortOrder)
  }

  async getArchived(): Promise<SessionMetaRecord[]> {
    await this.initialize()
    const records = await this.getAllRecords()
    return sortArchivedSessionRecords(records)
  }

  async getArchivedPage(cursor: number = 0, limit: number = DEFAULT_PAGE_SIZE): Promise<SessionMetaPage> {
    await this.initialize()
    if (!this.hasIndex('archivedAt')) {
      const all = await this.getArchived()
      const items = all.slice(cursor, cursor + limit)
      const nextCursor = cursor + items.length < all.length ? cursor + items.length : null
      return { items, nextCursor, total: all.length }
    }

    const [items, total] = await Promise.all([
      this.getRecordsPage({
        cursor,
        limit,
        indexName: 'archivedAt',
        direction: 'prev',
        filter: (record) => record.archivedAt !== undefined,
      }),
      this.getArchivedTotal(),
    ])
    const nextCursor = cursor + items.length < total ? cursor + items.length : null
    return { items, nextCursor, total }
  }

  private hasIndex(indexName: string): boolean {
    const store = this.getStore('readonly')
    return store.indexNames.contains(indexName)
  }

  private getAllRecords(): Promise<SessionMetaRecord[]> {
    return new Promise((resolve, reject) => {
      const store = this.getStore('readonly')
      const request = store.getAll()
      request.onsuccess = () => {
        const records = (request.result as Array<SessionMetaRecord & { groupKey?: string }>).map(fromStored)
        resolve(records)
      }
      request.onerror = () => reject(request.error)
    })
  }

  async getPage(cursor: number = 0, limit: number = DEFAULT_PAGE_SIZE): Promise<SessionMetaPage> {
    await this.initialize()
    const [items, total] = await Promise.all([this.getVisibleRecordsPage(cursor, limit), this.getTotal()])
    const nextCursor = cursor + items.length < total ? cursor + items.length : null
    return { items, nextCursor, total }
  }

  async getPageByGroup(
    groupId: string | null,
    cursor: number | null = null,
    limit: number = DEFAULT_PAGE_SIZE
  ): Promise<SessionMetaPage> {
    await this.initialize()
    const items = this.hasIndex(GROUP_INDEX)
      ? await this.getGroupPageByIndex(groupId, cursor, limit)
      : await this.getGroupPageByScan(groupId, cursor, limit)
    const nextCursor = items.length >= limit ? (items[items.length - 1]?.sortOrder ?? null) : null
    const total = await this.getTotalByGroup(groupId)
    return { items, nextCursor, total }
  }

  private getGroupPageByIndex(groupId: string | null, cursor: number | null, limit: number) {
    const groupKey = groupId ?? UNGROUPED_KEY
    // `[groupKey, []]` sorts after every `[groupKey, <number>]` (arrays > numbers in IDB key order),
    // so it is the open upper bound for "all records in this group".
    const range =
      cursor === null
        ? IDBKeyRange.bound([groupKey], [groupKey, []])
        : IDBKeyRange.bound([groupKey], [groupKey, cursor], false, true)
    return new Promise<SessionMetaRecord[]>((resolve, reject) => {
      const out: SessionMetaRecord[] = []
      const index = this.getStore('readonly').index(GROUP_INDEX)
      const req = index.openCursor(range, 'prev')
      req.onsuccess = () => {
        const c = req.result
        if (!c || out.length >= limit) {
          resolve(out)
          return
        }
        const rec = c.value as SessionMetaRecord & { groupKey?: string }
        if (!rec.hidden) out.push(fromStored(rec))
        c.continue()
      }
      req.onerror = () => reject(req.error)
    })
  }

  /** Index-less fallback: stream the sortOrder index newest-first and keep matching records. */
  private getGroupPageByScan(groupId: string | null, cursor: number | null, limit: number) {
    return new Promise<SessionMetaRecord[]>((resolve, reject) => {
      const out: SessionMetaRecord[] = []
      const store = this.getStore('readonly')
      const source = store.indexNames.contains('sortOrder') ? store.index('sortOrder') : store
      const range = cursor === null ? null : IDBKeyRange.upperBound(cursor, true)
      const req = source.openCursor(range, 'prev')
      req.onsuccess = () => {
        const c = req.result
        if (!c || out.length >= limit) {
          resolve(out)
          return
        }
        const rec = c.value as SessionMetaRecord & { groupKey?: string }
        if (!rec.hidden && (rec.groupId ?? null) === groupId) out.push(fromStored(rec))
        c.continue()
      }
      req.onerror = () => reject(req.error)
    })
  }

  async getTotal(): Promise<number> {
    await this.initialize()
    return await this.countRecords((record) => !record.hidden)
  }

  async getTotalByGroup(groupId: string | null): Promise<number> {
    await this.initialize()
    return await this.countRecords((record) => !record.hidden && (record.groupId ?? null) === groupId)
  }

  async getAllTotal(): Promise<number> {
    await this.initialize()
    return new Promise((resolve, reject) => {
      const store = this.getStore('readonly')
      const request = store.count()
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  }

  async getArchivedTotal(): Promise<number> {
    await this.initialize()
    return await this.countRecords((record) => record.archivedAt !== undefined)
  }

  private async getVisibleRecordsPage(cursor: number, limit: number): Promise<SessionMetaRecord[]> {
    const items: SessionMetaRecord[] = []
    let skipped = 0

    skipped = await this.collectRecordsPage({
      items,
      skipped,
      cursor,
      limit,
      indexName: 'sortOrder',
      direction: 'prev',
      filter: (record) => !record.hidden && record.starred === true,
    })

    if (items.length < limit) {
      await this.collectRecordsPage({
        items,
        skipped,
        cursor,
        limit,
        indexName: 'sortOrder',
        direction: 'prev',
        filter: (record) => !record.hidden && record.starred !== true,
      })
    }

    return items
  }

  private collectRecordsPage({
    items,
    skipped,
    cursor,
    limit,
    indexName,
    direction,
    filter,
  }: {
    items: SessionMetaRecord[]
    skipped: number
    cursor: number
    limit: number
    indexName: string
    direction: IDBCursorDirection
    filter: (record: SessionMetaRecord) => boolean
  }): Promise<number> {
    return new Promise((resolve, reject) => {
      const store = this.getStore('readonly')
      const source = store.indexNames.contains(indexName) ? store.index(indexName) : store
      const request = source.openCursor(null, direction)
      let skippedCount = skipped

      request.onsuccess = () => {
        const cursorResult = request.result
        if (!cursorResult || items.length >= limit) {
          resolve(skippedCount)
          return
        }

        const record = cursorResult.value as SessionMetaRecord & { groupKey?: string }
        if (!filter(record)) {
          cursorResult.continue()
          return
        }
        if (skippedCount < cursor) {
          skippedCount += 1
          cursorResult.continue()
          return
        }

        items.push(fromStored(record))
        cursorResult.continue()
      }
      request.onerror = () => reject(request.error)
    })
  }

  private getRecordsPage({
    cursor,
    limit,
    indexName,
    direction,
    filter,
  }: {
    cursor: number
    limit: number
    indexName: string
    direction: IDBCursorDirection
    filter: (record: SessionMetaRecord) => boolean
  }): Promise<SessionMetaRecord[]> {
    return new Promise((resolve, reject) => {
      const store = this.getStore('readonly')
      const source = store.indexNames.contains(indexName) ? store.index(indexName) : store
      const request = source.openCursor(null, direction)
      const items: SessionMetaRecord[] = []
      let skipped = 0

      request.onsuccess = () => {
        const cursorResult = request.result
        if (!cursorResult || items.length >= limit) {
          resolve(items)
          return
        }

        const record = cursorResult.value as SessionMetaRecord & { groupKey?: string }
        if (!filter(record)) {
          cursorResult.continue()
          return
        }
        if (skipped < cursor) {
          skipped += 1
          cursorResult.continue()
          return
        }

        items.push(fromStored(record))
        cursorResult.continue()
      }
      request.onerror = () => reject(request.error)
    })
  }

  private countRecords(filter: (record: SessionMetaRecord) => boolean): Promise<number> {
    return new Promise((resolve, reject) => {
      const store = this.getStore('readonly')
      const request = store.openCursor()
      let total = 0

      request.onsuccess = () => {
        const cursorResult = request.result
        if (!cursorResult) {
          resolve(total)
          return
        }
        if (filter(cursorResult.value as SessionMetaRecord)) {
          total += 1
        }
        cursorResult.continue()
      }
      request.onerror = () => reject(request.error)
    })
  }

  async clear(): Promise<void> {
    await this.initialize()
    return new Promise((resolve, reject) => {
      const store = this.getStore('readwrite')
      const request = store.clear()
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }
}
