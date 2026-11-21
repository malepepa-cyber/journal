// PDF → Text (für Rezepte, die als PDF gespeichert wurden, z. B. über
// "Drucken → Als PDF speichern" im Zaubertopf Club).
// Nutzt pdf.js (Mozilla, Apache-2.0). In der PC-Version ist pdf.js in die
// HTML-Datei eingebettet, in der Server-Version liegt es unter vendor/.

let loading = null;

function blobUrlFrom(id) {
  const el = document.getElementById(id);
  if (!el) return null;
  return URL.createObjectURL(new Blob([el.textContent], { type: 'text/javascript' }));
}

export function loadPdfJs() {
  if (globalThis.pdfjsLib) return Promise.resolve(globalThis.pdfjsLib);
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = blobUrlFrom('pdfjs-lib') || 'vendor/pdf.min.js';
    s.onload = () => {
      const lib = globalThis.pdfjsLib;
      if (!lib) return reject(new Error('PDF-Leser konnte nicht geladen werden'));
      lib.GlobalWorkerOptions.workerSrc = blobUrlFrom('pdfjs-worker') || 'vendor/pdf.worker.min.js';
      resolve(lib);
    };
    s.onerror = () => { loading = null; reject(new Error('PDF-Leser konnte nicht geladen werden')); };
    document.head.appendChild(s);
  });
  return loading;
}

/**
 * Baut aus den Textstücken einer Seite Zeilen. Die Reihenfolge im PDF
 * (Lesereihenfolge) bleibt erhalten – wichtig bei zweispaltigen Layouts.
 */
export function itemsToLines(items) {
  // Leerzeilen bleiben erhalten: Sie trennen im PDF z. B. einzelne Zutaten,
  // während ein Zeilenumbruch innerhalb einer Zutat keine Leerzeile erzeugt.
  const lines = [];
  let cur = '', lastY = null, lastEnd = null;
  for (const it of items) {
    if (typeof it.str !== 'string') continue;
    const x = it.transform?.[4] ?? 0, y = it.transform?.[5] ?? 0;
    const h = Math.abs(it.transform?.[3] ?? it.height ?? 10) || 10;
    if (cur && lastY !== null && Math.abs(y - lastY) > h * 0.5) {
      lines.push(cur); cur = ''; lastEnd = null;
    }
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

/** Liest den gesamten Text einer PDF-Datei (ArrayBuffer). */
export async function pdfToText(data) {
  const lib = await loadPdfJs();
  // isEvalSupported:false – sicherer bei manipulierten PDFs
  const doc = await lib.getDocument({ data: new Uint8Array(data), isEvalSupported: false }).promise;
  const out = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    out.push(...itemsToLines(tc.items), '');
  }
  await doc.destroy();
  return out.join('\n');
}
