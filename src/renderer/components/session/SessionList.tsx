import type { DragEndEvent } from '@dnd-kit/core'
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { restrictToVerticalAxis } from '@dnd-kit/modifiers'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import NiceModal from '@ebay/nice-modal-react'
import { ActionIcon, Flex, Text, Tooltip } from '@mantine/core'
import { IconArchive, IconFolderPlus, IconSearch } from '@tabler/icons-react'
import { useRouterState } from '@tanstack/react-router'
import { useAtom } from 'jotai'
import { type MutableRefObject, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Virtuoso } from 'react-virtuoso'
import { expandedGroupsAtom } from '@/stores/atoms/uiAtoms'
import { useSessionList } from '@/stores/chatStore'
import { useGroups } from '@/stores/groupStore'
import { moveSessionToGroup, reorderWithinGroup } from '@/stores/sessionActions'
import { useUIStore } from '@/stores/uiStore'
import { buildFlatTree, type FlatRow } from '@/utils/session-tree'
import GroupNode from './GroupNode'
import SessionItem from './SessionItem'

export interface Props {
  sessionListViewportRef: MutableRefObject<HTMLDivElement | null>
}

export default function SessionList(props: Props) {
  const { t } = useTranslation()
  const { sessionMetaList: sortedSessions, refetch } = useSessionList()
  const { groups } = useGroups()
  const [expanded, setExpanded] = useAtom(expandedGroupsAtom)
  const setOpenSearchDialog = useUIStore((s) => s.setOpenSearchDialog)
  const sensors = useSensors(
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 250,
        tolerance: 10,
      },
    }),
    useSensor(MouseSensor, {
      activationConstraint: {
        distance: 10,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  const rows: FlatRow[] = useMemo(
    () => buildFlatTree(groups ?? [], sortedSessions ?? [], expanded),
    [groups, sortedSessions, expanded]
  )

  const sortableIds = useMemo(
    () => rows.filter((r): r is Extract<FlatRow, { kind: 'session' }> => r.kind === 'session').map((r) => r.id),
    [rows]
  )

  const toggleExpand = (key: string) => {
    setExpanded((m) => ({ ...m, [key]: m[key] === false }))
  }

  const onDragEnd = async (event: DragEndEvent) => {
    if (!event.over) {
      return
    }
    if (!sortedSessions) {
      return
    }
    const activeId = String(event.active.id)
    const overId = String(event.over.id)
    if (activeId === overId) {
      return
    }
    const activeRow = rows.find(
      (r): r is Extract<FlatRow, { kind: 'session' }> => r.kind === 'session' && r.id === activeId
    )
    const overRow = rows.find(
      (r): r is Extract<FlatRow, { kind: 'session' }> => r.kind === 'session' && r.id === overId
    )
    if (!activeRow || !overRow) {
      return
    }
    const targetGroupId = overRow.groupId
    const sessionsInTargetGroup = rows.filter(
      (r): r is Extract<FlatRow, { kind: 'session' }> => r.kind === 'session' && r.groupId === targetGroupId
    )
    const overIdxInGroup = sessionsInTargetGroup.findIndex((s) => s.id === overId)
    if (activeRow.groupId === targetGroupId) {
      const activeIdxInGroup = sessionsInTargetGroup.findIndex((s) => s.id === activeId)
      if (activeIdxInGroup < 0 || overIdxInGroup < 0) {
        return
      }
      await reorderWithinGroup(targetGroupId, activeIdxInGroup, overIdxInGroup)
    } else {
      await moveSessionToGroup(activeId, targetGroupId, overIdxInGroup)
    }
    refetch()
  }

  const handleCreateGroup = () => {
    void NiceModal.show('create-group')
  }
  const routerState = useRouterState()

  return (
    <>
      <Flex align="center" py="xs" px="md" gap={'xs'}>
        <Text c="chatbox-tertiary" flex={1}>
          {t('Chat')}
        </Text>

        <Tooltip label={t('New group')} openDelay={1000} withArrow>
          <ActionIcon
            variant="subtle"
            color="chatbox-tertiary"
            size={20}
            onClick={() => void handleCreateGroup()}
          >
            <IconFolderPlus />
          </ActionIcon>
        </Tooltip>

        <Tooltip label={t('Search')} openDelay={1000} withArrow>
          <ActionIcon
            variant="subtle"
            color="chatbox-tertiary"
            size={20}
            onClick={() => setOpenSearchDialog(true, true)}
          >
            <IconSearch />
          </ActionIcon>
        </Tooltip>

        <Tooltip label={t('Clear Conversation List')} openDelay={1000} withArrow>
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

      <DndContext
        modifiers={[restrictToVerticalAxis]}
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={onDragEnd}
      >
        {sortedSessions && (
          <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
            <Virtuoso
              style={{ flex: 1 }}
              data={rows}
              computeItemKey={(_i, row) => row.id}
              scrollerRef={(ref) => {
                if (ref instanceof HTMLDivElement) {
                  props.sessionListViewportRef.current = ref
                }
              }}
              itemContent={(_index, row) => {
                if (row.kind === 'group' || row.kind === 'unassigned-root') {
                  return <GroupNode row={row} onToggle={() => toggleExpand(row.id)} />
                }
                return (
                  <div style={{ paddingLeft: row.depth * 12 }}>
                    <SortableItem id={row.id}>
                      <SessionItem
                        selected={routerState.location.pathname === `/session/${row.session.id}`}
                        session={row.session}
                      />
                    </SortableItem>
                  </div>
                )
              }}
            />
          </SortableContext>
        )}
      </DndContext>
    </>
  )
}

function SortableItem(props: { id: string; children?: React.ReactNode }) {
  const { id, children } = props
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id })
  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      {...attributes}
      {...listeners}
    >
      {children}
    </div>
  )
}
