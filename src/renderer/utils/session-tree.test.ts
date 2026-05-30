import { SESSION_MANAGER_ID } from '@shared/defaults'
import type { SessionGroup, SessionMeta } from '@shared/types'
import { describe, expect, it } from 'vitest'
import { buildFlatTree } from './session-tree'

const meta = (overrides: Partial<SessionMeta> & { system?: boolean } = {}): SessionMeta =>
  ({
    id: overrides.id ?? 'sess',
    name: overrides.name ?? 'sess',
    ...overrides,
  }) as SessionMeta

const group = (overrides: Partial<SessionGroup> & { id: string }): SessionGroup => ({
  name: overrides.name ?? `g-${overrides.id}`,
  parentId: overrides.parentId ?? null,
  sortIndex: overrides.sortIndex ?? 0,
  createdAt: overrides.createdAt ?? 0,
  updatedAt: overrides.updatedAt ?? 0,
  ...overrides,
})

describe('buildFlatTree', () => {
  it('emits only unassigned-root + sessions when no groups exist', () => {
    const sessions = [meta({ id: 'a' }), meta({ id: 'b' }), meta({ id: 'c' })]
    const rows = buildFlatTree([], sessions, {})

    expect(rows).toHaveLength(4)
    expect(rows[0]).toMatchObject({ kind: 'unassigned-root', id: '__unassigned__', depth: 0, childCount: 3 })
    expect(rows.slice(1).map((r) => ({ kind: r.kind, id: r.id, depth: r.depth }))).toEqual([
      // sortSessions reverses normal sessions: c, b, a
      { kind: 'session', id: 'c', depth: 1 },
      { kind: 'session', id: 'b', depth: 1 },
      { kind: 'session', id: 'a', depth: 1 },
    ])
  })

  it('renders groups before unassigned-root, with correct depth', () => {
    const groups = [group({ id: 'group:1', sortIndex: 0 }), group({ id: 'group:2', sortIndex: 1 })]
    const sessions = [
      meta({ id: 's1', groupId: 'group:1' }),
      meta({ id: 's2', groupId: 'group:1' }),
      meta({ id: 's3', groupId: 'group:2' }),
      meta({ id: 's4', groupId: 'group:2' }),
      meta({ id: 's5' }),
    ]
    const rows = buildFlatTree(groups, sessions, {})

    const summary = rows.map((r) => ({ kind: r.kind, id: r.id, depth: r.depth }))
    // group:1, its 2 sessions, group:2, its 2 sessions, unassigned-root, 1 session
    expect(summary).toEqual([
      { kind: 'group', id: 'group:1', depth: 0 },
      { kind: 'session', id: 's2', depth: 1 },
      { kind: 'session', id: 's1', depth: 1 },
      { kind: 'group', id: 'group:2', depth: 0 },
      { kind: 'session', id: 's4', depth: 1 },
      { kind: 'session', id: 's3', depth: 1 },
      { kind: 'unassigned-root', id: '__unassigned__', depth: 0 },
      { kind: 'session', id: 's5', depth: 1 },
    ])
  })

  it('omits children when group is collapsed', () => {
    const groups = [group({ id: 'group:1', sortIndex: 0 })]
    const sessions = [meta({ id: 's1', groupId: 'group:1' }), meta({ id: 's2', groupId: 'group:1' })]
    const rows = buildFlatTree(groups, sessions, { 'group:1': false })

    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ kind: 'group', id: 'group:1', expanded: false, childCount: 2 })
    expect(rows[1]).toMatchObject({ kind: 'unassigned-root' })
  })

  it('filters out system sessions completely', () => {
    const groups = [group({ id: 'group:1', sortIndex: 0 })]
    const sessions = [
      meta({ id: SESSION_MANAGER_ID, name: 'manager' }),
      meta({ id: 'flagged', system: true }),
      meta({ id: 'flagged-in-group', system: true, groupId: 'group:1' }),
      meta({ id: 'normal' }),
    ]
    const rows = buildFlatTree(groups, sessions, {})

    const sessionIds = rows.filter((r) => r.kind === 'session').map((r) => r.id)
    expect(sessionIds).toEqual(['normal'])
    // group should still appear, but with childCount=0 since the only candidate was system-flagged
    const groupRow = rows.find((r) => r.kind === 'group')
    expect(groupRow).toMatchObject({ kind: 'group', id: 'group:1', childCount: 0 })
  })

  it('orders groups by sortIndex even when input array is reversed', () => {
    const groups = [group({ id: 'group:b', sortIndex: 1 }), group({ id: 'group:a', sortIndex: 0 })]
    const rows = buildFlatTree(groups, [], {})
    const groupIds = rows.filter((r) => r.kind === 'group').map((r) => r.id)
    expect(groupIds).toEqual(['group:a', 'group:b'])
  })

  it('uses group sortIndex on sessions when present, then falls back to sortSessions', () => {
    const groups = [group({ id: 'group:1', sortIndex: 0 })]
    const sessions = [
      meta({ id: 's-noidx-1', groupId: 'group:1' }),
      meta({ id: 's-idx-1', groupId: 'group:1', sortIndex: 1 }),
      meta({ id: 's-idx-0', groupId: 'group:1', sortIndex: 0 }),
      meta({ id: 's-noidx-2', groupId: 'group:1' }),
    ]
    const rows = buildFlatTree(groups, sessions, {})
    const sessionIds = rows.filter((r) => r.kind === 'session').map((r) => r.id)
    // sorted by sortIndex first; the others come after via sortSessions (reverse-chronological)
    expect(sessionIds.slice(0, 2)).toEqual(['s-idx-0', 's-idx-1'])
    expect(sessionIds.slice(2)).toEqual(['s-noidx-2', 's-noidx-1'])
  })

  it('falls sessions referencing a missing group back to Unassigned (no silent drop)', () => {
    const groups = [group({ id: 'group:1', sortIndex: 0 })]
    const sessions = [
      meta({ id: 'orphan', groupId: 'group:deleted' }),
      meta({ id: 'in-known', groupId: 'group:1' }),
      meta({ id: 'plain' }),
    ]
    const rows = buildFlatTree(groups, sessions, {})
    const unassignedSessions = rows
      .slice(rows.findIndex((r) => r.kind === 'unassigned-root'))
      .filter((r) => r.kind === 'session')
      .map((r) => r.id)
    expect(unassignedSessions).toContain('orphan')
    expect(unassignedSessions).toContain('plain')
    const knownGroup = rows.find((r) => r.kind === 'group' && r.id === 'group:1')
    expect(knownGroup).toMatchObject({ childCount: 1 })
  })

  it('renders one root with two children + sessions in each at the right depths', () => {
    const groups = [
      group({ id: 'group:root', sortIndex: 0 }),
      group({ id: 'group:c1', parentId: 'group:root', sortIndex: 0 }),
      group({ id: 'group:c2', parentId: 'group:root', sortIndex: 1 }),
    ]
    const sessions = [
      meta({ id: 'sr', groupId: 'group:root' }),
      meta({ id: 'sc1', groupId: 'group:c1' }),
      meta({ id: 'sc2', groupId: 'group:c2' }),
    ]
    const rows = buildFlatTree(groups, sessions, {})
    const summary = rows
      .filter((r) => r.kind !== 'unassigned-root')
      .map((r) => ({ kind: r.kind, id: r.id, depth: r.depth }))
    expect(summary).toEqual([
      { kind: 'group', id: 'group:root', depth: 0 },
      { kind: 'session', id: 'sr', depth: 1 },
      { kind: 'group', id: 'group:c1', depth: 1 },
      { kind: 'session', id: 'sc1', depth: 2 },
      { kind: 'group', id: 'group:c2', depth: 1 },
      { kind: 'session', id: 'sc2', depth: 2 },
    ])
    const rootRow = rows.find((r) => r.kind === 'group' && r.id === 'group:root')
    expect(rootRow).toMatchObject({ childCount: 3 })
  })

  it('collapsed root hides its children and child sessions', () => {
    const groups = [
      group({ id: 'group:root', sortIndex: 0 }),
      group({ id: 'group:c1', parentId: 'group:root', sortIndex: 0 }),
    ]
    const sessions = [meta({ id: 'sc1', groupId: 'group:c1' })]
    const rows = buildFlatTree(groups, sessions, { 'group:root': false })
    const groupRows = rows.filter((r) => r.kind === 'group')
    expect(groupRows).toHaveLength(1)
    expect(groupRows[0]).toMatchObject({ id: 'group:root', expanded: false })
    expect(rows.filter((r) => r.kind === 'session')).toHaveLength(0)
  })

  it('child whose parentId points to a deleted group is rendered as a top-level root', () => {
    const groups = [
      group({ id: 'group:keeps', sortIndex: 0 }),
      group({ id: 'group:orphan', parentId: 'group:gone', sortIndex: 1 }),
    ]
    const rows = buildFlatTree(groups, [], {})
    const groupRows = rows.filter((r) => r.kind === 'group')
    expect(groupRows).toEqual([
      expect.objectContaining({ id: 'group:keeps', depth: 0 }),
      expect.objectContaining({ id: 'group:orphan', depth: 0 }),
    ])
  })

  it('mixed: 2 roots, one with a child, one without', () => {
    const groups = [
      group({ id: 'group:a', sortIndex: 0 }),
      group({ id: 'group:b', sortIndex: 1 }),
      group({ id: 'group:b1', parentId: 'group:b', sortIndex: 0 }),
    ]
    const rows = buildFlatTree(groups, [], {})
    const groupRows = rows
      .filter((r) => r.kind === 'group')
      .map((r) => ({ id: r.id, depth: r.depth }))
    expect(groupRows).toEqual([
      { id: 'group:a', depth: 0 },
      { id: 'group:b', depth: 0 },
      { id: 'group:b1', depth: 1 },
    ])
  })

  it('child depth survives a parent collapse + expand cycle', () => {
    const groups = [
      group({ id: 'group:p', sortIndex: 0 }),
      group({ id: 'group:c', parentId: 'group:p', sortIndex: 0 }),
    ]
    const sessions = [meta({ id: 'sc', groupId: 'group:c' })]

    // initial render — expanded by default
    const initial = buildFlatTree(groups, sessions, {})
    const initialChild = initial.find((r) => r.id === 'group:c')
    expect(initialChild).toMatchObject({ kind: 'group', depth: 1 })

    // collapse parent
    const collapsed = buildFlatTree(groups, sessions, { 'group:p': false })
    expect(collapsed.find((r) => r.id === 'group:c')).toBeUndefined()

    // re-expand parent — child must still be at depth 1
    const reExpanded = buildFlatTree(groups, sessions, { 'group:p': true })
    const reExpandedChild = reExpanded.find((r) => r.id === 'group:c')
    expect(reExpandedChild).toMatchObject({ kind: 'group', depth: 1 })
    const reExpandedSession = reExpanded.find((r) => r.id === 'sc')
    expect(reExpandedSession).toMatchObject({ kind: 'session', depth: 2 })
  })
})
