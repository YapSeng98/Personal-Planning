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

/** A note's words alone — no markup, no pictures (a pasted picture is a long
    run of encoded text inside the note that searches would otherwise match),
    entities decoded, whitespace collapsed. */
export function noteText(raw: string, isHtml: boolean): string {
  const text = isHtml
    ? raw.replace(/<img\b[^>]*>/gi, ' ').replace(/<(br|\/p|\/div|\/li|\/h\d)\b[^>]*>/gi, ' ').replace(/<[^>]*>/g, '')
    : raw
  return text
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ').trim()
}
