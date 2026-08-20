const HTML_TAG = /<[^>]*>/g;
// Strips ASCII control bytes (code points 0-31 and 127). Built from numeric
// char codes rather than a literal escape sequence so this file never
// contains a literal control byte or an unusual escape for a linter to trip on.
const CONTROL_CHAR_CODES = [...Array(32).keys(), 127];
const CONTROL_CHARS = new RegExp(
  `[${CONTROL_CHAR_CODES.map((code) => `\\u${code.toString(16).padStart(4, '0')}`).join('')}]`,
  'g',
);
const WHITESPACE_RUN = /\s+/g;

/**
 * Strips a free-text field down to plain, printable content before it enters
 * a DynamoDB item or a derived index key: HTML/XML tags are removed (basic
 * stored-XSS defense - this is not a full HTML sanitizer), control characters
 * are dropped, and runs of whitespace collapse to a single space. Newlines
 * are not preserved; product name/description are single-line catalog copy.
 */
export function sanitizeText(value: string): string {
  return value.replace(HTML_TAG, '').replace(CONTROL_CHARS, '').replace(WHITESPACE_RUN, ' ').trim();
}
