export function escapeHtml(value: unknown): string {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function slugPath(...parts: string[]): string {
  return parts.map((part) => part.replace(/^\/+|\/+$/g, '')).filter(Boolean).join('/');
}
