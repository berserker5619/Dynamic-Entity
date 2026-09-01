/**
 * A deliberately tiny markdown renderer for the demo.
 *
 * `MARKDOWN_RENDERER` takes any function from source to HTML, so the demo supplies its own
 * rather than pulling in a parser. That keeps the demo honest about the contract — the
 * library needs a function, not a particular library — and it lets the rendered path,
 * the Preview tab and sanitisation all be exercised end to end.
 *
 * **It escapes first.** `EXTENDING.md` says a renderer should escape raw HTML in its input
 * rather than leaning on Angular's sanitizer, because sanitizing strips markup *silently*:
 * an author who pastes a `<script>` is never told their content was altered. Escaping shows
 * them exactly what they typed. The sanitizer stays as the backstop it is meant to be.
 *
 * Supports headings, bold, italic and unordered lists. It is not a spec-compliant parser and
 * is not trying to be one; a real application would provide `marked` or `markdown-it` here.
 */
const escapeHtml = (raw: string): string =>
  raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const inline = (text: string): string =>
  text
    // Bold before italic: `**x**` would otherwise be read as an italic wrapping an italic.
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>');

export function renderMarkdown(source: string): string {
  const lines = escapeHtml(source).split('\n');
  const out: string[] = [];
  let list: string[] = [];

  const flushList = (): void => {
    if (!list.length) return;
    out.push(`<ul>${list.map(item => `<li>${inline(item)}</li>`).join('')}</ul>`);
    list = [];
  };

  for (const line of lines) {
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    const bullet = /^[-*]\s+(.*)$/.exec(line);

    if (heading) {
      flushList();
      const level = heading[1].length;
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
    } else if (bullet) {
      list.push(bullet[1]);
    } else if (line.trim() === '') {
      flushList();
    } else {
      flushList();
      out.push(`<p>${inline(line)}</p>`);
    }
  }

  flushList();
  return out.join('');
}
