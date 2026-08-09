import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

const MEMORY_DRAFT_STORE = new Map();
const STORAGE_QUEUES = new Map();

function enqueueStorageOperation(key, operation) {
  const previous = STORAGE_QUEUES.get(key) || Promise.resolve();
  const next = previous.catch(() => undefined).then(operation);
  STORAGE_QUEUES.set(key, next);
  return next.finally(() => {
    if (STORAGE_QUEUES.get(key) === next) STORAGE_QUEUES.delete(key);
  });
}

function resolveStorageKey(namespace) {
  return String(namespace || 'chupian-draft').trim() || 'chupian-draft';
}

function isWebStorageAvailable() {
  return typeof globalThis !== 'undefined'
    && typeof globalThis.window !== 'undefined'
    && typeof globalThis.window.localStorage !== 'undefined';
}

async function localStorageRead(key) {
  try {
    const raw = globalThis.window.localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (_err) {
    return null;
  }
}

async function localStorageWrite(key, value) {
  try {
    globalThis.window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (_err) {
    return false;
  }
}

async function localStorageRemove(key) {
  try {
    globalThis.window.localStorage.removeItem(key);
    return true;
  } catch (_err) {
    return false;
  }
}

function memoryRead(key) {
  const raw = MEMORY_DRAFT_STORE.get(key);
  if (raw == null) return null;
  try {
    return JSON.parse(raw);
  } catch (_err) {
    return null;
  }
}

function memoryWrite(key, value) {
  try {
    MEMORY_DRAFT_STORE.set(key, JSON.stringify(value));
    return true;
  } catch (_err) {
    return false;
  }
}

function memoryRemove(key) {
  MEMORY_DRAFT_STORE.delete(key);
  return true;
}

export function createDraftStorage(namespace = 'chupian-draft') {
  const key = resolveStorageKey(namespace);

  return {
    async read() {
      return enqueueStorageOperation(key, async () => {
        // A quota or native-storage failure may leave the newest payload only
        // in memory. Prefer it over an older durable copy so a failed write
        // cannot make the editor reopen stale content.
        const memoryValue = memoryRead(key);
        if (memoryValue != null) return memoryValue;
        if (isWebStorageAvailable()) {
          const webValue = await localStorageRead(key);
          if (webValue) return webValue;
        }
        if (Platform.OS !== 'web') {
          try {
            const raw = await AsyncStorage.getItem(key);
            if (raw) return JSON.parse(raw);
          } catch (_err) {
            // Fall back to the in-memory store if native storage is unavailable.
          }
        }
        return null;
      });
    },
    async write(payload) {
      return enqueueStorageOperation(key, async () => {
        if (isWebStorageAvailable()) {
          const ok = await localStorageWrite(key, payload);
          if (ok) {
            memoryRemove(key);
            return true;
          }
        }
        if (Platform.OS !== 'web') {
          try {
            await AsyncStorage.setItem(key, JSON.stringify(payload));
            memoryRemove(key);
            return true;
          } catch (_err) {
            // Fall back to the in-memory store if native storage is unavailable.
          }
        }
        return memoryWrite(key, payload);
      });
    },
    async remove() {
      return enqueueStorageOperation(key, async () => {
        let removed = false;
        if (isWebStorageAvailable()) {
          removed = await localStorageRemove(key) || removed;
        }
        if (Platform.OS !== 'web') {
          try {
            await AsyncStorage.removeItem(key);
            removed = true;
          } catch (_err) {
            // Fall back to clearing the in-memory store if native storage is unavailable.
          }
        }
        return memoryRemove(key) || removed;
      });
    },
  };
}
