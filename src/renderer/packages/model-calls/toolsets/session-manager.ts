import { tool, type ToolSet } from 'ai'
import z from 'zod'
import * as chatStore from '@/stores/chatStore'
import * as groupStore from '@/stores/groupStore'
import { applyProposal, noOpStrategy, type OrganizeProposal } from '@/stores/session/auto-organize'
import { duplicateGroup } from '@/stores/session/groups'
import { _copySession, moveSessionToGroup, reorderGroups } from '@/stores/sessionActions'

const toolSetDescription = `
Use these tools to organize the user's chat sidebar: list sessions/groups, move/rename/delete/duplicate them,
manage groups (including color, parent, and reordering), and propose auto-organization. Destructive operations
require user confirmation.
`

export interface ConfirmDangerousActionInput {
  type: string
  description: string
}

export type ConfirmDangerousFn = (action: ConfirmDangerousActionInput) => Promise<boolean>

const declined = { skipped: true as const, reason: 'user_declined' as const }

async function loadVisibleSessions() {
  const list = await chatStore.listSessionsMeta()
  return list.filter((s) => !s.system)
}

export function buildSessionManagerToolset(opts: { confirmDangerous: ConfirmDangerousFn }): {
  description: string
  tools: ToolSet
} {
  const { confirmDangerous } = opts

  const list_sessions = tool({
    description: 'List chat sessions visible in the sidebar. Optional filter by name substring or groupId.',
    inputSchema: z.object({
      query: z.string().optional().describe('Case-insensitive substring of session name.'),
      groupId: z.string().optional().describe('Restrict to sessions in this group id (exact match).'),
    }),
    execute: async (input: { query?: string; groupId?: string }) => {
      const sessions = await loadVisibleSessions()
      const q = input.query?.trim().toLowerCase()
      const filtered = sessions.filter((s) => {
        if (input.groupId !== undefined && (s.groupId ?? null) !== input.groupId) return false
        if (q && !s.name.toLowerCase().includes(q)) return false
        return true
      })
      return {
        ok: true,
        sessions: filtered.map((s) => ({
          id: s.id,
          name: s.name,
          groupId: s.groupId ?? null,
          sortIndex: s.sortIndex ?? null,
        })),
      }
    },
  })

  const list_groups = tool({
    description: 'List all sidebar groups with id, name, parentId, color, and sortIndex.',
    inputSchema: z.object({}),
    execute: async () => {
      const groups = await groupStore.listGroups()
      return {
        ok: true,
        groups: groups.map((g) => ({
          id: g.id,
          name: g.name,
          parentId: g.parentId,
          color: g.color ?? null,
          sortIndex: g.sortIndex,
        })),
      }
    },
  })

  const move_session = tool({
    description: 'Move a session into a target group, or to ungrouped when targetGroupId is null.',
    inputSchema: z.object({
      sessionId: z.string(),
      targetGroupId: z.string().nullable(),
      insertIndex: z.number().int().min(0).optional(),
    }),
    execute: async (input: { sessionId: string; targetGroupId: string | null; insertIndex?: number }) => {
      const session = await chatStore.getSession(input.sessionId)
      if (!session) return { ok: false, error: 'session not found' }
      await moveSessionToGroup(input.sessionId, input.targetGroupId, input.insertIndex)
      return { ok: true }
    },
  })

  const rename_session = tool({
    description: 'Rename a session.',
    inputSchema: z.object({ sessionId: z.string(), newName: z.string().min(1) }),
    execute: async (input: { sessionId: string; newName: string }) => {
      const session = await chatStore.getSession(input.sessionId)
      if (!session) return { ok: false, error: 'session not found' }
      await chatStore.updateSession(input.sessionId, (s) => {
        if (!s) throw new Error('session not found')
        return { ...s, name: input.newName }
      })
      return { ok: true }
    },
  })

  const duplicate_session = tool({
    description: 'Duplicate a session (messages copied). Returns the new session id.',
    inputSchema: z.object({ sessionId: z.string() }),
    execute: async (input: { sessionId: string }) => {
      const session = await chatStore.getSession(input.sessionId)
      if (!session) return { ok: false, error: 'session not found' }
      const sessions = await chatStore.listSessionsMeta()
      const meta = sessions.find((s) => s.id === input.sessionId)
      if (!meta) return { ok: false, error: 'session not found' }
      const created = await _copySession(meta)
      return { ok: true, newSessionId: created.id }
    },
  })

  const create_group = tool({
    description: 'Create a new sidebar group. Optional parentId (one nesting level) and hex color.',
    inputSchema: z.object({
      name: z.string().min(1),
      parentId: z.string().nullable().optional(),
      color: z.string().optional(),
    }),
    execute: async (input: { name: string; parentId?: string | null; color?: string }) => {
      try {
        const group = await groupStore.createGroup({
          name: input.name,
          parentId: input.parentId ?? null,
          color: input.color,
        })
        return { ok: true, group }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    },
  })

  const rename_group = tool({
    description: 'Rename a group.',
    inputSchema: z.object({ groupId: z.string(), newName: z.string().min(1) }),
    execute: async (input: { groupId: string; newName: string }) => {
      const groups = await groupStore.listGroups()
      if (!groups.find((g) => g.id === input.groupId)) return { ok: false, error: 'group not found' }
      try {
        await groupStore.updateGroup(input.groupId, { name: input.newName })
        return { ok: true }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    },
  })

  const reorder_group = tool({
    description: 'Reorder a group by setting its position in the sorted group list.',
    inputSchema: z.object({ groupId: z.string(), newSortIndex: z.number().int().min(0) }),
    execute: async (input: { groupId: string; newSortIndex: number }) => {
      const groups = await groupStore.listGroups()
      const sorted = [...groups].sort((a, b) => a.sortIndex - b.sortIndex)
      const currentIndex = sorted.findIndex((g) => g.id === input.groupId)
      if (currentIndex < 0) return { ok: false, error: 'group not found' }
      const target = Math.min(Math.max(input.newSortIndex, 0), sorted.length - 1)
      await reorderGroups(currentIndex, target)
      return { ok: true }
    },
  })

  const duplicate_group = tool({
    description: 'Duplicate a group, including its sessions and direct child groups.',
    inputSchema: z.object({ groupId: z.string() }),
    execute: async (input: { groupId: string }) => {
      try {
        const created = await duplicateGroup(input.groupId)
        return { ok: true, group: created }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    },
  })

  const set_group_color = tool({
    description: 'Set or clear a group color. Pass empty string or null to reset to default.',
    inputSchema: z.object({ groupId: z.string(), color: z.string().nullable() }),
    execute: async (input: { groupId: string; color: string | null }) => {
      const groups = await groupStore.listGroups()
      if (!groups.find((g) => g.id === input.groupId)) return { ok: false, error: 'group not found' }
      try {
        await groupStore.updateGroup(input.groupId, { color: input.color ? input.color : undefined })
        return { ok: true }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    },
  })

  const set_group_parent = tool({
    description: 'Set or clear a group parent (one nesting level only). Pass null to un-nest.',
    inputSchema: z.object({ groupId: z.string(), parentId: z.string().nullable() }),
    execute: async (input: { groupId: string; parentId: string | null }) => {
      const groups = await groupStore.listGroups()
      if (!groups.find((g) => g.id === input.groupId)) return { ok: false, error: 'group not found' }
      try {
        await groupStore.updateGroup(input.groupId, { parentId: input.parentId })
        return { ok: true }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    },
  })

  const bulk_move = tool({
    description: 'Move many sessions into a single group (or null for ungrouped).',
    inputSchema: z.object({
      sessionIds: z.array(z.string()).min(1),
      targetGroupId: z.string().nullable(),
    }),
    execute: async (input: { sessionIds: string[]; targetGroupId: string | null }) => {
      const moved: string[] = []
      const failed: Array<{ sessionId: string; error: string }> = []
      for (const id of input.sessionIds) {
        try {
          const session = await chatStore.getSession(id)
          if (!session) {
            failed.push({ sessionId: id, error: 'session not found' })
            continue
          }
          await moveSessionToGroup(id, input.targetGroupId)
          moved.push(id)
        } catch (err) {
          failed.push({ sessionId: id, error: err instanceof Error ? err.message : String(err) })
        }
      }
      return { ok: failed.length === 0, moved, failed }
    },
  })

  const delete_session = tool({
    description: 'Permanently delete a session. Requires user confirmation.',
    inputSchema: z.object({ sessionId: z.string() }),
    execute: async (input: { sessionId: string }) => {
      const session = await chatStore.getSession(input.sessionId)
      if (!session) return { ok: false, error: 'session not found' }
      const ok = await confirmDangerous({
        type: 'delete_session',
        description: `Delete session "${session.name}"? This cannot be undone.`,
      })
      if (!ok) return declined
      await chatStore.deleteSession(input.sessionId)
      return { ok: true }
    },
  })

  const delete_group = tool({
    description: 'Permanently delete a group; sessions inside it become ungrouped. Requires user confirmation.',
    inputSchema: z.object({ groupId: z.string() }),
    execute: async (input: { groupId: string }) => {
      const groups = await groupStore.listGroups()
      const target = groups.find((g) => g.id === input.groupId)
      if (!target) return { ok: false, error: 'group not found' }
      const ok = await confirmDangerous({
        type: 'delete_group',
        description: `Delete group "${target.name}"? Sessions inside become ungrouped. This cannot be undone.`,
      })
      if (!ok) return declined
      await groupStore.deleteGroup(input.groupId)
      return { ok: true }
    },
  })

  const apply_organize_proposal = tool({
    description: 'Apply an auto-organize proposal: create new groups and move sessions. Requires user confirmation.',
    inputSchema: z.object({
      proposal: z.object({
        moves: z.array(z.object({ sessionId: z.string(), targetGroupId: z.string().nullable() })),
        newGroups: z
          .array(
            z.object({
              tempId: z.string(),
              name: z.string(),
              parentId: z.string().nullable().optional(),
            })
          )
          .optional(),
        rationale: z.string().optional(),
      }),
    }),
    execute: async (input: { proposal: OrganizeProposal }) => {
      const moves = input.proposal.moves.length
      const adds = input.proposal.newGroups?.length ?? 0
      const ok = await confirmDangerous({
        type: 'apply_organize_proposal',
        description: `Apply auto-organize: ${moves} session move(s), ${adds} new group(s). This cannot be undone.`,
      })
      if (!ok) return declined
      try {
        await applyProposal(input.proposal)
        return { ok: true }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    },
  })

  const auto_organize = tool({
    description:
      'Generate an auto-organize proposal (no changes applied). Review the result, then call apply_organize_proposal to commit.',
    inputSchema: z.object({}),
    execute: async () => {
      const groups = await groupStore.listGroups()
      const sessions = await loadVisibleSessions()
      const proposal = await noOpStrategy.generate({ groups, sessions })
      return { ok: true, proposal }
    },
  })

  return {
    description: toolSetDescription,
    tools: {
      list_sessions,
      list_groups,
      move_session,
      rename_session,
      duplicate_session,
      create_group,
      rename_group,
      reorder_group,
      duplicate_group,
      set_group_color,
      set_group_parent,
      bulk_move,
      delete_session,
      delete_group,
      apply_organize_proposal,
      auto_organize,
    },
  }
}
