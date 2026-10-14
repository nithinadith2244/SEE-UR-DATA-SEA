// Only absolute https URLs without embedded credentials may be rendered as links.
export function sanitizeHttpsUrl(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 2048) return null;
  let u;
  try {
    u = new URL(value.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:") return null;
  if (u.username || u.password) return null;
  if (!u.hostname.includes(".")) return null;
  return u.href;
}
