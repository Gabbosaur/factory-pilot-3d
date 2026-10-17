'use client';
/**
 * Browser-side PDF text extraction (Req 16.1): only text goes to the server, so the Vercel
 * request body limit is never hit. pdf.js is loaded on demand from a pinned CDN build.
 */
const PDFJS_VERSION = '4.10.38';
const BASE = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build`;

interface PdfJs {
  GlobalWorkerOptions: { workerSrc: string };
  getDocument(src: { data: ArrayBuffer }): { promise: Promise<PdfDoc> };
}
interface PdfDoc {
  numPages: number;
  getPage(n: number): Promise<{ getTextContent(): Promise<{ items: Array<{ str?: string }> }> }>;
}

let lib: Promise<PdfJs> | null = null;
function loadPdfJs(): Promise<PdfJs> {
  lib ??= import(/* webpackIgnore: true */ /* turbopackIgnore: true */ `${BASE}/pdf.min.mjs`).then((m: PdfJs) => {
    m.GlobalWorkerOptions.workerSrc = `${BASE}/pdf.worker.min.mjs`;
    return m;
  });
  return lib;
}

export const MAX_PDF_BYTES = 20 * 1024 * 1024;
export const MAX_PAGES = 500;

/** Returns Manuale_Markdown-style text with <!-- page: N --> markers. */
export async function pdfToMarkdown(file: File): Promise<string> {
  if (file.size > MAX_PDF_BYTES) throw new Error(`The PDF exceeds ${MAX_PDF_BYTES / 1024 / 1024} MB`);
  const pdfjs = await loadPdfJs();
  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise.catch(() => {
    throw new Error('The file is not a readable PDF');
  });
  if (doc.numPages > MAX_PAGES) throw new Error(`The PDF has ${doc.numPages} pages (maximum ${MAX_PAGES})`);
  const out: string[] = [];
  let hasText = false;
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const text = (await page.getTextContent()).items.map((i) => i.str ?? '').join(' ').replace(/\s+/g, ' ').trim();
    if (text) hasText = true;
    out.push(`<!-- page: ${n} -->\n${text}\n`);
  }
  if (!hasText) throw new Error('The manual has no extractable text (scanned PDF?)');
  return out.join('\n');
}
