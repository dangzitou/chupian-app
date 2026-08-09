const resolveApiBase = () => {
  const fromEnv =
    (typeof process !== 'undefined' && process.env.EXPO_PUBLIC_API_BASE) ||
    (typeof process !== 'undefined' && process.env.API_BASE);

  if (fromEnv) {
    return String(fromEnv).replace(/\/+$/, '');
  }

  if (typeof window !== 'undefined' && window.location && window.location.origin) {
    const hostname = window.location.hostname || '';
    const isLocalhost = ['localhost', '127.0.0.1'].includes(hostname);
    const isPrivateLan = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(hostname);
    if (!isLocalhost && !isPrivateLan) {
      return String(window.location.origin).replace(/\/+$/, '');
    }
  }

  return 'http://42.194.251.188';
};

export const API_BASE = resolveApiBase();
export const API_PREFIX = '/api/v1';

const resolvePublicWebOrigin = () => {
  const configured =
    (typeof process !== 'undefined' && process.env.EXPO_PUBLIC_WEB_ORIGIN) ||
    (typeof process !== 'undefined' && process.env.PUBLIC_WEB_ORIGIN);

  if (configured) return String(configured).replace(/\/+$/, '');
  if (typeof window !== 'undefined' && window.location?.origin) {
    return String(window.location.origin).replace(/\/+$/, '');
  }
  return API_BASE;
};

export const PUBLIC_WEB_ORIGIN = resolvePublicWebOrigin();

export const TIME_LABELS = {
  day: '白天',
  golden: '黄金时刻',
  night: '夜景',
  all: '全部',
};

export const MEDIA_KINDS = {
  IMAGE: 'image',
  VIDEO: 'video',
  LIVE: 'live',
};

export const MAX_MEDIA_UPLOAD_BYTES = 120 * 1024 * 1024;

export const POST_FIELD_LIMIT = {
  title: 90,
  content: 3000,
  tag: 24,
  tags: 12,
};

export const COLORS = {
  bg: '#f8f7f6',
  card: '#ffffff',
  cardBorder: 'rgba(0,0,0,0.07)',
  ink: '#191919',
  muted: '#7b7270',
  accent: '#d93657',
  accentBg: '#fff1f3',
  primaryText: '#121212',
  mutedText: '#8b7f7d',
  ok: '#2f6b45',
  green: '#0f9d58',
  white: '#ffffff',
  onAccent: '#ffffff',

  panel: '#ffffff',
  line: 'rgba(0,0,0,0.07)',
  bgDeep: '#e8e4dd',
  accent2: '#9d3f15',
  accentSoft: '#f6d9df',
};
