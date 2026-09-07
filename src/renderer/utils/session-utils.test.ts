import { SESSION_MANAGER_ID } from '@shared/defaults'
import type { Message, Session, SessionMeta } from '@shared/types'
import { describe, expect, it } from 'vitest'
import { sortSessionRecords } from '@/storage/SessionMetaStorage'
import {
  createSessionMetaRecordsFromLegacyList,
  isSystemSession,
  recoverSessionOnLoad,
  sortSessions,
} from './session-utils'

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

function message(id: string, overrides: Partial<Message> = {}): Message {
  return { id, role: 'assistant', contentParts: [], ...overrides }
}

function session(messages: Message[]): Session {
  return { id: 'session', name: 'Session', type: 'chat', settings: {}, messages }
}

describe('recoverSessionOnLoad', () => {
  const bootTime = 1_000_000

  it('removes a blank stale assistant placeholder', () => {
    const result = recoverSessionOnLoad(
      session([
        message('user', { role: 'user' }),
        message('placeholder', { generating: true, timestamp: bootTime - 1 }),
      ]),
      bootTime
    )

    expect(result.recoveredStaleGeneration).toBe(true)
    expect(result.session.messages.map((item) => item.id)).toEqual(['user'])
  })

  it('keeps stale messages with content and marks them interrupted', () => {
    const partial = message('partial', {
      generating: true,
      timestamp: bootTime - 1,
      contentParts: [{ type: 'reasoning', text: 'working' }],
    })
    const toolCall = message('tool', {
      generating: true,
      timestamp: bootTime - 1,
      contentParts: [
        { type: 'tool-call', state: 'call', toolCallId: 'call', toolName: 'test', args: {}, startTime: bootTime - 10 },
      ],
    })

    const result = recoverSessionOnLoad(session([partial, toolCall]), bootTime)

    expect(result.session.messages[0]).toMatchObject({ id: 'partial', generating: false })
    expect(result.session.messages[1]).toMatchObject({
      id: 'tool',
      generating: false,
      contentParts: [{ type: 'tool-call', state: 'error' }],
    })
  })

  it('drops a stale blank placeholder uniformly now that the dispatch marker is gone', () => {
    const blank = message('blank', { generating: true, timestamp: bootTime - 1 })

    const result = recoverSessionOnLoad(session([blank]), bootTime)

    expect(result.session.messages).toHaveLength(0)
    expect(result.recoveredStaleGeneration).toBe(true)
  })

  it('recovers stale placeholders in threads and message forks', () => {
    const stale = message('stale', { generating: true, timestamp: bootTime - 1 })
    const active = message('active')
    const input: Session = {
      ...session([message('fork', { role: 'user' }), active]),
      threads: [{ id: 'thread', name: 'Thread', createdAt: 1, messages: [stale] }],
      messageForksHash: {
        fork: {
          position: 0,
          createdAt: 1,
          lists: [
            { id: 'active', messages: [] },
            { id: 'stale-alternative', messages: [stale] },
          ],
        },
      },
    }

    const result = recoverSessionOnLoad(input, bootTime)

    expect(result.session.threads?.[0].messages).toEqual([])
    expect(result.session.messageForksHash).toBeUndefined()
    expect(result.session.messages).toEqual([input.messages[0], active])
    expect(result.recoveredStaleGeneration).toBe(true)
  })

  it('removes only recovered empty alternatives and adjusts the active fork position', () => {
    const stale = message('stale', { generating: true, timestamp: bootTime - 1 })
    const saved = message('saved')
    const input: Session = {
      ...session([message('fork', { role: 'user' }), message('active')]),
      messageForksHash: {
        fork: {
          position: 1,
          createdAt: 1,
          lists: [
            { id: 'stale-alternative', messages: [stale] },
            { id: 'active', messages: [] },
            { id: 'saved-alternative', messages: [saved] },
          ],
        },
      },
    }

    const result = recoverSessionOnLoad(input, bootTime)

    expect(result.session.messageForksHash?.fork).toMatchObject({
      position: 0,
      lists: [
        { id: 'active', messages: [] },
        { id: 'saved-alternative', messages: [saved] },
      ],
    })
  })

  it('does not collapse an existing single-branch fork without stale recovery', () => {
    const input: Session = {
      ...session([message('fork', { role: 'user' }), message('active')]),
      messageForksHash: {
        fork: { position: 0, createdAt: 1, lists: [{ id: 'active', messages: [] }] },
      },
    }

    const result = recoverSessionOnLoad(input, bootTime)

    expect(result.recoveredStaleGeneration).toBe(false)
    expect(result.session.messageForksHash).toEqual(input.messageForksHash)
  })

  it('promotes and collapses a saved branch when recovery removes the active fork tail', () => {
    const pivot = message('fork', { role: 'user' })
    const stale = message('stale', { generating: true, timestamp: bootTime - 1 })
    const saved = message('saved')
    const input: Session = {
      ...session([pivot, stale]),
      messageForksHash: {
        [pivot.id]: {
          position: 0,
          createdAt: 1,
          lists: [
            { id: 'active', messages: [] },
            { id: 'saved-alternative', messages: [saved] },
          ],
        },
      },
    }

    const result = recoverSessionOnLoad(input, bootTime)

    expect(result.recoveredStaleGeneration).toBe(true)
    expect(result.session.messages).toEqual([pivot, saved])
    expect(result.session.messageForksHash).toBeUndefined()
  })

  it('promotes a saved branch inside a historical thread', () => {
    const pivot = message('thread-fork', { role: 'user' })
    const stale = message('thread-stale', { generating: true, timestamp: bootTime - 1 })
    const saved = message('thread-saved')
    const input: Session = {
      ...session([]),
      threads: [{ id: 'thread', name: 'Thread', createdAt: 1, messages: [pivot, stale] }],
      messageForksHash: {
        [pivot.id]: {
          position: 0,
          createdAt: 1,
          lists: [
            { id: 'active', messages: [] },
            { id: 'saved-alternative', messages: [saved] },
          ],
        },
      },
    }

    const result = recoverSessionOnLoad(input, bootTime)

    expect(result.session.threads?.[0].messages).toEqual([pivot, saved])
    expect(result.session.messageForksHash).toBeUndefined()
  })

  it('promotes a stale active fork nested inside another saved branch', () => {
    const outerPivot = message('outer-fork', { role: 'user' })
    const currentReply = message('outer-current')
    const innerPivot = message('inner-fork', { role: 'user' })
    const stale = message('inner-stale', { generating: true, timestamp: bootTime - 1 })
    const saved = message('inner-saved')
    const input: Session = {
      ...session([outerPivot, currentReply]),
      messageForksHash: {
        [outerPivot.id]: {
          position: 0,
          createdAt: 1,
          lists: [
            { id: 'outer-active', messages: [] },
            { id: 'outer-saved', messages: [innerPivot, stale] },
          ],
        },
        [innerPivot.id]: {
          position: 0,
          createdAt: 2,
          lists: [
            { id: 'inner-active', messages: [] },
            { id: 'inner-saved', messages: [saved] },
          ],
        },
      },
    }

    const result = recoverSessionOnLoad(input, bootTime)

    expect(result.session.messageForksHash?.[outerPivot.id].lists[1].messages).toEqual([innerPivot, saved])
    expect(result.session.messageForksHash?.[innerPivot.id]).toBeUndefined()
  })

  it('does not remove meaningful or current-process messages', () => {
    const user = message('user', { role: 'user', generating: true, timestamp: bootTime - 1 })
    const failed = message('failed', { generating: true, timestamp: bootTime - 1, error: 'request failed' })
    const current = message('current', { generating: true, timestamp: bootTime })

    const result = recoverSessionOnLoad(session([user, failed, current]), bootTime)

    expect(result.session.messages).toHaveLength(3)
    expect(result.session.messages[0].generating).toBe(false)
    expect(result.session.messages[1].generating).toBe(false)
    expect(result.session.messages[2]).toEqual(current)
  })
})

