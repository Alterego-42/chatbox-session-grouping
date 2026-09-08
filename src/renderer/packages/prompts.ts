import type { Message } from '@shared/types'
import { getMessageText } from '@shared/utils/message'

// Moved to shared so the native mobile shell reuses the exact same prompt logic.
export * from '@shared/prompts'

export function summarizeForUser(msgs: Message[], languageName: string, systemPromptTemplate?: string): Message[] {
  const transcript = msgs
    .map((m) => {
      const text = getMessageText(m, false, false)
      const role = m.role === 'assistant' ? 'Assistant' : m.role === 'user' ? 'User' : m.role
      return `[${role}]\n${text}`
    })
    .join('\n\n---------\n\n')

  const template =
    systemPromptTemplate && systemPromptTemplate.trim().length > 0
      ? systemPromptTemplate
      : DEFAULT_SUMMARY_FOR_USER_PROMPT
  const systemText = template.replace(/\{\{\s*languageName\s*\}\}/g, languageName)

  const userText = `Summarize the following conversation between User and Assistant.

\`\`\`
${transcript}
\`\`\``

  return [
    {
      id: `summary-system-${Date.now()}`,
      role: 'system',
      contentParts: [{ type: 'text', text: systemText }],
    },
    {
      id: `summary-user-${Date.now()}`,
      role: 'user',
      contentParts: [{ type: 'text', text: userText }],
    },
  ]
}

export const DEFAULT_SUMMARY_FOR_USER_PROMPT = `You write outcome-oriented summaries of chat conversations for the user who participated in them.

Respond in {{languageName}} using markdown with this exact structure:

**Topic:** <one sentence describing what the conversation was about>

**Key outcomes:**
- <a deliverable, decision, solved problem, or insight>
- <3-6 bullets total, each a concrete outcome — not a play-by-play>

**Open questions / next steps:** <only include this section if the conversation ends unresolved; otherwise omit it entirely>

Hard rules:
- Focus on what was produced, decided, or learned. Do NOT narrate the exchange ("the user asked", "the assistant replied", "then", "随后", "助手返回了" and equivalents in any language are forbidden).
- No TL;DR line — the Topic line replaces it.
- Stay strictly grounded in the transcript: do not invent facts, links, numbers, names, or quotations.
- No greetings, apologies, meta-commentary, or restating these instructions.`
