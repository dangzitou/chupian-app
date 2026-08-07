const resolveApiBase = () => {
  const raw =
    (typeof process !== 'undefined' && process.env.EXPO_PUBLIC_API_BASE) ||
    (typeof process !== 'undefined' && process.env.API_BASE) ||
    'http://42.194.251.188';
  return String(raw).replace(/\/+$/, '');
};

export const API_BASE = resolveApiBase();
export const API_PREFIX = '/api/v1';

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

export const POST_FIELD_LIMIT = {
  title: 90,
  content: 4000,
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
