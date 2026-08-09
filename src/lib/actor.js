import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { API_BASE } from '../config';

const STORAGE_KEY = 'chupian:actor-id:v1';
const SESSION_KEY = 'chupian:actor-session:v1';
const USER_KEY = 'chupian:user:v1';
let runtimeActorId = '';
let runtimeSessionToken = '';
let runtimeUser = null;
let refreshPromise = null;

function createActorId() {
  const randomUuid = globalThis?.crypto?.randomUUID;
  if (typeof randomUuid === 'function') {
    return `device-${randomUuid()}`;
  }
  return `device-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function readStoredActorId() {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return '';
    return String(window.localStorage.getItem(STORAGE_KEY) || '').trim();
  } catch (_err) {
    return '';
  }
}

function storeActorId(value) {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(STORAGE_KEY, value);
    }
  } catch (_err) {
    // Storage may be unavailable in private browsing or native runtimes.
  }
}

function readStoredSession() {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return '';
    return String(window.localStorage.getItem(SESSION_KEY) || '').trim();
  } catch (_err) {
    return '';
  }
}

function storeSession(value) {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(SESSION_KEY, value);
    }
  } catch (_err) {
    // Storage may be unavailable in private browsing or native runtimes.
  }
}

function readStoredUser() {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    const raw = window.localStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (_err) {
    return null;
  }
}

function storeUser(value) {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(USER_KEY, JSON.stringify(value));
    }
  } catch (_err) {
    // Storage may be unavailable in private browsing or native runtimes.
  }
}

function removeStoredUser() {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.removeItem(USER_KEY);
    }
  } catch (_err) {
    // Storage may be unavailable in private browsing or native runtimes.
  }
}

export function getActorId() {
  if (runtimeActorId) return runtimeActorId;
  runtimeActorId = readStoredActorId() || createActorId();
  storeActorId(runtimeActorId);
  return runtimeActorId;
}

export function getActorToken() {
  return runtimeSessionToken;
}

export async function hydrateActorId(force = false) {
  if (!force && runtimeActorId && runtimeSessionToken) return runtimeActorId;

  if (!force && Platform.OS !== 'web') {
    try {
      const stored = String(await SecureStore.getItemAsync(STORAGE_KEY) || '').trim();
      const storedToken = String(await SecureStore.getItemAsync(SESSION_KEY) || '').trim();
      if (stored && storedToken) {
        runtimeActorId = stored;
        runtimeSessionToken = storedToken;
        const storedUser = String(await SecureStore.getItemAsync(USER_KEY) || '').trim();
        runtimeUser = storedUser ? JSON.parse(storedUser) : null;
        return runtimeActorId;
      }
    } catch (_err) {
      // Fall through to a fresh session request.
    }
  } else if (!force) {
    const stored = readStoredActorId();
    const storedToken = readStoredSession();
    if (stored && storedToken) {
      runtimeActorId = stored;
      runtimeSessionToken = storedToken;
      runtimeUser = readStoredUser();
      return runtimeActorId;
    }
  }

  if (force) runtimeUser = null;

  try {
    const response = await fetch(`${API_BASE}/api/v1/auth/anonymous`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!response.ok) throw new Error(`session ${response.status}`);
    const payload = await response.json();
    runtimeActorId = String(payload.actorId || '').trim();
    runtimeSessionToken = String(payload.token || '').trim();
    runtimeUser = null;
    if (!runtimeActorId || !runtimeSessionToken) throw new Error('invalid session payload');
    if (Platform.OS !== 'web') {
      await SecureStore.setItemAsync(STORAGE_KEY, runtimeActorId);
      await SecureStore.setItemAsync(SESSION_KEY, runtimeSessionToken);
      await SecureStore.deleteItemAsync(USER_KEY);
    } else {
      storeActorId(runtimeActorId);
      storeSession(runtimeSessionToken);
      removeStoredUser();
    }
    return runtimeActorId;
  } catch (_err) {
    runtimeActorId = runtimeActorId || getActorId();
    return runtimeActorId;
  }
}

export function refreshActorSession() {
  if (!refreshPromise) {
    runtimeSessionToken = '';
    refreshPromise = hydrateActorId(true).finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

export async function setAuthenticatedSession(payload = {}) {
  const user = payload.user || {};
  const actorId = String(user.id || '').trim();
  const token = String(payload.token || '').trim();
  if (!actorId || !token) throw new Error('invalid authenticated session');
  runtimeActorId = actorId;
  runtimeSessionToken = token;
  runtimeUser = {
    id: actorId,
    username: String(user.username || '').trim(),
    displayName: String(user.displayName || user.username || '').trim(),
    bio: String(user.bio || '').trim(),
    avatar: String(user.avatar || user.avatarUrl || '').trim(),
  };
  if (Platform.OS !== 'web') {
    await SecureStore.setItemAsync(STORAGE_KEY, runtimeActorId);
    await SecureStore.setItemAsync(SESSION_KEY, runtimeSessionToken);
    await SecureStore.setItemAsync(USER_KEY, JSON.stringify(runtimeUser));
  } else {
    storeActorId(runtimeActorId);
    storeSession(runtimeSessionToken);
    storeUser(runtimeUser);
  }
  return runtimeUser;
}

export async function clearAuthenticatedSession() {
  runtimeActorId = '';
  runtimeSessionToken = '';
  runtimeUser = null;
  if (Platform.OS !== 'web') {
    await Promise.all([
      SecureStore.deleteItemAsync(STORAGE_KEY),
      SecureStore.deleteItemAsync(SESSION_KEY),
      SecureStore.deleteItemAsync(USER_KEY),
    ]);
  } else {
    try {
      window.localStorage?.removeItem(STORAGE_KEY);
      window.localStorage?.removeItem(SESSION_KEY);
    } catch (_err) {
      // Storage may be unavailable in private browsing.
    }
    removeStoredUser();
  }
  return hydrateActorId(true);
}

export function getCurrentUser() {
  return runtimeUser;
}

export function isAuthenticated() {
  return Boolean(runtimeUser?.id && runtimeSessionToken);
}

export function getActorName() {
  if (runtimeUser?.displayName) return runtimeUser.displayName;
  const suffix = getActorId().replace(/[^a-zA-Z0-9]/g, '').slice(-6).toUpperCase();
  return `影友${suffix || '拍友'}`;
}
