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
})
