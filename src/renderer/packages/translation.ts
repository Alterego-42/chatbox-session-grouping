/**
 * Temporary stub for the missing translation package in this working copy.
 * The real implementation calls the Chatbox translation service; this no-op
 * returns the input texts unchanged so the UI can render error tips.
 *
 * TODO(baseline): restore real implementation or remove the call site.
 */

export interface TranslateOptions {
  sourceLang?: string
}

export async function translateTexts(
  texts: string[],
  _targetLang: string,
  _options?: TranslateOptions
): Promise<string[]> {
  return texts
}
