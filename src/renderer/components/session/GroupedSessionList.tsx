import NiceModal from '@ebay/nice-modal-react'
import { ActionIcon, Box, Flex, Text, Tooltip } from '@mantine/core'
import {
  IconArchive,
  IconChevronRight,
  IconInbox,
  IconLoader2,
  IconPlus,
  IconSearch,
  IconStarFilled,
} from '@tabler/icons-react'
import { useNavigate, useRouterState } from '@tanstack/react-router'
import { useAtom } from 'jotai'
import { type MutableRefObject, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Virtuoso } from 'react-virtuoso'
import { currentSidebarGroupIdAtom } from '@/stores/atoms/uiAtoms'
import { useSessionListByGroup, useStarredSessions } from '@/stores/chatStore'
import { useGroups } from '@/stores/groupStore'
import { useUIStore } from '@/stores/uiStore'
import { getGroupPath, STARRED_GROUP_ID } from '@/utils/group-tree'
import SessionItem from './SessionItem'

export interface Props {
  sessionListViewportRef: MutableRefObject<HTMLDivElement | null>
}

function LoadingFooter() {
  return (
    <Flex justify="center" py="xs">
      <IconLoader2 size={16} className="animate-spin" style={{ color: 'var(--mantine-color-dimmed)' }} />
    </Flex>
  )
}

/** Main file-explorer panel: the entered group's direct sessions (or the virtual Starred view), paginated. */
export default function GroupedSessionList({ sessionListViewportRef }: Props) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { groups } = useGroups()
  const [currentGroupId, setCurrentGroupId] = useAtom(currentSidebarGroupIdAtom)
  const isStarred = currentGroupId === STARRED_GROUP_ID
  const path = useMemo(() => getGroupPath(groups ?? [], currentGroupId), [groups, currentGroupId])
  const byGroup = useSessionListByGroup(isStarred ? null : currentGroupId)
  const starred = useStarredSessions()
  const sessionMetaList = isStarred ? starred.sessionMetaList : byGroup.sessionMetaList
  const hasNext = !isStarred && byGroup.hasNextPage
  const setOpenSearchDialog = useUIStore((s) => s.setOpenSearchDialog)
  const routerState = useRouterState()

  const onEndReached = useCallback(() => {
    if (!isStarred && byGroup.hasNextPage && !byGroup.isFetchingNextPage) byGroup.fetchNextPage()
  }, [isStarred, byGroup.hasNextPage, byGroup.isFetchingNextPage, byGroup.fetchNextPage])

  const newChatHere = () =>
    navigate({ to: '/', search: currentGroupId && !isStarred ? { groupId: currentGroupId } : {} })

  const virtuosoComponents = useMemo(() => (hasNext ? { Footer: LoadingFooter } : {}), [hasNext])

  return (
    <Flex direction="column" flex={1} style={{ minWidth: 0, minHeight: 0 }}>
      <Flex align="center" gap={4} py="xs" px="sm">
        <Flex align="center" gap={2} flex={1} style={{ minWidth: 0, overflow: 'hidden' }}>
          {isStarred ? (
            <>
              <IconStarFilled size={16} className="shrink-0" style={{ color: 'var(--mantine-color-yellow-6)' }} />
              <Text span size="sm" fw={600} c="chatbox-primary" lineClamp={1}>
                {t('Starred')}
              </Text>
            </>
          ) : (
            <>
              <Tooltip label={t('Ungrouped')} openDelay={500} withArrow>
                <ActionIcon
                  variant="subtle"
                  color={currentGroupId === null ? 'chatbox-brand' : 'chatbox-tertiary'}
                  size={20}
                  aria-label={t('Ungrouped') ?? ''}
                  onClick={() => setCurrentGroupId(null)}
                >
                  <IconInbox size={16} />
                </ActionIcon>
              </Tooltip>
              {currentGroupId === null ? (
                <Text span size="sm" fw={600} c="chatbox-primary" lineClamp={1}>
                  {t('Ungrouped')}
                </Text>
              ) : (
                path.map((g, i) => (
                  <Flex key={g.id} align="center" gap={2} style={{ minWidth: 0 }}>
                    <IconChevronRight size={12} className="shrink-0 text-chatbox-tertiary" />
                    <Text
                      span
                      size="sm"
                      lineClamp={1}
                      c={i === path.length - 1 ? 'chatbox-primary' : 'chatbox-tertiary'}
                      fw={i === path.length - 1 ? 600 : 400}
                      className="cursor-pointer"
                      onClick={() => setCurrentGroupId(g.id)}
                    >
                      {g.name}
                    </Text>
                  </Flex>
                ))
              )}
            </>
          )}
        </Flex>

        {!isStarred && (
          <Tooltip label={t('New chat in this group')} openDelay={500} withArrow>
            <ActionIcon variant="subtle" color="chatbox-tertiary" size={20} onClick={newChatHere}>
              <IconPlus />
            </ActionIcon>
          </Tooltip>
        )}
        <Tooltip label={t('Search')} openDelay={500} withArrow>
          <ActionIcon
            variant="subtle"
            color="chatbox-tertiary"
            size={20}
            onClick={() => setOpenSearchDialog(true, true)}
          >
            <IconSearch />
          </ActionIcon>
        </Tooltip>
        <Tooltip label={t('Clear Conversation List')} openDelay={500} withArrow>
          <ActionIcon
            variant="subtle"
            color="chatbox-tertiary"
            size={20}
            onClick={() => NiceModal.show('clear-session-list')}
          >
            <IconArchive />
          </ActionIcon>
        </Tooltip>
      </Flex>

      {sessionMetaList && sessionMetaList.length > 0 ? (
        <Virtuoso
          style={{ flex: 1 }}
          data={sessionMetaList}
          computeItemKey={(_index, session) => session.id}
          scrollerRef={(ref) => {
            if (ref instanceof HTMLDivElement) {
              sessionListViewportRef.current = ref
            }
          }}
          endReached={onEndReached}
          components={virtuosoComponents}
          itemContent={(_index, session) => (
            <SessionItem
              selected={routerState.location.pathname === `/session/${session.id}`}
              session={session}
              restricted={isStarred}
            />
          )}
        />
      ) : (
        <Flex flex={1} align="center" justify="center" px="md">
          <Box>
            <Text size="sm" c="chatbox-tertiary" ta="center">
              {isStarred ? t('No starred chats yet') : t('No chats here yet')}
            </Text>
          </Box>
        </Flex>
      )}
    </Flex>
  )
}
