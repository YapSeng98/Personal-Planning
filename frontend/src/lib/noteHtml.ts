/** Notes went from plain-text to rich HTML (bold/italic/lists/inline images).
    Old records hold plain text — `isHtml` (DrawingNote.format === 'html')
    says which one `raw` is; guessing from content is unreliable since plain
    text can itself contain '<word>'-shaped substrings (placeholders like
    <guid>, comparisons like a < b) that a heuristic would mistake for markup
    and silently swallow. */
export function toEditorHtml(raw: string, isHtml: boolean): string {
  if (isHtml) return raw
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>')
}
