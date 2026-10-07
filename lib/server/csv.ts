/** Encode a value for CSV while preventing spreadsheet formula injection. */
export function csvCell(value: unknown): string {
  const text = value == null ? "" : String(value);
  // A leading apostrophe is displayed as text by spreadsheet applications and
  // prevents audit content from being executed as a formula. Include leading
  // whitespace in the check because spreadsheet imports may trim it first.
  const safeText = /^[\t\r\n ]*[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safeText.replaceAll('"', '""')}"`;
}
