import type { CollisionDetection, DragEndEvent, DragOverEvent, DragStartEvent } from '@dnd-kit/core'
import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  pointerWithin,
  TouchSensor,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { restrictToVerticalAxis } from '@dnd-kit/modifiers'
import { SortableContext, sortableKeyboardCoordinates, useSortable } from '@dnd-kit/sortable'
import NiceModal from '@ebay/nice-modal-react'
import { ActionIcon, Flex, Text, Tooltip } from '@mantine/core'
import { IconArchive, IconFolderPlus, IconSearch } from '@tabler/icons-react'
import { useRouterState } from '@tanstack/react-router'
import { useAtom } from 'jotai'
import { type MutableRefObject, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Virtuoso } from 'react-virtuoso'
import { expandedGroupsAtom } from '@/stores/atoms/uiAtoms'
import { useSessionList } from '@/stores/chatStore'
import { updateGroup, useGroups } from '@/stores/groupStore'
import { moveSessionToGroup, reorderChildGroups, reorderGroups, reorderWithinGroup } from '@/stores/sessionActions'
import { useUIStore } from '@/stores/uiStore'
import { type DropPosition, routeDragEnd } from '@/utils/dnd-route'
import { buildFlatTree, type FlatRow } from '@/utils/session-tree'
import GroupNode from './GroupNode'
import SessionItem from './SessionItem'

export interface Props {
  sessionListViewportRef: MutableRefObject<HTMLDivElement | null>
}

interface OverInfo {
  id: string
  position: DropPosition
}

export default function SessionList(props: Props) {
  const { t } = useTranslation()
  const { sessionMetaList: sortedSessions, refetch } = useSessionList()
  const { groups } = useGroups()
  const [expanded, setExpanded] = useAtom(expandedGroupsAtom)
  const setOpenSearchDialog = useUIStore((s) => s.setOpenSearchDialog)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [overInfo, setOverInfo] = useState<OverInfo | null>(null)
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

  // Single flattened sortable space — sessions and real groups share IDs;
  // unassigned-root stays out so it can only be a droppable target.
  const sortableIds = useMemo(
    () => rows.filter((r) => r.kind !== 'unassigned-root').map((r) => r.id),
    [rows]
  )

  const activeRow = useMemo(() => (activeId ? rows.find((r) => r.id === activeId) ?? null : null), [activeId, rows])

  // Custom collision detection — prefer the right-edge unnest-zone (pointer-based)
  // so it works under restrictToVerticalAxis where the active rect can't reach the
  // right edge. Falls back to closestCenter for normal targets.
  const collisionDetection: CollisionDetection = (args) => {
    const pointerHits = pointerWithin(args).filter((c) => c.id === '__unnest_zone__')
    if (pointerHits.length > 0) return pointerHits
    return closestCenter(args)
  }

  const toggleExpand = (key: string) => {
    setExpanded((m) => ({ ...m, [key]: m[key] === false }))
  }

  const onDragStart = (event: DragStartEvent) => {
    setActiveId(String(event.active.id))
    setOverInfo(null)
  }

  const onDragOver = (event: DragOverEvent) => {
    const { over, active, activatorEvent } = event
    if (!over) {
      setOverInfo(null)
      return
    }
    const overId = String(over.id)
    if (overId === String(active.id)) {
      setOverInfo(null)
      return
    }
    const overType = over.data.current?.type as string | undefined
    if (overType === 'unnest-zone') {
      setOverInfo({ id: overId, position: 'inside' })
      return
    }
    const isUnassignedDroppable = overId === '__unassigned__' || overId === '__droppable_unassigned__'
    if (isUnassignedDroppable) {
      setOverInfo({ id: overId, position: 'inside' })
      return
    }
    const rect = over.rect
    const pointerY = (activatorEvent as PointerEvent | undefined)?.clientY
    const deltaY = (event as unknown as { delta?: { y: number } }).delta?.y ?? 0
    const cursorY = (pointerY ?? rect.top) + deltaY
    const midpoint = rect.top + rect.height / 2
    if (overType === 'group') {
      // Top half = before, bottom half = inside.
      const position: DropPosition = cursorY < midpoint ? 'before' : 'inside'
      setOverInfo({ id: overId, position })
      return
    }
    // session row
    const position: DropPosition = cursorY < midpoint ? 'before' : 'after'
    setOverInfo({ id: overId, position })
  }

  const onDragEnd = async (event: DragEndEvent) => {
    const finalOver = overInfo
    setActiveId(null)
    setOverInfo(null)
    if (!sortedSessions) return
    const action = routeDragEnd({
      active: event.active,
      over: event.over,
      overPosition: finalOver?.position,
      sessions: sortedSessions,
      groups: groups ?? [],
    })
    switch (action.kind) {
      case 'noop':
        return
      case 'reorder-within-group':
        await reorderWithinGroup(action.groupId, action.oldIndex, action.newIndex)
        break
      case 'move-session-to-group':
        await moveSessionToGroup(action.sessionId, action.targetGroupId, action.insertIndex)
        break
      case 'reorder-groups':
        await reorderGroups(action.oldIndex, action.newIndex)
        break
      case 'reorder-group-in-parent':
        await reorderChildGroups(action.parentId, action.oldIndex, action.newIndex)
        break
      case 'reparent-group':
        await updateGroup(action.groupId, { parentId: action.newParentId })
        if (typeof action.insertIndex === 'number') {
          await reorderGroups(action.insertIndex, action.insertIndex)
        }
        break
    }
    refetch()
  }

  const onDragCancel = () => {
    setActiveId(null)
    setOverInfo(null)
  }

  const handleCreateGroup = () => {
    void NiceModal.show('create-group')
  }
  const routerState = useRouterState()

  const dropIndicatorFor = (rowId: string): DropPosition | null => {
    if (!overInfo || overInfo.id !== rowId) return null
    return overInfo.position
  }

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
        collisionDetection={collisionDetection}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        onDragCancel={onDragCancel}
      >
        {sortedSessions && (
          <SortableContext items={sortableIds}>
            <div
              style={{
                position: 'relative',
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                minHeight: 0,
              }}
            >
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
                    return (
                      <GroupNode
                        row={row}
                        onToggle={() => toggleExpand(row.id)}
                        dropIndicator={dropIndicatorFor(row.id)}
                      />
                    )
                  }
                  return (
                    <SortableSessionRow
                      id={row.id}
                      depth={row.depth}
                      dropIndicator={dropIndicatorFor(row.id)}
                    >
                      <SessionItem
                        selected={routerState.location.pathname === `/session/${row.session.id}`}
                        session={row.session}
                      />
                    </SortableSessionRow>
                  )
                }}
              />
              {activeId !== null && <UnnestZone isActive={overInfo?.id === '__unnest_zone__'} />}
            </div>
          </SortableContext>
        )}
        <DragOverlay dropAnimation={null}>
          {activeRow?.kind === 'session' ? (
            <div style={{ paddingLeft: activeRow.depth * 18 }}>
              <SessionItem isOverlay selected={false} session={activeRow.session} />
            </div>
          ) : activeRow?.kind === 'group' ? (
            <GroupNode isOverlay row={activeRow} onToggle={() => {}} />
          ) : null}
        </DragOverlay>
      </DndContext>
    </>
  )
}

