/**
 * Ältere Word-Dateien (.doc, Word 97–2003): Text nach bestem Vermögen herauslesen.
 * Word speichert Text als 8-Bit- oder UTF-16-Zeichenfolgen; wir sammeln lesbare Abschnitte.
 * Ergebnis bitte prüfen – besser ist das Speichern als .docx oder PDF.
 */
export function docToText(bytes: Uint8Array): string {
  const runs = (decode: (i: number) => [string, number]) => {
    const out: string[] = []; let cur = '';
    for (let i = 0; i < bytes.length;) {
      const [ch, step] = decode(i); i += step;
      if (/[A-Za-zÄÖÜäöüßÀ-ÿ0-9 .,;:!?()%°½¼¾\/\-–'"„“&+]/.test(ch)) cur += ch;
      else if (ch === '\r' || ch === '\n' || ch === '\v') { if (cur.trim()) out.push(cur); cur = ''; }
      else { if (cur.trim().length >= 3) out.push(cur); cur = ''; }
    }
    if (cur.trim()) out.push(cur);
    return out.map((l) => l.trim()).filter((l) => l.length >= 2 && (l.match(/[A-Za-zÄÖÜäöüß]/g)?.length ?? 0) >= l.length * 0.4);
  };
  const cp1252 = new TextDecoder('windows-1252');
  const a = runs((i) => [cp1252.decode(bytes.subarray(i, i + 1)), 1]);
  // UTF-16: Text kann an gerader oder ungerader Byte-Position beginnen
  const u16 = (start: number) => runs((i) => (i < start ? ['\u0000', 1] : [String.fromCharCode(bytes[i] | ((bytes[i + 1] ?? 0) << 8)), 2]));
  const candidates = [a, u16(0), u16(1)];
  const score = (l: string[]) => l.reduce((n, x) => n + (x.match(/[A-Za-zÄÖÜäöüß]/g)?.length ?? 0), 0);
  return candidates.sort((x, y) => score(y) - score(x))[0].join('\n');
}

