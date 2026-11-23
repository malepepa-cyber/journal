/**
 * Dateien in Text verwandeln – alles lokal im Browser, nichts verlässt den PC.
 * PDF: pdf.js (Text) und – für gescannte Seiten – Tesseract OCR (deutsch).
 * Word (.docx): mammoth. TXT: direkt. Fotos (JPG/PNG): OCR.
 */
import * as pdfjs from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker;

export type Progress = (p: { label: string; value: number }) => void;

import { itemsToLines, type PdfItem } from '../../../shared/pdflines.ts';
import { docToText } from '../../../shared/doc.ts';
export { itemsToLines };

let ocrWorker: Promise<any> | null = null;
async function getOcr(progress?: Progress) {
  if (!ocrWorker) {
    ocrWorker = (async () => {
      const { createWorker } = await import('tesseract.js');
      return createWorker('deu', 1, {
        workerPath: '/ocr/worker.min.js',
        corePath: '/ocr/core',
        langPath: '/ocr/lang',
        gzip: true,
        logger: (m: { status: string; progress: number }) => {
          if (m.status === 'recognizing text') progress?.({ label: 'Texterkennung (OCR) läuft …', value: m.progress });
        },
      });
    })();
    ocrWorker.catch(() => { ocrWorker = null; });
  }
  return ocrWorker;
}

async function ocrCanvas(canvas: HTMLCanvasElement | Blob, progress?: Progress): Promise<string> {
  const w = await getOcr(progress);
  const { data } = await w.recognize(canvas);
  return data.text as string;
}

export async function pdfToText(buf: ArrayBuffer, progress?: Progress): Promise<{ text: string; ocr: boolean; pages: number }> {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
  const out: string[] = [];
  let usedOcr = false;
  for (let i = 1; i <= doc.numPages; i++) {
    progress?.({ label: `Seite ${i} von ${doc.numPages} wird gelesen …`, value: (i - 1) / doc.numPages });
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    const lines = itemsToLines(tc.items as PdfItem[]);
    if (lines.join('').replace(/\s/g, '').length >= 40) { out.push(...lines, ''); continue; }
    // Kaum Text → gescannte Seite → OCR
    usedOcr = true;
    const viewport = page.getViewport({ scale: 2.2 });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width; canvas.height = viewport.height;
    await page.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport }).promise;
    progress?.({ label: `Seite ${i} von ${doc.numPages}: Texterkennung (OCR) …`, value: (i - 0.5) / doc.numPages });
    out.push(await ocrCanvas(canvas, (p) => progress?.({ label: `Seite ${i}/${doc.numPages}: ${p.label}`, value: (i - 1 + p.value) / doc.numPages })), '');
  }
  await doc.destroy();
  return { text: out.join('\n'), ocr: usedOcr, pages: doc.numPages };
}

export async function docxToText(buf: ArrayBuffer): Promise<string> {
  const mammoth = await import('mammoth/mammoth.browser.js');
  const r = await (mammoth as any).extractRawText({ arrayBuffer: buf });
  return String(r.value ?? '');
}

export type ImportKind = 'pdf' | 'docx' | 'doc' | 'txt' | 'image' | 'html';
export function kindOf(file: File): ImportKind | null {
  const n = file.name.toLowerCase();
  if (file.type === 'application/pdf' || n.endsWith('.pdf')) return 'pdf';
  if (n.endsWith('.docx')) return 'docx';
  if (n.endsWith('.doc') || file.type === 'application/msword') return 'doc';
  if (file.type === 'text/html' || /\.html?$/.test(n) || n.endsWith('.mhtml')) return 'html';
  if (file.type.startsWith('text/') || n.endsWith('.txt')) return 'txt';
  if (/^image\/(jpeg|png|webp|bmp)$/.test(file.type) || /\.(jpe?g|png|webp|bmp)$/.test(n)) return 'image';
  return null;
}

export async function fileToText(file: File, progress?: Progress): Promise<{ text: string; kind: ImportKind; ocr: boolean }> {
  const kind = kindOf(file);
  if (!kind) throw new Error('Dieses Dateiformat wird nicht unterstützt. Möglich sind PDF, gespeicherte Webseiten (.html), Word (.docx), TXT und Fotos (JPG/PNG).');
  if (file.size > 50 * 1024 * 1024) throw new Error('Die Datei ist zu groß (max. 50 MB).');
  if (kind === 'pdf') { const r = await pdfToText(await file.arrayBuffer(), progress); return { text: r.text, kind, ocr: r.ocr }; }
  if (kind === 'docx') { progress?.({ label: 'Word-Datei wird gelesen …', value: 0.5 }); return { text: await docxToText(await file.arrayBuffer()), kind, ocr: false }; }
  if (kind === 'html') {
    const raw = await file.text();
    return { text: /\.mhtml$/i.test(file.name) || /^MIME-Version:/im.test(raw.slice(0, 500)) ? mhtmlToHtml(raw) : raw, kind, ocr: false };
  }
  if (kind === 'txt') return { text: await file.text(), kind, ocr: false };
  if (kind === 'doc') { progress?.({ label: 'Ältere Word-Datei wird gelesen …', value: 0.5 }); return { text: docToText(new Uint8Array(await file.arrayBuffer())), kind, ocr: false }; }
  progress?.({ label: 'Texterkennung (OCR) wird vorbereitet …', value: 0.05 });
  return { text: await ocrCanvas(file, progress), kind, ocr: true };
}

/** „Webseite, Einzeldatei“ (.mhtml) → HTML des Hauptdokuments (quoted-printable dekodieren). */
export function mhtmlToHtml(raw: string): string {
  const boundary = raw.match(/boundary="?([^";\r\n]+)"?/i)?.[1];
  const parts = boundary ? raw.split(`--${boundary}`) : [raw];
  const part = parts.find((p) => /Content-Type:\s*text\/html/i.test(p)) ?? raw;
  const split = part.search(/\r?\n\r?\n/);
  const head = part.slice(0, split), body = part.slice(split).trim();
  if (!/quoted-printable/i.test(head)) return body;
  const bytes: number[] = [];
  const qp = body.replace(/=\r?\n/g, '');
  for (let i = 0; i < qp.length; i++) {
    if (qp[i] === '=' && /^[0-9A-F]{2}$/i.test(qp.slice(i + 1, i + 3))) { bytes.push(parseInt(qp.slice(i + 1, i + 3), 16)); i += 2; }
    else bytes.push(...new TextEncoder().encode(qp[i]));
  }
  return new TextDecoder('utf-8').decode(new Uint8Array(bytes));
}

/** Foto verkleinern (max. 1400 px, JPEG) – spart Speicher in der Datenbank. */
export async function resizePhoto(file: Blob): Promise<string> {
  const img = await createImageBitmap(file);
  const scale = Math.min(1, 1400 / Math.max(img.width, img.height));
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.85);
}
