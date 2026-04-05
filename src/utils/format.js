export function formatCount(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n) || n <= 0) return '0';
  if (n < 1000) return String(n);
  if (n < 10000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return `${(n / 10000).toFixed(1).replace(/\.0$/, '')}w`;
}

export function clampText(value, maxLen, suffix = '…') {
  const text = String(value || '');
  if (text.length <= maxLen) return text;
  return `${text.slice(0, Math.max(0, maxLen - suffix.length))}${suffix}`;
}
