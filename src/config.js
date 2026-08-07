// API 配置：支持环境变量自定义后端地址（优先级高）
// 1) EXPO_PUBLIC_API_BASE（推荐，发布时可直接注入）
// 2) API_BASE（兼容历史变量）
// 3) 线上默认地址
const resolveApiBase = () => {
  const raw =
    (typeof process !== "undefined" && process.env.EXPO_PUBLIC_API_BASE) ||
    (typeof process !== "undefined" && process.env.API_BASE) ||
    "http://42.194.251.188";
  return String(raw).replace(/\/+$/, "");
};

export const API_BASE = resolveApiBase();

export const COLORS = {
  bg: '#f4efe7',
  bgDeep: '#ebe3d6',
  ink: '#1c1915',
  muted: '#6b6358',
  line: 'rgba(28,25,21,0.12)',
  panel: '#fffbf5',
  accent: '#c45c26',
  accent2: '#9d3f15',
  accentSoft: '#f0d6c5',
  ok: '#2f6b45',
  white: '#fff',
  onAccent: '#fff8ef',
};

export const TIME_LABELS = { day: '白天', golden: '黄金时刻', night: '夜景' };
