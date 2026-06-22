import NiceModal from '@ebay/nice-modal-react'
import { ActionIcon, Box, Flex, Text, Tooltip } from '@mantine/core'
import { IconArchive, IconChevronRight, IconInbox, IconLoader2, IconPlus, IconSearch } from '@tabler/icons-react'
import { useNavigate, useRouterState } from '@tanstack/react-router'
import { useAtom } from 'jotai'
import { type MutableRefObject, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Virtuoso } from 'react-virtuoso'
import { currentSidebarGroupIdAtom } from '@/stores/atoms/uiAtoms'
import { useSessionListByGroup } from '@/stores/chatStore'
import { useGroups } from '@/stores/groupStore'
import { useUIStore } from '@/stores/uiStore'
import { getGroupPath } from '@/utils/group-tree'
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

/** Main file-explorer panel: breadcrumb of the entered group + its direct sessions, paginated. */
export default function GroupedSessionList({ sessionListViewportRef }: Props) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { groups } = useGroups()
  const [currentGroupId, setCurrentGroupId] = useAtom(currentSidebarGroupIdAtom)
  const path = useMemo(() => getGroupPath(groups ?? [], currentGroupId), [groups, currentGroupId])
  const { sessionMetaList, fetchNextPage, hasNextPage, isFetchingNextPage } = useSessionListByGroup(currentGroupId)
  const setOpenSearchDialog = useUIStore((s) => s.setOpenSearchDialog)
  const routerState = useRouterState()

  const onEndReached = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) fetchNextPage()
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])

  const newChatHere = () => navigate({ to: '/', search: currentGroupId ? { groupId: currentGroupId } : {} })

  const virtuosoComponents = useMemo(() => (hasNextPage ? { Footer: LoadingFooter } : {}), [hasNextPage])

  return (
    <Flex direction="column" flex={1} style={{ minWidth: 0, minHeight: 0 }}>
      <Flex align="center" gap={4} py="xs" px="sm">
        <Flex align="center" gap={2} flex={1} style={{ minWidth: 0, overflow: 'hidden' }}>
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
        </Flex>

        <Tooltip label={t('New chat in this group')} openDelay={500} withArrow>
          <ActionIcon variant="subtle" color="chatbox-tertiary" size={20} onClick={newChatHere}>
            <IconPlus />
          </ActionIcon>
        </Tooltip>
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
            <SessionItem selected={routerState.location.pathname === `/session/${session.id}`} session={session} />
          )}
        />
      ) : (
        <Flex flex={1} align="center" justify="center" px="md">
          <Box>
            <Text size="sm" c="chatbox-tertiary" ta="center">
              {t('No chats here yet')}
            </Text>
          </Box>
        </Flex>
      )}
    </Flex>
  )
}
