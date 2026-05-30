import { SESSION_MANAGER_ID } from '@shared/defaults'
import type { SessionMeta } from '@shared/types'
import { describe, expect, it } from 'vitest'
import { isSystemSession, sortSessions } from './session-utils'

const meta = (overrides: Partial<SessionMeta> & { system?: boolean } = {}): SessionMeta =>
  ({
    id: overrides.id ?? 'sess-normal',
    name: overrides.name ?? 'normal',
    ...overrides,
  }) as SessionMeta

describe('isSystemSession', () => {
  it('returns true when id matches SESSION_MANAGER_ID', () => {
    expect(isSystemSession({ id: SESSION_MANAGER_ID })).toBe(true)
  })

  it('returns true when system flag is set', () => {
    expect(isSystemSession({ id: 'a-uuid', system: true })).toBe(true)
  })

  it('returns false for a normal uuid without system flag', () => {
    expect(isSystemSession({ id: '550e8400-e29b-41d4-a716-446655440000' })).toBe(false)
  })

  it('returns false when neither reserved id nor system flag is present', () => {
    expect(isSystemSession({ id: 'plain' })).toBe(false)
  })
})

describe('sortSessions', () => {
  it('drops sessions whose id is in RESERVED_SESSION_IDS', () => {
    const result = sortSessions([
      meta({ id: SESSION_MANAGER_ID, name: 'manager' }),
      meta({ id: 'a', name: 'a' }),
    ])
    expect(result.map((s) => s.id)).toEqual(['a'])
  })

  it('drops sessions with system: true', () => {
    const result = sortSessions([
      meta({ id: 'sys-1', name: 'sys', system: true }),
      meta({ id: 'a', name: 'a' }),
    ])
    expect(result.map((s) => s.id)).toEqual(['a'])
  })

  it('still drops hidden sessions', () => {
    const result = sortSessions([meta({ id: 'h', hidden: true }), meta({ id: 'a' })])
    expect(result.map((s) => s.id)).toEqual(['a'])
  })

  it('keeps starred sessions pinned at the front in original order', () => {
    const result = sortSessions([
      meta({ id: 'p1', starred: true }),
      meta({ id: 'n1' }),
      meta({ id: 'p2', starred: true }),
      meta({ id: 'n2' }),
    ])
    expect(result.map((s) => s.id)).toEqual(['p1', 'p2', 'n2', 'n1'])
  })

  it('reverses normal sessions', () => {
    const result = sortSessions([meta({ id: 'a' }), meta({ id: 'b' }), meta({ id: 'c' })])
    expect(result.map((s) => s.id)).toEqual(['c', 'b', 'a'])
  })
})