describe('sortSessions', () => {
  it('returns empty array for empty input', () => {
    expect(sortSessions([])).toEqual([])
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

  it('handles mixed pinned + regular + hidden sessions', () => {
    const result = sortSessions([
      meta({ id: 'r1' }),
      meta({ id: 'p1', starred: true }),
      meta({ id: 'h1', hidden: true }),
      meta({ id: 'r2' }),
      meta({ id: 'p2', starred: true }),
    ])
    expect(result.map((s) => s.id)).toEqual(['p1', 'p2', 'r2', 'r1'])
  })
})

describe('createSessionMetaRecordsFromLegacyList', () => {
  it('preserves legacy display order when records are sorted by sortOrder', () => {
    const justChat = { id: 'just-chat', name: 'Just chat', starred: true } as SessionMeta
    const markdown = { id: 'markdown', name: 'Markdown', starred: true } as SessionMeta
    const travel = { id: 'travel', name: 'Travel' } as SessionMeta
    const social = { id: 'social', name: 'Social' } as SessionMeta
    const software = { id: 'software', name: 'Software', starred: true } as SessionMeta
    const translator = { id: 'translator', name: 'Translator' } as SessionMeta

    const legacyList = [justChat, markdown, travel, social, software, translator]
    const records = createSessionMetaRecordsFromLegacyList(legacyList, 10_000)

    expect(sortSessionRecords(records).map((record) => record.id)).toEqual(
      sortSessions(legacyList).map((session) => session.id)
    )
    expect(sortSessionRecords(records).map((record) => record.id)).toEqual([
      'just-chat',
      'markdown',
      'software',
      'translator',
      'social',
      'travel',
    ])
  })

  it('preserves groupId / system / sortIndex on the produced records', () => {
    const grouped = { id: 'g1', name: 'Grouped', groupId: 'group:abc', sortIndex: 2 } as SessionMeta
    const records = createSessionMetaRecordsFromLegacyList([grouped], 10_000)
    expect(records[0].groupId).toBe('group:abc')
    expect(records[0].sortIndex).toBe(2)
  })
})
