import type { SessionMetaPage } from '@shared/types'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { rendererApplication } from '@/app/renderer-application'
import platform from '@/platform'
import type { SessionMetaStorage } from '@/storage/SessionMetaStorage'

// MARK: group-scoped session list (file-explorer view)

const UNGROUPED_QUERY_KEY = '__ungrouped__'
const GROUP_LIST_KEY = ['chat-sessions-list', 'group'] as const
const GROUP_COUNT_KEY = ['chat-sessions-list', 'group-count'] as const
const STARRED_KEY = ['chat-sessions-list', 'starred'] as const

/**
 * Group-aware meta storage. The renderer `SessionMetaStorage` is a superset of the core
 * repository port (adds getPageByGroup / getTotalByGroup); `platform.getSessionMetaStorage()`
 * returns the same singleton the repository wraps, so reads here see every write.
 */
export async function getGroupMetaStorage(): Promise<SessionMetaStorage> {
  await rendererApplication.sessions.initialize()
  return platform.getSessionMetaStorage()
}

/** Query key for one group's paginated sessions (groupId null = ungrouped root). */
export const groupSessionsQueryKey = (groupId: string | null) =>
  [...GROUP_LIST_KEY, groupId ?? UNGROUPED_QUERY_KEY] as const

async function listSessionsByGroupPage(groupId: string | null, cursor: number | null): Promise<SessionMetaPage> {
  const metaStorage = await getGroupMetaStorage()
  return await metaStorage.getPageByGroup(groupId, cursor)
}

function groupSessionsQueryOptions(groupId: string | null) {
  return {
    queryKey: groupSessionsQueryKey(groupId),
    queryFn: ({ pageParam }: { pageParam: number | null }) => listSessionsByGroupPage(groupId, pageParam),
    getNextPageParam: (lastPage: SessionMetaPage) => lastPage.nextCursor,
    initialPageParam: null as number | null,
    staleTime: Infinity,
  }
}

let eventsSubscribed = false
/**
 * Keep the explorer queries in sync with every session mutation that goes through the
 * application layer (create / meta update / delete / list reset). Message-only updates carry
 * `meta: null` and are ignored so streaming does not thrash the sidebar.
 */
function ensureEventSubscription() {
  if (eventsSubscribed) return
  eventsSubscribed = true
  rendererApplication.sessionEvents.subscribe((event) => {
    if (event.type === 'session-updated' && event.meta === null) return
    invalidateSessionLists()
  })
}

/** Real-paginated sessions for one group (null = ungrouped root) — the file-explorer main panel. */
export function useSessionListByGroup(groupId: string | null) {
  ensureEventSubscription()
  const result = useInfiniteQuery(groupSessionsQueryOptions(groupId))
  const sessionMetaList = useMemo(() => result.data?.pages.flatMap((p) => p.items), [result.data])
  return {
    sessionMetaList,
    total: result.data?.pages[0]?.total ?? 0,
    refetch: result.refetch,
    fetchNextPage: result.fetchNextPage,
    hasNextPage: result.hasNextPage,
    isFetchingNextPage: result.isFetchingNextPage,
    isLoading: result.isLoading,
  }
}

/** Direct-session count for a group (null = ungrouped) — used for tree/rail badges. */
export function useGroupSessionCount(groupId: string | null) {
  ensureEventSubscription()
  const { data } = useQuery({
    queryKey: [...GROUP_COUNT_KEY, groupId ?? UNGROUPED_QUERY_KEY],
    queryFn: async () => (await getGroupMetaStorage()).getTotalByGroup(groupId),
    staleTime: Infinity,
  })
  return data ?? 0
}

/** All starred sessions across groups, newest first — backs the virtual "Starred" pseudo-group. */
export function useStarredSessions() {
  ensureEventSubscription()
  const { data } = useQuery({
    queryKey: STARRED_KEY,
    queryFn: async () => {
      const all = await (await getGroupMetaStorage()).getAll()
      return all.filter((s) => s.starred)
    },
    staleTime: Infinity,
  })
  return { sessionMetaList: data, total: data?.length ?? 0 }
}

/** Refresh the per-group explorer queries (group lists + counts + starred) after a session mutation.
 * The global infinite list keeps its own optimistic updates, so it is intentionally left untouched. */
export function invalidateSessionLists() {
  const queryClient = rendererApplication.queryClient
  void queryClient.invalidateQueries({ queryKey: GROUP_LIST_KEY })
  void queryClient.invalidateQueries({ queryKey: GROUP_COUNT_KEY })
  void queryClient.invalidateQueries({ queryKey: STARRED_KEY })
}
