export function clampText(value, maxLen, suffix = '...') {
  const text = String(value || '');
  if (text.length <= maxLen) return text;
  return `${text.slice(0, Math.max(0, maxLen - suffix.length))}${suffix}`;
}

export function formatRelativeTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  const now = Date.now();
  const delta = Math.max(0, now - date.getTime());
  const minute = Math.floor(delta / 60000);

  if (minute < 1) return '刚刚';
  if (minute < 60) return `${minute}分钟前`;

  const hour = Math.floor(minute / 60);
  if (hour < 24) return `${hour}小时前`;

  const day = Math.floor(hour / 24);
  if (day < 30) return `${day}天前`;

  return `${Math.floor(day / 30)}个月前`;
}

export function formatCompactDate(value) {
  if (!value) return '';
  const str = String(value || '').replace('T', ' ');
  return str.length > 16 ? str.slice(0, 16) : str;
}
