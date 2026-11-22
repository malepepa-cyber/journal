/** PDF-Textstücke (pdf.js) → Zeilen. Rein funktional, im Browser und in Node nutzbar. */
export interface PdfItem { str: string; transform: number[]; width: number; hasEOL?: boolean }

/** Textstücke → Zeilen (Leerzeilen trennen z. B. Zutaten; Umbrüche innerhalb einer Zutat nicht). */
export function itemsToLines(items: PdfItem[]): string[] {
  const lines: string[] = [];
  let cur = '', lastY: number | null = null, lastEnd: number | null = null;
  for (const it of items) {
    if (typeof it.str !== 'string') continue;
    const x = it.transform?.[4] ?? 0, y = it.transform?.[5] ?? 0;
    const h = Math.abs(it.transform?.[3] ?? 10) || 10;
    if (cur && lastY !== null && Math.abs(y - lastY) > h * 0.5) { lines.push(cur); cur = ''; lastEnd = null; }
    if (it.str || it.hasEOL) lastY = y;
    if (it.str) {
      const gap = lastEnd === null ? 0 : x - lastEnd;
      if (cur && !/\s$/.test(cur) && !/^\s/.test(it.str) && gap > h * 0.15) cur += ' ';
      cur += it.str;
      lastEnd = x + (it.width ?? 0);
    }
    if (it.hasEOL) { lines.push(cur); cur = ''; lastEnd = null; }
  }
  if (cur) lines.push(cur);
  return lines.map((l) => l.replace(/\s+/g, ' ').trim());
}

