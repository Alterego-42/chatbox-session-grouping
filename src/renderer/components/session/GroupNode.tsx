import { ActionIcon, Flex, Menu, Text, TextInput } from '@mantine/core'
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
import { type KeyboardEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { deleteGroup, updateGroup } from '@/stores/groupStore'
import { router } from '@/router'
import type { FlatRow } from '@/utils/session-tree'

export interface GroupNodeProps {
  row: Extract<FlatRow, { kind: 'group' } | { kind: 'unassigned-root' }>
  onToggle: () => void
}

export default function GroupNode({ row, onToggle }: GroupNodeProps) {
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

  const handleDelete = async () => {
    if (isUnassigned) return
    const confirmed = window.confirm(
      String(t('Delete group "{{name}}"? Sessions will be moved to Unassigned.', { name: row.group.name }))
    )
    if (confirmed) {
      await deleteGroup(row.group.id)
    }
  }

  return (
    <Flex
      align="center"
      gap={6}
      mx="xs"
      px="xs"
      py={6}
      className="cursor-pointer rounded-sm group/group-node hover:bg-chatbox-background-gray-secondary"
      style={{ paddingLeft: row.depth * 12 + 8 }}
      onClick={onToggle}
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

          <Menu
            position="bottom-start"
            opened={menuOpened}
            onChange={setMenuOpened}
            withinPortal
            closeOnItemClick
          >
            <Menu.Target>
              <ActionIcon
                variant="transparent"
                size={18}
                color="chatbox-tertiary"
                aria-label={t('Group actions')}
                className={menuOpened ? '' : 'group-hover/group-node:visible invisible'}
                onClick={(e) => {
                  e.stopPropagation()
                  setMenuOpened((v) => !v)
                }}
              >
                <IconDots size={14} />
              </ActionIcon>
            </Menu.Target>
            <Menu.Dropdown onClick={(e) => e.stopPropagation()}>
              <Menu.Item
                leftSection={<IconPencil size={14} />}
                onClick={() => {
                  setDraftName(row.group.name)
                  setRenaming(true)
                }}
              >
                {t('Rename group')}
              </Menu.Item>
              <Menu.Item
                leftSection={<IconTrash size={14} />}
                color="red"
                onClick={() => void handleDelete()}
              >
                {t('Delete group')}
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        </>
      )}
    </Flex>
  )
}