function SortableSessionRow(props: {
  id: string
  depth: number
  dropIndicator: DropPosition | null
  children?: React.ReactNode
}) {
  const { id, depth, dropIndicator, children } = props
  const { attributes, listeners, setNodeRef, isDragging } = useSortable({
    id,
    data: { type: 'session' },
  })
  return (
    <div
      ref={setNodeRef}
      className="relative"
      style={{ paddingLeft: depth * 18, opacity: isDragging ? 0.4 : 1 }}
      {...attributes}
      {...listeners}
    >
      {dropIndicator === 'before' && (
        <div className="absolute left-2 right-2 top-0 h-[2px] bg-[var(--mantine-color-chatbox-brand-filled)] pointer-events-none z-10" />
      )}
      {children}
      {dropIndicator === 'after' && (
        <div className="absolute left-2 right-2 bottom-0 h-[2px] bg-[var(--mantine-color-chatbox-brand-filled)] pointer-events-none z-10" />
      )}
    </div>
  )
}

function UnnestZone({ isActive }: { isActive: boolean }) {
  const { setNodeRef } = useDroppable({
    id: '__unnest_zone__',
    data: { type: 'unnest-zone' },
  })
  return (
    <div
      ref={setNodeRef}
      style={{
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        width: 14,
        zIndex: 5,
        pointerEvents: 'auto',
      }}
    >
      {isActive && (
        <div
          className="absolute top-0 bottom-0 right-0 w-[2px] bg-[var(--mantine-color-chatbox-brand-filled)] pointer-events-none"
        />
      )}
    </div>
  )
}
