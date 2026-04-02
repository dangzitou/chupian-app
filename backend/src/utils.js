export function parseCursor(cursor) {
  if (!cursor) return null;
  const parts = String(cursor).split("|");
  if (parts.length !== 2) return null;
  const id = Number(parts[0]);
  const ts = new Date(parts[1]).toISOString();
  if (Number.isNaN(id) || Number.isNaN(new Date(ts).getTime())) return null;
  return { id, createdAt: ts };
}

export function makeCursor(createdAt, id) {
  if (!createdAt || !id) return "";
  return `${id}|${createdAt}`;
}

export function safeJsonList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  try {
    const arr = JSON.parse(value);
    return Array.isArray(arr) ? arr : [];
  } catch (err) {
    return [];
  }
}
