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
  bg: '#f6f1e9',
  card: '#fffdf8',
  cardBorder: 'rgba(52, 45, 37, 0.13)',
  ink: '#1c1a17',
  text: '#1c1a17',
  muted: '#746d63',
  accent: '#e34d47',
  accentBg: '#fff0eb',
  primaryText: '#1c1a17',
  mutedText: '#958d82',
  ok: '#36715b',
  green: '#27875f',
  white: '#fffdf8',
  onAccent: '#fffdf8',

  panel: '#fbf7f0',
  line: 'rgba(52, 45, 37, 0.12)',
  bgDeep: '#e9e1d5',
  accent2: '#a66637',
  accentSoft: '#f2d7cb',
};
