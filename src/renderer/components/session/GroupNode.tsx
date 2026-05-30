import { useDroppable } from '@dnd-kit/core'
import { useSortable } from '@dnd-kit/sortable'
import { ActionIcon, Flex, Text, TextInput } from '@mantine/core'
import {
  IconChevronDown,
  IconChevronRight,
  IconDots,
  IconFolder,
  IconInbox,
  IconPencil,
  IconPlus,
  IconTrash,
} from '@tabler/icons-react'
import clsx from 'clsx'
import { type KeyboardEvent, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import ActionMenu, { type ActionMenuItemProps } from '@/components/ActionMenu'
import { router } from '@/router'
import { deleteGroup, updateGroup } from '@/stores/groupStore'
import type { FlatRow } from '@/utils/session-tree'

export interface GroupNodeProps {
  row: Extract<FlatRow, { kind: 'group' } | { kind: 'unassigned-root' }>
  onToggle: () => void
  isOverlay?: boolean
  dropIndicator?: 'before' | 'after' | 'inside' | null
}

export default function GroupNode({ row, onToggle, isOverlay = false, dropIndicator = null }: GroupNodeProps) {
  const isUnassignedRow = row.kind === 'unassigned-root'
  const dropId = isUnassignedRow ? '__droppable_unassigned__' : `__droppable_group_${row.id}`
  const groupIdForData = isUnassignedRow ? null : row.group.id

  // Hooks must always run in the same order; `disabled` differentiates roles.
  const droppable = useDroppable({
    id: dropId,
    disabled: !isUnassignedRow || isOverlay,
    data: { type: 'group', groupId: null as string | null },
  })
  const sortable = useSortable({
    id: row.id,
    disabled: isUnassignedRow || isOverlay,
    data: { type: 'group', groupId: groupIdForData },
  })

  const setNodeRef = isOverlay ? () => {} : isUnassignedRow ? droppable.setNodeRef : sortable.setNodeRef
  const dragAttributes = isUnassignedRow || isOverlay ? {} : sortable.attributes
  const dragListeners = isUnassignedRow || isOverlay ? {} : (sortable.listeners ?? {})

  return (
    <GroupNodeInner
      row={row}
      onToggle={onToggle}
      setNodeRef={setNodeRef}
      dragAttributes={dragAttributes}
      dragListeners={dragListeners}
      isOverlay={isOverlay}
      dropIndicator={isOverlay ? null : dropIndicator}
    />
  )
}

interface InnerProps extends GroupNodeProps {
  setNodeRef: (el: HTMLElement | null) => void
  dragAttributes: Record<string, unknown>
  dragListeners: Record<string, unknown>
}

function GroupNodeInner({
  row,
  onToggle,
  setNodeRef,
  dragAttributes,
  dragListeners,
  isOverlay,
  dropIndicator,
}: InnerProps) {
  const { t } = useTranslation()
  const isUnassigned = row.kind === 'unassigned-root'
  const [renaming, setRenaming] = useState(false)
  const [draftName, setDraftName] = useState(isUnassigned ? '' : row.group.name)
  const [menuOpened, setMenuOpened] = useState(false)

  const label = isUnassigned ? t('Unassigned') : row.group.name
  const FolderIcon = isUnassigned ? IconInbox : IconFolder
  const ChevronIcon = row.expanded ? IconChevronDown : IconChevronRight

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation()
    onToggle()
  }

  const handleNewChat = (e: React.MouseEvent) => {
    e.stopPropagation()
    router.navigate({
      to: '/',
      search: { groupId: isUnassigned ? undefined : row.group.id },
    })
  }

  const commitRename = async () => {
    if (isUnassigned) return
    const next = draftName.trim()
    if (next && next !== row.group.name) {
      await updateGroup(row.group.id, { name: next })
    }
    setRenaming(false)
  }

  const cancelRename = () => {
    if (!isUnassigned) {
      setDraftName(row.group.name)
    }
    setRenaming(false)
  }

  const handleRenameKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      void commitRename()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      cancelRename()
    }
  }

  const actionMenuItems = useMemo<ActionMenuItemProps[]>(
    () =>
      isUnassigned
        ? []
        : [
            {
              text: t('Rename group'),
              icon: IconPencil,
              onClick: () => {
                setDraftName(row.group.name)
                setRenaming(true)
              },
            },
            { divider: true },
            {
              doubleCheck: true,
              text: t('Delete group'),
              icon: IconTrash,
              color: 'chatbox-error',
              onClick: () => {
                void deleteGroup(row.group.id)
              },
            },
          ],
    [isUnassigned, row, t]
  )

  return (
    <div className="relative">
      {dropIndicator === 'before' && (
        <div className="absolute left-2 right-2 top-0 h-[2px] bg-[var(--mantine-color-chatbox-brand-filled)] pointer-events-none z-10" />
      )}
      <Flex
        ref={setNodeRef}
        align="center"
        gap={6}
        mx="xs"
        px="xs"
        py={6}
        className={clsx(
          'cursor-pointer rounded-sm group/group-node',
          dropIndicator === 'inside'
            ? 'bg-chatbox-background-brand-secondary'
            : 'hover:bg-chatbox-background-gray-secondary',
          isOverlay && 'shadow-md opacity-90 bg-chatbox-background-primary'
        )}
        style={{ paddingLeft: row.depth * 12 + 8 }}
        onClick={onToggle}
        {...dragAttributes}
        {...dragListeners}
      >
      <ActionIcon
        variant="transparent"
        size={18}
        color="chatbox-tertiary"
        aria-label={row.expanded ? t('Collapse') : t('Expand')}
        onClick={handleToggle}
      >
        <ChevronIcon size={16} />
      </ActionIcon>

      <FolderIcon size={16} className="text-chatbox-tertiary shrink-0" />

      {renaming && !isUnassigned ? (
        <TextInput
          size="xs"
          value={draftName}
          autoFocus
          flex={1}
          onChange={(e) => setDraftName(e.currentTarget.value)}
          onBlur={() => void commitRename()}
          onKeyDown={handleRenameKey}
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <Text span flex={1} lineClamp={1} c="chatbox-primary">
          {label}{' '}
          <Text span c="chatbox-tertiary" size="xs">
            ({row.childCount})
          </Text>
        </Text>
      )}

      {!isUnassigned && !renaming && (
        <>
          <ActionIcon
            variant="transparent"
            size={18}
            color="chatbox-tertiary"
            aria-label={t('New chat in this group')}
            className={menuOpened ? '' : 'group-hover/group-node:visible invisible'}
            onClick={handleNewChat}
          >
            <IconPlus size={14} />
          </ActionIcon>

          <ActionMenu
            type="desktop"
            items={actionMenuItems}
            position="bottom-start"
            opened={menuOpened}
            onChange={setMenuOpened}
          >
            <ActionIcon
              variant="transparent"
              size={18}
              color="chatbox-tertiary"
              aria-label={t('Group actions')}
              className={menuOpened ? '' : 'group-hover/group-node:visible invisible'}
              onClick={(e) => {
                e.stopPropagation()
                e.preventDefault()
              }}
            >
              <IconDots size={14} />
            </ActionIcon>
          </ActionMenu>
        </>
      )}
    </Flex>
      {dropIndicator === 'after' && (
        <div className="absolute left-2 right-2 bottom-0 h-[2px] bg-[var(--mantine-color-chatbox-brand-filled)] pointer-events-none z-10" />
      )}
    </div>
  )
}
