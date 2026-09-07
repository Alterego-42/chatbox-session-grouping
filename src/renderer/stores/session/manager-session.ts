import { createSessionMetaRecord } from '@chatbox/core/application/session'
import { SESSION_MANAGER_ID } from '@shared/defaults'
import type { Session } from '@shared/types'
import { rendererApplication } from '@/app/renderer-application'

/**
 * Ensure the persistent, system-managed "AI Manager" session exists.
 * Idempotent — safe to call on every launch. Written through the repository (not
 * `createSession`) because the id is reserved and must stay stable across installs.
 * `hidden: true` keeps it out of every normal list/page; the sidebar pin surfaces it.
 */
export async function ensureManagerSession(): Promise<void> {
  const repository = rendererApplication.sessions.repository
  await rendererApplication.sessions.initialize()
  const existing = await repository.getSession(SESSION_MANAGER_ID)
  if (!existing) {
    const session: Session = {
      id: SESSION_MANAGER_ID,
      name: 'AI Manager',
      type: 'chat',
      system: true,
      hidden: true,
      messages: [],
      settings: {},
    }
    await repository.setSession(session)
  }
  const existingMeta = await repository.meta.getById(SESSION_MANAGER_ID)
  if (!existingMeta) {
    const now = Date.now()
    const base = existing ?? { id: SESSION_MANAGER_ID, name: 'AI Manager', type: 'chat' as const, messages: [] }
    await repository.meta.create(createSessionMetaRecord({ ...base, system: true, hidden: true }, now, now))
  }
}
