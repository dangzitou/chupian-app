import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { API_BASE } from '../config';

const STORAGE_KEY = 'chupian:actor-id:v1';
const SESSION_KEY = 'chupian:actor-session:v1';
let runtimeActorId = '';
let runtimeSessionToken = '';

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

export function getActorId() {
  if (runtimeActorId) return runtimeActorId;
  runtimeActorId = readStoredActorId() || createActorId();
  storeActorId(runtimeActorId);
  return runtimeActorId;
}

export function getActorToken() {
  return runtimeSessionToken;
}

export async function hydrateActorId() {
  if (runtimeActorId && runtimeSessionToken) return runtimeActorId;

  if (Platform.OS !== 'web') {
    try {
      const stored = String(await SecureStore.getItemAsync(STORAGE_KEY) || '').trim();
      const storedToken = String(await SecureStore.getItemAsync(SESSION_KEY) || '').trim();
      if (stored && storedToken) {
        runtimeActorId = stored;
        runtimeSessionToken = storedToken;
        return runtimeActorId;
      }
    } catch (_err) {
      // Fall through to a fresh session request.
    }
  } else {
    const stored = readStoredActorId();
    const storedToken = readStoredSession();
    if (stored && storedToken) {
      runtimeActorId = stored;
      runtimeSessionToken = storedToken;
      return runtimeActorId;
    }
  }

  try {
    const response = await fetch(`${API_BASE}/api/v1/auth/anonymous`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!response.ok) throw new Error(`session ${response.status}`);
    const payload = await response.json();
    runtimeActorId = String(payload.actorId || '').trim();
    runtimeSessionToken = String(payload.token || '').trim();
    if (!runtimeActorId || !runtimeSessionToken) throw new Error('invalid session payload');
    if (Platform.OS !== 'web') {
      await SecureStore.setItemAsync(STORAGE_KEY, runtimeActorId);
      await SecureStore.setItemAsync(SESSION_KEY, runtimeSessionToken);
    } else {
      storeActorId(runtimeActorId);
      storeSession(runtimeSessionToken);
    }
    return runtimeActorId;
  } catch (_err) {
    runtimeActorId = runtimeActorId || getActorId();
    return runtimeActorId;
  }
}

export function getActorName() {
  const suffix = getActorId().replace(/[^a-zA-Z0-9]/g, '').slice(-6).toUpperCase();
  return `影友${suffix || '拍友'}`;
}
