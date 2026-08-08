import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

const STORAGE_KEY = 'chupian:actor-id:v1';
let runtimeActorId = '';

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

export function getActorId() {
  if (runtimeActorId) return runtimeActorId;
  runtimeActorId = readStoredActorId() || createActorId();
  storeActorId(runtimeActorId);
  return runtimeActorId;
}

export async function hydrateActorId() {
  if (runtimeActorId) return runtimeActorId;

  if (Platform.OS !== 'web') {
    try {
      const stored = String(await SecureStore.getItemAsync(STORAGE_KEY) || '').trim();
      runtimeActorId = stored || createActorId();
      if (!stored) {
        await SecureStore.setItemAsync(STORAGE_KEY, runtimeActorId);
      }
      return runtimeActorId;
    } catch (_err) {
      runtimeActorId = createActorId();
      return runtimeActorId;
    }
  }

  return getActorId();
}

export function getActorName() {
  const suffix = getActorId().replace(/[^a-zA-Z0-9]/g, '').slice(-6).toUpperCase();
  return `影友${suffix || '拍友'}`;
}
