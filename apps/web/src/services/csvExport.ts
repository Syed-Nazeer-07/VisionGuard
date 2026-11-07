/**
 * Quote spreadsheet cells while neutralizing formula injection from filenames,
 * source names and other user-controlled metadata.
 */
export function csvCell(value: unknown): string {
  const raw = String(value ?? '');
  const leadingFormula = /^[\u0000-\u0020]*[=+@-]/.test(raw);
  const plainNumber = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(raw.trim());
  const safe = leadingFormula && !plainNumber ? "'" + raw : raw;
  return '"' + safe.replace(/"/g, '""') + '"';
}
