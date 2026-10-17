/**
 * Minimal RFC 4180-ish CSV parser (quotes, escaped quotes, commas/semicolons). Pure.
 * Req 16.4: required columns machine_id, sensor_name, unit.
 */
export const REQUIRED_COLUMNS = ['machine_id', 'sensor_name', 'unit'] as const;

export type CsvResult =
  | { ok: true; rows: Array<Record<string, string>> }
  | { ok: false; error: string; missing?: string[] };

export function parseCsv(text: string, maxRows = 500): CsvResult {
  const src = text.replace(/^\uFEFF/, '');
  const firstLine = src.split(/\r?\n/, 1)[0] ?? '';
  const sep = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : ',';
  const records: string[][] = [];
  let field = '';
  let row: string[] = [];
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"' && field === '') quoted = true;
    else if (c === sep) {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      if (row.some((f) => f.trim() !== '')) records.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (quoted) return { ok: false, error: 'CSV cannot be parsed: unclosed quotes' };
  row.push(field);
  if (row.some((f) => f.trim() !== '')) records.push(row);
  if (records.length < 2) return { ok: false, error: 'The CSV needs a header and at least one data row' };

  const header = records[0]!.map((h) => h.trim().toLowerCase().replace(/\s+/g, '_'));
  const missing = REQUIRED_COLUMNS.filter((c) => !header.includes(c));
  if (missing.length) return { ok: false, error: `Missing required columns: ${missing.join(', ')}`, missing };
  const data = records.slice(1);
  if (data.length > maxRows) return { ok: false, error: `Too many rows: ${data.length} (maximum ${maxRows})` };
  const rows = data.map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? '').trim()])));
  const bad = rows.findIndex((r) => REQUIRED_COLUMNS.some((c) => !r[c]));
  if (bad >= 0) return { ok: false, error: `Row ${bad + 2}: required values missing` };
  return { ok: true, rows };
}
