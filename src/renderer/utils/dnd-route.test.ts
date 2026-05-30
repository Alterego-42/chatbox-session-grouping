import type { SessionGroup, SessionMeta } from '@shared/types'
import { describe, expect, test } from 'vitest'
import { routeDragEnd } from './dnd-route'

function group(id: string, sortIndex: number): SessionGroup {
  return { id, name: id, parentId: null, sortIndex, createdAt: 0, updatedAt: 0 }
}

function session(id: string, groupId: string | undefined, sortIndex?: number): SessionMeta {
  return {
    id,
    name: id,
    type: 'chat',
    groupId,
    sortIndex,
  } as unknown as SessionMeta
}

const groups: SessionGroup[] = [group('g1', 0), group('g2', 1), group('g3', 2)]
const sessions: SessionMeta[] = [
  session('s1a', 'g1', 0),
  session('s1b', 'g1', 1),
  session('s2a', 'g2', 0),
  session('su1', undefined, 0),
]

describe('routeDragEnd', () => {
  test('noop when no over', () => {
    const r = routeDragEnd({
      active: { id: 's1a', data: { current: { type: 'session' } } },
      over: null,
      sessions,
      groups,
    })
    expect(r.kind).toBe('noop')
  })

  test('noop when active === over', () => {
    const r = routeDragEnd({
      active: { id: 's1a', data: { current: { type: 'session' } } },
      over: { id: 's1a', data: { current: { type: 'session' } } },
      sessions,
      groups,
    })
    expect(r.kind).toBe('noop')
  })

  test('reorder within same group when both are sessions in same group', () => {
    const r = routeDragEnd({
      active: { id: 's1a', data: { current: { type: 'session' } } },
      over: { id: 's1b', data: { current: { type: 'session' } } },
      overPosition: 'after',
      sessions,
      groups,
    })
    expect(r).toEqual({ kind: 'reorder-within-group', groupId: 'g1', oldIndex: 0, newIndex: 1 })
  })

  test('move session into another group when dropping onto another group session', () => {
    const r = routeDragEnd({
      active: { id: 's1a', data: { current: { type: 'session' } } },
      over: { id: 's2a', data: { current: { type: 'session' } } },
      overPosition: 'before',
      sessions,
      groups,
    })
    expect(r).toEqual({
      kind: 'move-session-to-group',
      sessionId: 's1a',
      targetGroupId: 'g2',
      insertIndex: 0,
    })
  })

  test('move session onto empty group row by group droppable data', () => {
    const r = routeDragEnd({
      active: { id: 's1a', data: { current: { type: 'session' } } },
      over: { id: '__droppable_group_g3', data: { current: { type: 'group', groupId: 'g3' } } },
      sessions,
      groups,
    })
    expect(r).toEqual({
      kind: 'move-session-to-group',
      sessionId: 's1a',
      targetGroupId: 'g3',
      insertIndex: undefined,
    })
  })

  test('move session onto unassigned bucket via group droppable data', () => {
    const r = routeDragEnd({
      active: { id: 's1a', data: { current: { type: 'session' } } },
      over: { id: '__droppable_unassigned__', data: { current: { type: 'group', groupId: null } } },
      sessions,
      groups,
    })
    expect(r).toEqual({
      kind: 'move-session-to-group',
      sessionId: 's1a',
      targetGroupId: null,
      insertIndex: undefined,
    })
  })

  test('noop when dropping session onto its own group row', () => {
    const r = routeDragEnd({
      active: { id: 's1a', data: { current: { type: 'session' } } },
      over: { id: '__droppable_group_g1', data: { current: { type: 'group', groupId: 'g1' } } },
      sessions,
      groups,
    })
    expect(r.kind).toBe('noop')
  })

  test('reorder groups when both active and over are group type', () => {
    const r = routeDragEnd({
      active: { id: 'g1', data: { current: { type: 'group', groupId: 'g1' } } },
      over: { id: 'g3', data: { current: { type: 'group', groupId: 'g3' } } },
      overPosition: 'after',
      sessions,
      groups,
    })
    expect(r).toEqual({ kind: 'reorder-groups', oldIndex: 0, newIndex: 2 })
  })

  test('session-on-group with position inside moves into that group', () => {
    const r = routeDragEnd({
      active: { id: 's1a', data: { current: { type: 'session' } } },
      over: { id: 'g2', data: { current: { type: 'group', groupId: 'g2' } } },
      overPosition: 'inside',
      sessions,
      groups,
    })
    expect(r).toEqual({
      kind: 'move-session-to-group',
      sessionId: 's1a',
      targetGroupId: 'g2',
      insertIndex: undefined,
    })
  })

  test('group-on-group with position before reorders to overIndex (compensated)', () => {
    const r = routeDragEnd({
      active: { id: 'g1', data: { current: { type: 'group', groupId: 'g1' } } },
      over: { id: 'g3', data: { current: { type: 'group', groupId: 'g3' } } },
      overPosition: 'before',
      sessions,
      groups,
    })
    expect(r).toEqual({ kind: 'reorder-groups', oldIndex: 0, newIndex: 1 })
  })

  test('root onto root inside reparents the active group as a child', () => {
    const r = routeDragEnd({
      active: { id: 'g1', data: { current: { type: 'group', groupId: 'g1' } } },
      over: { id: 'g2', data: { current: { type: 'group', groupId: 'g2' } } },
      overPosition: 'inside',
      sessions,
      groups,
    })
    expect(r).toEqual({ kind: 'reparent-group', groupId: 'g1', newParentId: 'g2', insertIndex: undefined })
  })

  test('root onto root inside is rejected when active already owns children', () => {
    const nestedGroups: SessionGroup[] = [
      group('g1', 0),
      group('g2', 1),
      { ...group('child-of-g1', 2), parentId: 'g1' },
    ]
    const r = routeDragEnd({
      active: { id: 'g1', data: { current: { type: 'group', groupId: 'g1' } } },
      over: { id: 'g2', data: { current: { type: 'group', groupId: 'g2' } } },
      overPosition: 'inside',
      sessions,
      groups: nestedGroups,
    })
    expect(r.kind).toBe('noop')
  })

  test('root onto child inside is rejected (would create depth > 1)', () => {
    const nestedGroups: SessionGroup[] = [
      group('g1', 0),
      group('g2', 1),
      { ...group('c1', 2), parentId: 'g2' },
    ]
    const r = routeDragEnd({
      active: { id: 'g1', data: { current: { type: 'group', groupId: 'g1' } } },
      over: { id: 'c1', data: { current: { type: 'group', groupId: 'c1' } } },
      overPosition: 'inside',
      sessions,
      groups: nestedGroups,
    })
    expect(r.kind).toBe('noop')
  })

  test('child onto a different root inside reparents to the new root', () => {
    const nestedGroups: SessionGroup[] = [
      group('g1', 0),
      group('g2', 1),
      { ...group('c1', 2), parentId: 'g1' },
    ]
    const r = routeDragEnd({
      active: { id: 'c1', data: { current: { type: 'group', groupId: 'c1' } } },
      over: { id: 'g2', data: { current: { type: 'group', groupId: 'g2' } } },
      overPosition: 'inside',
      sessions,
      groups: nestedGroups,
    })
    expect(r).toEqual({ kind: 'reparent-group', groupId: 'c1', newParentId: 'g2', insertIndex: undefined })
  })

  test('child onto a root with position before un-nests and reorders among roots', () => {
    const nestedGroups: SessionGroup[] = [
      group('g1', 0),
      group('g2', 1),
      { ...group('c1', 2), parentId: 'g1' },
    ]
    const r = routeDragEnd({
      active: { id: 'c1', data: { current: { type: 'group', groupId: 'c1' } } },
      over: { id: 'g2', data: { current: { type: 'group', groupId: 'g2' } } },
      overPosition: 'before',
      sessions,
      groups: nestedGroups,
    })
    // sortedRoots = [g1, g2]; overIndex of g2 = 1; insertIndex = 1
    expect(r).toEqual({ kind: 'reparent-group', groupId: 'c1', newParentId: null, insertIndex: 1 })
  })

  test('group inside itself is a noop (self-loop)', () => {
    const r = routeDragEnd({
      active: { id: 'g1', data: { current: { type: 'group', groupId: 'g1' } } },
      over: { id: 'g1', data: { current: { type: 'group', groupId: 'g1' } } },
      overPosition: 'inside',
      sessions,
      groups,
    })
    expect(r.kind).toBe('noop')
  })

  test('child onto sibling child reorders within parent (before)', () => {
    const nestedGroups: SessionGroup[] = [
      group('root', 0),
      { ...group('a1', 0), parentId: 'root' },
      { ...group('a2', 1), parentId: 'root' },
      { ...group('a3', 2), parentId: 'root' },
    ]
    const r = routeDragEnd({
      active: { id: 'a3', data: { current: { type: 'group', groupId: 'a3' } } },
      over: { id: 'a1', data: { current: { type: 'group', groupId: 'a1' } } },
      overPosition: 'before',
      sessions: [],
      groups: nestedGroups,
    })
    // siblings sorted = [a1, a2, a3]; a3 (oldIndex 2) before a1 (overIndex 0) -> newIndex 0
    expect(r).toEqual({ kind: 'reorder-group-in-parent', parentId: 'root', oldIndex: 2, newIndex: 0 })
  })

  test('child onto sibling child reorders within parent (after, compensated)', () => {
    const nestedGroups: SessionGroup[] = [
      group('root', 0),
      { ...group('a1', 0), parentId: 'root' },
      { ...group('a2', 1), parentId: 'root' },
      { ...group('a3', 2), parentId: 'root' },
    ]
    const r = routeDragEnd({
      active: { id: 'a1', data: { current: { type: 'group', groupId: 'a1' } } },
      over: { id: 'a2', data: { current: { type: 'group', groupId: 'a2' } } },
      overPosition: 'after',
      sessions: [],
      groups: nestedGroups,
    })
    // a1 (oldIndex 0) after a2 (overIndex 1) -> raw newIndex = 2; oldIndex < newIndex -> -1 -> 1
    expect(r).toEqual({ kind: 'reorder-group-in-parent', parentId: 'root', oldIndex: 0, newIndex: 1 })
  })

  test('child group on unnest-zone reparents to null', () => {
    const nestedGroups: SessionGroup[] = [
      group('g1', 0),
      { ...group('c1', 1), parentId: 'g1' },
    ]
    const r = routeDragEnd({
      active: { id: 'c1', data: { current: { type: 'group', groupId: 'c1' } } },
      over: { id: '__unnest_zone__', data: { current: { type: 'unnest-zone' } } },
      sessions: [],
      groups: nestedGroups,
    })
    expect(r).toEqual({ kind: 'reparent-group', groupId: 'c1', newParentId: null, insertIndex: undefined })
  })

  test('root group on unnest-zone is a noop', () => {
    const r = routeDragEnd({
      active: { id: 'g1', data: { current: { type: 'group', groupId: 'g1' } } },
      over: { id: '__unnest_zone__', data: { current: { type: 'unnest-zone' } } },
      sessions,
      groups,
    })
    expect(r.kind).toBe('noop')
  })

  test('session in group on unnest-zone moves to Unassigned', () => {
    const r = routeDragEnd({
      active: { id: 's1a', data: { current: { type: 'session' } } },
      over: { id: '__unnest_zone__', data: { current: { type: 'unnest-zone' } } },
      sessions,
      groups,
    })
    expect(r).toEqual({
      kind: 'move-session-to-group',
      sessionId: 's1a',
      targetGroupId: null,
      insertIndex: undefined,
    })
  })

  test('unassigned session on unnest-zone is a noop', () => {
    const r = routeDragEnd({
      active: { id: 'su1', data: { current: { type: 'session' } } },
      over: { id: '__unnest_zone__', data: { current: { type: 'unnest-zone' } } },
      sessions,
      groups,
    })
    expect(r.kind).toBe('noop')
  })
})
