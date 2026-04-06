const MEMORY_DRAFT_STORE = new Map();

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
      if (isWebStorageAvailable()) {
        const webValue = await localStorageRead(key);
        if (webValue) return webValue;
      }
      return memoryRead(key);
    },
    async write(payload) {
      if (isWebStorageAvailable()) {
        const ok = await localStorageWrite(key, payload);
        if (ok) return true;
      }
      return memoryWrite(key, payload);
    },
    async remove() {
      if (isWebStorageAvailable()) {
        const ok = await localStorageRemove(key);
        if (ok) return true;
      }
      return memoryRemove(key);
    },
  };
}
