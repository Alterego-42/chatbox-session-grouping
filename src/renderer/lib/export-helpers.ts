import type { SessionGroup, SessionMeta, SessionMetaRecord } from '@shared/types'
import { uniqBy } from 'lodash'
import { BackupStorageKey, backupSessionStorageKey } from '@/packages/backup/storage-keys'
import type { BackupMetaStorage, BackupStorage } from '@/packages/backup/types'

export const UNASSIGNED_ID = '__unassigned__'

/**
 * Filter groups for export based on user selection, preserving the parent chain
 * of every kept group so dangling parentId references cannot occur in the export.
 *
 * The reserved {@link UNASSIGNED_ID} sentinel is ignored here — it is not a real
 * group id and only appears in selection state for the unassigned bucket.
 *
 * Returned array keeps the original order from {@link allGroups} (stable).
 */
export function filterGroupsForExport(allGroups: SessionGroup[], selectedGroupIds: Set<string>): SessionGroup[] {
  if (allGroups.length === 0) {
    return []
  }

  const byId = new Map<string, SessionGroup>()
  for (const g of allGroups) {
    byId.set(g.id, g)
  }

  const retained = new Set<string>()
  const visited = new Set<string>()

  for (const group of allGroups) {
    if (group.id === UNASSIGNED_ID) {
      continue
    }
    if (!selectedGroupIds.has(group.id)) {
      continue
    }
    let cursor: SessionGroup | undefined = group
    while (cursor && !visited.has(cursor.id)) {
      visited.add(cursor.id)
      retained.add(cursor.id)
      const parentId = cursor.parentId
      if (parentId === null || parentId === undefined) {
        break
      }
      cursor = byId.get(parentId)
    }
  }

  const result: SessionGroup[] = []
  for (const g of allGroups) {
    if (retained.has(g.id)) {
      result.push(g)
    }
  }
  return result
}

/**
 * Filter sessions for export, clearing groupId on any session whose group was
 * deselected by the user (the session itself was kept). Such sessions land in
 * the unassigned bucket on the import side.
 *
 * @param retainedGroupIds The id set of groups returned by
 *   {@link filterGroupsForExport}; required so we can tell which groupId values
 *   are still valid post-filter.
 */
export function filterSessionsForExport<T extends SessionMeta>(
  allMetas: T[],
  selectedSessionIds: Set<string>,
  retainedGroupIds: Set<string>
): T[] {
  const result: T[] = []
  for (const meta of allMetas) {
    if (!selectedSessionIds.has(meta.id)) {
      continue
    }
    if (meta.groupId !== undefined && !retainedGroupIds.has(meta.groupId)) {
      const cleared = { ...meta }
      cleared.groupId = undefined
      result.push(cleared)
    } else {
      result.push({ ...meta })
    }
  }
  return result
}

/**
 * Compute the default selection state for the export UI: every group + every
 * non-system, non-hidden session is selected. The {@link UNASSIGNED_ID}
 * sentinel is added when at least one orphan session exists.
 */
export function deriveInitialSelection(
  groups: SessionGroup[],
  sessions: SessionMeta[]
): { groupIds: Set<string>; sessionIds: Set<string> } {
  const groupIds = new Set<string>()
  for (const g of groups) {
    groupIds.add(g.id)
  }

  const sessionIds = new Set<string>()
  let hasOrphan = false
  for (const s of sessions) {
    if (s.groupId === undefined || s.groupId === null) {
      hasOrphan = true
    }
    if (s.hidden === true) {
      continue
    }
    if (s.system === true) {
      continue
    }
    sessionIds.add(s.id)
  }

  if (hasOrphan) {
    groupIds.add(UNASSIGNED_ID)
  }

  return { groupIds, sessionIds }
}

export interface SelectiveBackupSources {
  storage: BackupStorage
  metaStorage: BackupMetaStorage
}

function delegateStorage(storage: BackupStorage, overrides: Partial<BackupStorage>): BackupStorage {
  return {
    getAllKeys: () => storage.getAllKeys(),
    getItem: <T>(key: string, initialValue: T) => storage.getItem<T>(key, initialValue),
    setItemNow: <T>(key: string, value: T) => storage.setItemNow<T>(key, value),
    removeItem: (key) => storage.removeItem(key),
    getBlob: (key) => storage.getBlob(key),
    setBlob: (key, value) => storage.setBlob(key, value),
    delBlob: (key) => storage.delBlob(key),
    ...overrides,
  }
}

/**
 * Wrap the backup sources so `exportBackupArchive` only sees the user's selection:
 * `session-groups-list` is reduced to the selected groups (parent chains preserved), visible
 * session metas and `session:*` keys are reduced to the selected sessions (groupId cleared when
 * the group was deselected, so they land in Unassigned on import). Hidden sessions (archived /
 * system) are never offered in the tree and pass through untouched.
 */
export async function createSelectiveBackupSources(options: {
  storage: BackupStorage
  metaStorage: BackupMetaStorage
  selectedSessionIds: Set<string>
  selectedGroupIds: Set<string>
}): Promise<SelectiveBackupSources> {
  const { storage, metaStorage, selectedSessionIds, selectedGroupIds } = options
  const allMeta: SessionMetaRecord[] = await metaStorage.getAllIncludingHidden()
  const rawGroups = await storage.getItem<SessionGroup[]>(BackupStorageKey.SessionGroupsList, [])
  const retainedGroups = filterGroupsForExport(rawGroups ?? [], selectedGroupIds)
  const retainedGroupIds = new Set(retainedGroups.map((g) => g.id))
  const visible = allMeta.filter((m) => !m.hidden)
  const passthrough = allMeta.filter((m) => m.hidden)
  const exported = [...filterSessionsForExport(visible, selectedSessionIds, retainedGroupIds), ...passthrough]
  const exportedIds = new Set(exported.map((m) => m.id))
  const knownIds = new Set(allMeta.map((m) => m.id))
  const sessionKeyPrefix = backupSessionStorageKey('')
  const keepKey = (key: string) => {
    if (!key.startsWith(sessionKeyPrefix)) return true
    const id = key.slice(sessionKeyPrefix.length)
    // `session:*` entries without a meta record are not selectable; keep upstream behavior for them.
    return exportedIds.has(id) || !knownIds.has(id)
  }
  return {
    storage: delegateStorage(storage, {
      getAllKeys: async () => (await storage.getAllKeys()).filter(keepKey),
      getItem: <T>(key: string, initialValue: T) =>
        key === BackupStorageKey.SessionGroupsList
          ? Promise.resolve(retainedGroups as unknown as T)
          : storage.getItem<T>(key, initialValue),
    }),
    metaStorage: {
      getAllIncludingHidden: async () => exported,
      getById: (id) => metaStorage.getById(id),
      create: (record) => metaStorage.create(record),
      update: (id, updates) => metaStorage.update(id, updates),
      delete: (id) => metaStorage.delete(id),
    },
  }
}

/**
 * After a backup restore: merge the groups that existed before the import back in (upstream
 * restores `session-groups-list` by replacement; existing groups win on id collisions), then
 * detach every session whose groupId no longer resolves so it shows up under Unassigned instead
 * of vanishing. Covers official Chatbox backups (no groups at all) and partial group exports.
 */
export async function reconcileImportedGroups(options: {
  storage: BackupStorage
  metaStorage: BackupMetaStorage
  groupsBefore: SessionGroup[]
}): Promise<{ groups: SessionGroup[]; detachedSessionIds: string[] }> {
  const { storage, metaStorage, groupsBefore } = options
  const imported = await storage.getItem<SessionGroup[]>(BackupStorageKey.SessionGroupsList, [])
  const merged = uniqBy([...(groupsBefore ?? []), ...(Array.isArray(imported) ? imported : [])], 'id')
  if (merged.length > 0) {
    await storage.setItemNow(BackupStorageKey.SessionGroupsList, merged)
  }
  const validIds = new Set(merged.map((g) => g.id))
  const detachedSessionIds: string[] = []
  for (const meta of await metaStorage.getAllIncludingHidden()) {
    if (meta.groupId !== undefined && !validIds.has(meta.groupId)) {
      await metaStorage.update(meta.id, { groupId: undefined })
      detachedSessionIds.push(meta.id)
    }
  }
  return { groups: merged, detachedSessionIds }
}
