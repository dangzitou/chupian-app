import { API_BASE, API_PREFIX } from './config';
import { buildPostPayload, normalizePostShape } from './utils/postCodec';
import {
  clearAuthenticatedSession,
  getActorId,
  getActorName,
  getCurrentUser,
  getActorToken,
  refreshActorSession,
  setAuthenticatedSession,
} from './lib/actor';
import { buildSessionIdempotencyKey } from './lib/idempotency';

const NETWORK_TIMEOUT_MS = 12_000;
const GET_CACHE_TTL_MS = 4000;
const MAX_RETRIES = 2;
const MAX_GET_CACHE_ENTRIES = 250;

const inFlightGetRequests = new Map();
const getResponseCache = new Map();
let sessionRefreshPromise = null;
const notificationRefreshListeners = new Set();
const networkStatusListeners = new Set();
let networkOnline = true;

function subscribeNetworkStatus(listener) {
  if (typeof listener !== 'function') return () => {};
  networkStatusListeners.add(listener);
  try {
    listener(networkOnline);
  } catch (_err) {
    // A status indicator must never affect the request pipeline.
  }
  return () => networkStatusListeners.delete(listener);
}

function setNetworkOnline(nextOnline) {
  const next = Boolean(nextOnline);
  if (networkOnline === next) return;
  networkOnline = next;
  for (const listener of networkStatusListeners) {
    try {
      listener(next);
    } catch (_err) {
      // A status indicator must never affect the request pipeline.
    }
  }
}

function subscribeNotificationRefresh(listener) {
  if (typeof listener !== 'function') return () => {};
  notificationRefreshListeners.add(listener);
  return () => notificationRefreshListeners.delete(listener);
}

function emitNotificationRefresh() {
  for (const listener of notificationRefreshListeners) {
    try {
      listener();
    } catch (_err) {
      // A badge refresh must never affect the completed write operation.
    }
  }
}

class ApiError extends Error {
  constructor(message, { status, path, method, payload, cause, retryAfterMs } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.path = path;
    this.method = method;
    this.payload = payload;
    this.cause = cause;
    this.retryAfterMs = retryAfterMs;
  }
}

const getDefaultAuthor = () => {
  return getActorName();
};

const getActorAvatar = () => {
  return String(getCurrentUser()?.avatar || '').trim();
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfterMs(value) {
  const raw = String(value || '').trim();
  if (!raw) return 0;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(0, Math.round(seconds * 1000));
  const timestamp = Date.parse(raw);
  if (!Number.isFinite(timestamp)) return 0;
  return Math.max(0, timestamp - Date.now());
}

function clonePayload(value) {
  if (value === undefined) return value;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (_err) {
    return value;
  }
}

function setGetResponseCache(key, value, ttl) {
  const now = Date.now();
  for (const [cachedKey, cached] of getResponseCache) {
    if (cached.expiresAt <= now) getResponseCache.delete(cachedKey);
  }
  if (!getResponseCache.has(key) && getResponseCache.size >= MAX_GET_CACHE_ENTRIES) {
    const oldestKey = getResponseCache.keys().next().value;
    if (oldestKey !== undefined) getResponseCache.delete(oldestKey);
  }
  getResponseCache.set(key, {
    value: clonePayload(value),
    expiresAt: now + ttl,
  });
}

function buildCacheKey(method, path, options = {}) {
  const normalized = `${method} ${String(path || '').trim()}`;
  const headers = options.headers || {};
  const filteredHeaders = Object.keys(headers)
    .sort()
    .filter((key) => key.toLowerCase() !== 'authorization' && key.toLowerCase() !== 'cookie')
    .map((key) => `${key}:${headers[key]}`)
    .join('|');
  return `${normalized}${filteredHeaders ? ` ${filteredHeaders}` : ''} actor:${getActorId()}`;
}

function shouldRetry(status, method, error, allowUnsafe = false) {
  if (method !== 'GET' && !allowUnsafe) return false;
  if (!status) return true;
  if (status >= 500 && status < 600) return true;
  return status === 408 || status === 429 || status === 503;
}

function shouldFallback(error) {
  if (!error) return false;
  if (error.status === 404 || error.status === 405 || error.status === 410) return true;
  return false;
}

function shouldFallbackWrite(error) {
  return [404, 405, 410].includes(Number(error?.status));
}

function refreshSessionOnce() {
  if (!sessionRefreshPromise) {
    sessionRefreshPromise = Promise.resolve()
      .then(() => refreshActorSession())
      .finally(() => {
        sessionRefreshPromise = null;
      });
  }
  return sessionRefreshPromise;
}

function uploadFormDataWithProgress(path, {
  method,
  body,
  headers,
  timeout,
  onProgress,
}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let settled = false;
    let timedOut = false;
    let timer = null;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      callback(value);
    };

    const networkError = (message, cause) => new ApiError(message, {
      status: 0,
      path,
      method,
      cause,
    });

    try {
      xhr.open(method, `${API_BASE}${path}`, true);
      Object.entries(headers || {}).forEach(([key, value]) => {
        if (value != null) xhr.setRequestHeader(key, String(value));
      });
      if (xhr.upload) {
        xhr.upload.onprogress = (event) => {
          try {
            onProgress?.({
              loaded: Number(event.loaded || 0),
              total: event.lengthComputable ? Number(event.total || 0) : 0,
            });
          } catch (_err) {
            // Progress rendering must never interrupt an upload.
          }
        };
      }
      xhr.onload = () => {
        let data = {};
        let isJson = false;
        const text = xhr.responseText || '';
        if (text) {
          try {
            data = JSON.parse(text);
            isJson = true;
          } catch (_err) {
            data = { error: text };
          }
        }
        setNetworkOnline(true);
        if (xhr.status < 200 || xhr.status >= 300) {
          const fallbackMessage = data?.error || `HTTP ${xhr.status}`;
          const message = isJson && data?.message ? data.message : fallbackMessage;
          finish(reject, new ApiError(`接口异常：${path} (${xhr.status})`, {
            status: xhr.status,
            path,
            method,
            payload: data,
            cause: message,
            retryAfterMs: parseRetryAfterMs(xhr.getResponseHeader?.('Retry-After')),
          }));
          return;
        }
        finish(resolve, data);
      };
      xhr.onerror = () => {
        setNetworkOnline(false);
        finish(reject, networkError('网络连接异常，请检查网络设置'));
      };
      xhr.onabort = () => {
        if (timedOut) return;
        setNetworkOnline(false);
        finish(reject, networkError('网络连接异常，请检查网络设置'));
      };
      timer = setTimeout(() => {
        timedOut = true;
        try {
          xhr.abort();
        } catch (_err) {
          // The timeout error below is still authoritative.
        }
        finish(reject, networkError('请求超时，请稍后重试'));
      }, timeout);
      xhr.send(body);
    } catch (err) {
      setNetworkOnline(false);
      finish(reject, networkError('网络连接异常，请检查网络设置', err));
    }
  });
}

async function doRequest(path, options = {}) {
  const {
    method: customMethod = 'GET',
    body: requestBody,
    timeout: _timeout,
    noCache: _noCache,
    noDedup: _noDedup,
    cacheTtl: _cacheTtl,
    retryUnsafe: _retryUnsafe,
    onUploadProgress: uploadProgressCallback,
    ...forwardOptions
  } = options;
  const method = String(customMethod).toUpperCase();
  const isFormData = typeof FormData !== 'undefined' && requestBody instanceof FormData;
  const timeout = Number.isFinite(options.timeout) ? Number(options.timeout) : NETWORK_TIMEOUT_MS;
  const headers = isFormData ? {} : { 'Content-Type': 'application/json' };
  const actorToken = getActorToken();
  const finalHeaders = {
    ...headers,
    'x-actor-id': getActorId(),
    ...(actorToken ? { 'x-actor-token': actorToken } : {}),
    ...(options.headers || {}),
  };

  if (isFormData && typeof uploadProgressCallback === 'function' && typeof XMLHttpRequest !== 'undefined') {
    return uploadFormDataWithProgress(path, {
      method,
      body: requestBody,
      headers: finalHeaders,
      timeout,
      onProgress: uploadProgressCallback,
    });
  }

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeout);

  try {
    const res = await fetch(`${API_BASE}${path}`, {
      ...forwardOptions,
      method,
      headers: finalHeaders,
      body: requestBody,
      signal: controller.signal,
    });
    setNetworkOnline(true);
    const text = await res.text();
    let data = {};
    let isJson = false;
    if (text) {
      try {
        data = JSON.parse(text);
        isJson = true;
      } catch (_err) {
        data = { error: text };
      }
    }

    if (!res.ok) {
      const fallbackMessage = data?.error || `HTTP ${res.status}`;
      const message = isJson && data?.message ? data.message : fallbackMessage;
      throw new ApiError(`接口异常：${path} (${res.status})`, {
        status: res.status,
        path,
        method,
        payload: data,
        cause: message,
        retryAfterMs: parseRetryAfterMs(res.headers?.get?.('Retry-After')),
      });
    }

    return data;
  } catch (err) {
    if (err instanceof ApiError) {
      if (err.status === 0) setNetworkOnline(false);
      throw err;
    }
    if (timedOut || err?.name === 'AbortError') {
      setNetworkOnline(false);
      throw new ApiError('请求超时，请稍后重试', { status: 0, path, method, cause: err });
    }
    if (err instanceof TypeError) {
      setNetworkOnline(false);
      throw new ApiError('网络连接异常，请检查网络设置', { status: 0, path, method, cause: err });
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function request(path, options = {}) {
  const method = (options.method || 'GET').toUpperCase();
  const isGet = method === 'GET';
  const shouldCache = isGet && !options.noCache;
  const cacheTtl = Number.isFinite(options.cacheTtl) ? Number(options.cacheTtl) : GET_CACHE_TTL_MS;
  const key = buildCacheKey(method, path, options);

  if (shouldCache) {
    const cached = getResponseCache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return clonePayload(cached.value);
    }
  }

  if (isGet && !options.noDedup) {
    const existing = inFlightGetRequests.get(key);
    if (existing) {
      return existing.then(clonePayload);
    }
  }

  const attemptRequest = async () => {
    let lastError;
    let refreshedSession = false;
    for (let i = 0; i <= MAX_RETRIES; i += 1) {
      try {
        const value = await doRequest(path, options);
        if (shouldCache) {
          setGetResponseCache(key, value, cacheTtl);
        }
        return value;
      } catch (err) {
        lastError = err;
        if (err?.status === 401 && !refreshedSession && !path.endsWith('/auth/anonymous')) {
          refreshedSession = true;
          const actorId = await refreshSessionOnce();
          if (actorId && getActorToken()) continue;
        }
        if (!shouldRetry(err.status, method, err, Boolean(options.retryUnsafe)) || i >= MAX_RETRIES) {
          throw err;
        }
        const serverDelay = Number(lastError?.retryAfterMs);
        const exponentialDelay = Math.min(1200, 120 * 2 ** i);
        const retryDelay = Number.isFinite(serverDelay) && serverDelay > 0
          ? Math.min(30_000, serverDelay)
          : exponentialDelay;
        await sleep(retryDelay + Math.floor(Math.random() * 80));
      }
    }
    throw lastError;
  };

  if (isGet && !options.noDedup) {
    const running = attemptRequest();
    inFlightGetRequests.set(key, running);
    return running
      .then((value) => {
        const cloned = clonePayload(value);
        return cloned;
      })
      .finally(() => {
        if (inFlightGetRequests.get(key) === running) {
          inFlightGetRequests.delete(key);
        }
      });
  }

  return attemptRequest();
}

async function safeRequestWithFallback(primaryPath, fallbackPath, options = {}) {
  try {
    return await request(primaryPath, options);
  } catch (err) {
    if (!fallbackPath || !shouldFallback(err)) {
      throw err;
    }
    return request(fallbackPath, options);
  }
}

function clearNetworkCaches({ postId, authorId } = {}) {
  const targetPostPath = postId == null ? '' : `/posts/${encodeURIComponent(String(postId))}`;
  const targetAuthorPath = authorId == null ? '' : `/authors/${encodeURIComponent(String(authorId))}`;
  for (const key of getResponseCache.keys()) {
    const path = String(key).split(' actor:')[0];
    const isFeedCache = path.includes('/community/feed')
      || path.includes('/community/me/')
      || path.includes('/api/posts?');
    const isTargetPostCache = targetPostPath && path.includes(targetPostPath);
    const isTargetAuthorCache = targetAuthorPath && path.includes(targetAuthorPath);
    const isDiscoveryCache = authorId != null && path.includes('/community/discovery');
    if (isFeedCache || isTargetPostCache || isTargetAuthorCache || isDiscoveryCache) {
      getResponseCache.delete(key);
    }
  }
}

function toPostShape(item) {
  return normalizePostShape(item);
}

function buildFeedQuery(params = {}, defaults = {}) {
  const query = new URLSearchParams();

  const merged = {
    sort: defaults.sort || 'latest',
    limit: String(defaults.limit || 20),
    q: '',
    tag: '',
    spotId: '',
    cursor: '',
    ...defaults,
    ...params,
  };

  if (merged.q) query.set('q', String(merged.q).trim());
  if (merged.tag) query.set('tag', String(merged.tag).trim());
  if (merged.spotId) query.set('spotId', String(merged.spotId).trim());
  if (merged.cursor) query.set('cursor', merged.cursor);
  query.set('limit', String(merged.limit || 20));
  query.set('sort', merged.sort === 'hot' ? 'hot' : 'latest');
  return query.toString();
}

function normalizeCommunityFeedResponse(raw) {
  const list = Array.isArray(raw.posts) ? raw.posts.map(toPostShape) : [];
  return {
    posts: list,
    nextCursor: raw.nextCursor || null,
    hasMore: Boolean(raw.hasMore),
    total: Number(raw.total || raw.totalPosts || list.length || 0),
    stats: raw.stats || null,
  };
}

function normalizePostComment(raw = {}) {
  const source = raw.comment || raw;
  return {
    id: source.id || source.commentId || source._id || `c-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    author: source.author || source.actorName || source.actor || '匿名拍友',
    avatar: source.avatar || source.authorAvatar || source.avatarUrl || '',
    text: source.text || source.content || source.comment || '',
    createdAt: source.createdAt || source.created_at || new Date().toISOString(),
  };
}

function normalizePostCommentsResponse(raw = {}) {
  return {
    comments: Array.isArray(raw.comments) ? raw.comments.map((item) => normalizePostComment(item)) : [],
    nextCursor: raw.nextCursor || null,
    hasMore: Boolean(raw.hasMore),
    total: Number(raw.total || raw.totalComments || 0),
  };
}

function buildPostQuery(params = {}) {
  const query = new URLSearchParams();
  if (params.userId) query.set('userId', params.userId);
  if (typeof params.withComments === 'boolean') {
    query.set('withComments', params.withComments ? '1' : '0');
  }
  const queryString = query.toString();
  return queryString ? `?${queryString}` : '';
}

function buildCommentsQuery(params = {}) {
  const query = new URLSearchParams();
  if (params.cursor) query.set('cursor', params.cursor);
  query.set('limit', String(params.limit || 20));
  const queryString = query.toString();
  return queryString ? `?${queryString}` : '';
}

function buildNotificationsQuery(params = {}) {
  const query = new URLSearchParams();
  if (params.cursor) query.set('cursor', String(params.cursor));
  query.set('limit', String(params.limit || 20));
  return `?${query.toString()}`;
}

function normalizeNotificationsResponse(raw = {}) {
  return {
    notifications: Array.isArray(raw.notifications) ? raw.notifications.map((item) => ({
      id: item.id,
      type: item.type || 'comment',
      actorId: item.actorId || item.actor_id || '',
      actorName: item.actorName || item.actor_name || '匿名拍友',
      avatar: item.avatar || item.actorAvatar || item.avatar_url || '',
      postId: item.postId || item.post_id || null,
      postTitle: item.postTitle || item.post_title || '',
      content: item.content || '',
      read: Boolean(item.read || item.is_read),
      createdAt: item.createdAt || item.created_at || new Date().toISOString(),
    })) : [],
    unread: Number(raw.unread || 0),
    nextCursor: raw.nextCursor || null,
    hasMore: Boolean(raw.hasMore),
  };
}


export const api = {
  async register(username, password, displayName) {
    const result = await request(`${API_PREFIX}/auth/register`, {
      method: 'POST',
      body: JSON.stringify({ username, password, displayName }),
      noCache: true,
    });
    await setAuthenticatedSession(result);
    clearNetworkCaches();
    return result;
  },

  async login(username, password) {
    const result = await request(`${API_PREFIX}/auth/login`, {
      method: 'POST',
      body: JSON.stringify({ username, password }),
      noCache: true,
    });
    await setAuthenticatedSession(result);
    clearNetworkCaches();
    return result;
  },

  async me() {
    return request(`${API_PREFIX}/auth/me`, { noCache: true });
  },

  async updateProfile(displayName, bio = '', avatar = '') {
    const nextName = String(displayName || '').trim();
    if (!nextName) throw new Error('displayName required');
    const result = await request(`${API_PREFIX}/auth/me`, {
      method: 'PATCH',
      body: JSON.stringify({
        displayName: nextName,
        bio: String(bio || '').trim(),
        avatar: String(avatar || '').trim(),
      }),
      noCache: true,
    });
    await setAuthenticatedSession({ user: result.user, token: getActorToken() });
    clearNetworkCaches();
    return result;
  },

  async logout() {
    try {
      await request(`${API_PREFIX}/auth/logout`, { method: 'POST', noCache: true });
    } finally {
      await clearAuthenticatedSession();
      clearNetworkCaches();
    }
    return { ok: true };
  },

  async health() {
    return safeRequestWithFallback('/api/v1/health', '/health', {
      noCache: true,
      timeout: 5000,
    });
  },

  async weather({ latitude, longitude, label } = {}) {
    const lat = Number(latitude);
    const lng = Number(longitude);
    const hasLocation = Number.isFinite(lat) && Number.isFinite(lng);
    const query = hasLocation
      ? `?${new URLSearchParams({
        lat: String(lat),
        lng: String(lng),
        ...(label ? { label: String(label).slice(0, 80) } : {}),
      }).toString()}`
      : '';
    return safeRequestWithFallback(
      `/api/v1/weather${query}`,
      `/api/weather${query}`,
      { cacheTtl: 15_000 },
    );
  },

  async spots({ latitude, longitude, radiusKm = 50, limit = 80 } = {}) {
    const lat = Number(latitude);
    const lng = Number(longitude);
    const hasLocation = Number.isFinite(lat) && Number.isFinite(lng);
    const query = hasLocation
      ? `?${new URLSearchParams({
        lat: String(lat),
        lng: String(lng),
        radius: String(Math.min(Math.max(Number(radiusKm) || 50, 1), 50)),
        limit: String(Math.min(Math.max(Number(limit) || 80, 1), 80)),
      }).toString()}`
      : '';
    return safeRequestWithFallback(
      `${API_PREFIX}/spots${query}`,
      `/api/spots${query}`,
      { cacheTtl: 30_000 },
    );
  },

  async spot(spotId) {
    const target = String(spotId || '').trim();
    if (!target) throw new Error('spot id required');
    const encoded = encodeURIComponent(target);
    const raw = await safeRequestWithFallback(
      `${API_PREFIX}/spots/${encoded}`,
      `/api/spots/${encoded}`,
      { cacheTtl: 30_000 },
    );
    return raw?.spot || raw;
  },

  async mapData({ latitude, longitude, radiusKm = 35, limit = 60 } = {}) {
    const lat = Number(latitude);
    const lng = Number(longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return { spots: [], posts: [] };
    }
    const params = new URLSearchParams({
      lat: String(lat),
      lng: String(lng),
      radius: String(Math.min(Math.max(Number(radiusKm) || 35, 1), 50)),
      limit: String(Math.min(Math.max(Number(limit) || 60, 1), 80)),
    }).toString();
    return safeRequestWithFallback(
      `${API_PREFIX}/map?${params}`,
      `/api/map?${params}`,
      { cacheTtl: 15_000 },
    );
  },

  async resolveLocation() {
    return safeRequestWithFallback(
      `${API_PREFIX}/location`,
      '/api/location',
      { cacheTtl: 24 * 60 * 60 * 1000 },
    );
  },

  async rewards() {
    const raw = await safeRequestWithFallback(
      `${API_PREFIX}/community/me/rewards`,
      '/api/community/me/rewards',
      { cacheTtl: 30_000 },
    );
    return {
      points: Number(raw?.points || 0),
      publishedCount: Number(raw?.publishedCount || raw?.published_count || 0),
      guideCount: Number(raw?.guideCount || raw?.guide_count || 0),
      nextGuidePoints: Number(raw?.nextGuidePoints || 15),
    };
  },

  async feed(params = {}) {
    const queryString = buildFeedQuery({
      q: params.q,
      tag: params.tag,
      spotId: params.spotId,
      cursor: params.cursor,
      limit: params.limit || 20,
      sort: params.sort,
    });
    const primary = await safeRequestWithFallback(
      `${API_PREFIX}/community/feed?${queryString}`,
      `/api/posts?${queryString}`,
      { cacheTtl: 2500, noCache: params.noCache },
    );
    return normalizeCommunityFeedResponse(primary);
  },

  async mePosts(params = {}) {
    const queryString = buildFeedQuery({
      q: params.q,
      tag: params.tag,
      cursor: params.cursor,
      limit: params.limit || 20,
      sort: params.sort,
    });
    const raw = await safeRequestWithFallback(
      `${API_PREFIX}/community/me/posts?${queryString}`,
      `/api/community/me/posts?${queryString}`,
      { cacheTtl: 2500, noCache: params.noCache },
    );
    return normalizeCommunityFeedResponse(raw);
  },

  async meSpotCount() {
    const raw = await safeRequestWithFallback(
      `${API_PREFIX}/community/me/spot-count`,
      '/api/community/me/spot-count',
      { cacheTtl: 30_000 },
    );
    return { count: Number(raw?.count || 0) };
  },

  async meLikes(params = {}) {
    const queryString = buildFeedQuery({
      q: params.q,
      tag: params.tag,
      cursor: params.cursor,
      limit: params.limit || 20,
      sort: params.sort,
    });
    const raw = await safeRequestWithFallback(
      `${API_PREFIX}/community/me/likes?${queryString}`,
      `/api/community/me/likes?${queryString}`,
      { cacheTtl: 2500, noCache: params.noCache },
    );
    return normalizeCommunityFeedResponse(raw);
  },

  async meFavorites(params = {}) {
    const queryString = buildFeedQuery({
      q: params.q,
      tag: params.tag,
      cursor: params.cursor,
      limit: params.limit || 20,
      sort: params.sort,
    });
    const raw = await safeRequestWithFallback(
      `${API_PREFIX}/community/me/favorites?${queryString}`,
      `/api/community/me/favorites?${queryString}`,
      { cacheTtl: 2500, noCache: params.noCache },
    );
    return normalizeCommunityFeedResponse(raw);
  },

  async meFollowing(params = {}) {
    const queryString = buildFeedQuery({
      q: params.q,
      tag: params.tag,
      cursor: params.cursor,
      limit: params.limit || 20,
      sort: params.sort,
    });
    const raw = await safeRequestWithFallback(
      `${API_PREFIX}/community/me/following?${queryString}`,
      `/api/community/me/following?${queryString}`,
      { cacheTtl: 2500, noCache: params.noCache },
    );
    return normalizeCommunityFeedResponse(raw);
  },

  async notifications(params = {}) {
    const raw = await request(`${API_PREFIX}/notifications${buildNotificationsQuery(params)}`, {
      noCache: true,
    });
    return normalizeNotificationsResponse(raw);
  },

  subscribeNotificationRefresh(listener) {
    return subscribeNotificationRefresh(listener);
  },

  subscribeNetworkStatus(listener) {
    return subscribeNetworkStatus(listener);
  },

  async markNotificationRead(id) {
    const target = String(id || '').trim();
    if (!target) throw new Error('notification id required');
    const result = await request(`${API_PREFIX}/notifications/${encodeURIComponent(target)}/read`, {
      method: 'POST',
    headers: { 'Idempotency-Key': buildSessionIdempotencyKey('notification-read', target) },
      body: JSON.stringify({}),
      noCache: true,
      retryUnsafe: true,
    });
    emitNotificationRefresh();
    return result;
  },

  async markAllNotificationsRead() {
    const result = await request(`${API_PREFIX}/notifications/read-all`, {
      method: 'POST',
      headers: { 'Idempotency-Key': buildSessionIdempotencyKey('notification-read-all', 'current') },
      body: JSON.stringify({}),
      noCache: true,
      retryUnsafe: true,
    });
    emitNotificationRefresh();
    return result;
  },

  async authorPosts(authorId, params = {}) {
    const target = String(authorId || '').trim();
    if (!target) throw new Error('authorId required');
    const queryString = buildFeedQuery({
      cursor: params.cursor,
      limit: params.limit || 20,
      sort: params.sort,
    });
    const raw = await request(`${API_PREFIX}/authors/${encodeURIComponent(target)}/posts?${queryString}`, {
      cacheTtl: 2500,
      noCache: params.noCache,
    });
    return normalizeCommunityFeedResponse(raw);
  },

  async getAuthorFollow(authorId) {
    const target = String(authorId || '').trim();
    if (!target) throw new Error('authorId required');
    const encoded = encodeURIComponent(target);
    return safeRequestWithFallback(
      `${API_PREFIX}/authors/${encoded}/follow`,
      `/api/authors/${encoded}/follow`,
      { cacheTtl: 30000 },
    );
  },

  async toggleFollow(authorId, action = 'toggle') {
    const target = String(authorId || '').trim();
    if (!target) throw new Error('authorId required');
    const encoded = encodeURIComponent(target);
    const body = { action, author: getDefaultAuthor(), avatar: getActorAvatar() };
    const headers = { 'Idempotency-Key': buildSessionIdempotencyKey('author-follow', `${target}-${action}`) };
    try {
      const result = await request(`${API_PREFIX}/authors/${encoded}/follow`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        retryUnsafe: true,
      });
      clearNetworkCaches({ authorId: target });
      emitNotificationRefresh();
      return result;
    } catch (err) {
      if (!shouldFallbackWrite(err)) throw err;
      const result = await request(`/api/authors/${encoded}/follow`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        retryUnsafe: true,
      });
      clearNetworkCaches({ authorId: target });
      emitNotificationRefresh();
      return result;
    }
  },

  async toggleBlock(authorId, action = 'toggle', authorName = '') {
    const target = String(authorId || '').trim();
    if (!target) throw new Error('authorId required');
    const encoded = encodeURIComponent(target);
    const body = {
      action,
      author: String(authorName || getActorName() || '匿名拍友').slice(0, 80),
    };
    const result = await request(`${API_PREFIX}/authors/${encoded}/block`, {
      method: 'POST',
      headers: { 'Idempotency-Key': buildSessionIdempotencyKey('author-block', `${target}-${action}`) },
      body: JSON.stringify(body),
      noCache: true,
      retryUnsafe: true,
    });
    clearNetworkCaches({ authorId: target });
    return result;
  },

  async blockedAuthors() {
    const raw = await request(`${API_PREFIX}/community/me/blocked`, { noCache: true });
    return {
      authors: Array.isArray(raw?.authors) ? raw.authors.map((item) => ({
        authorId: item.authorId || item.author_id || '',
        authorName: item.authorName || item.author_name || '匿名拍友',
        createdAt: item.createdAt || item.created_at || new Date().toISOString(),
      })) : [],
    };
  },

  async discovery(params = {}) {
    const query = new URLSearchParams({
      ...(params.type ? { type: String(params.type) } : {}),
      limit: String(params.limit || 20),
    }).toString();

    const res = await safeRequestWithFallback(
      `${API_PREFIX}/community/discovery?${query}`,
      `/api/community/discovery?${query}`,
      { cacheTtl: 30_000, noCache: false },
    );
    const list = Array.isArray(res.signals) ? res.signals : [];
    return {
      signals: list,
      meta: res.meta || { type: params.type || 'all', count: list.length },
    };
  },

  async getPost(id, options = {}) {
    const userId = options.userId || null;
    const suffix = buildPostQuery({
      userId,
      withComments: Object.prototype.hasOwnProperty.call(options, 'withComments')
        ? Boolean(options.withComments)
        : null,
    });
    const post = await safeRequestWithFallback(
      `${API_PREFIX}/posts/${id}${suffix}`,
      `/api/posts/${id}${suffix}`,
      { cacheTtl: 6000 },
    );
    const item = post.post || post;
    return toPostShape(item);
  },

  async updatePost(id, body = {}) {
    const target = String(id || '').trim();
    if (!target) throw new Error('post id required');
    const payload = buildPostPayload(body);
    const send = (path) => request(path, {
      method: 'PATCH',
      body: JSON.stringify(payload),
      noCache: true,
    });

    let result;
    try {
      result = await send(`${API_PREFIX}/posts/${encodeURIComponent(target)}`);
    } catch (err) {
      if (!shouldFallbackWrite(err)) throw err;
      result = await send(`/api/posts/${encodeURIComponent(target)}`);
    }

    clearNetworkCaches({ postId: target });
    return result?.post ? { ...result, post: toPostShape(result.post) } : result;
  },

  async archivePost(id) {
    const target = String(id || '').trim();
    if (!target) throw new Error('post id required');
    const headers = {
      'Idempotency-Key': buildSessionIdempotencyKey('post-archive', target),
    };
    const result = await request(`${API_PREFIX}/posts/${encodeURIComponent(target)}`, {
      method: 'DELETE',
      headers,
      retryUnsafe: true,
    });
    clearNetworkCaches({ postId: target });
    return result;
  },

  async reportPost(id, reason, details = '') {
    const target = String(id || '').trim();
    if (!target) throw new Error('post id required');
    const normalizedReason = String(reason || '').trim().toLowerCase();
    if (!normalizedReason) throw new Error('report reason required');
    return request(`${API_PREFIX}/posts/${encodeURIComponent(target)}/report`, {
      method: 'POST',
      headers: {
        'Idempotency-Key': buildSessionIdempotencyKey('post-report', `${target}-${normalizedReason}`),
      },
      body: JSON.stringify({ reason: normalizedReason, details }),
      noCache: true,
      retryUnsafe: true,
    });
  },

  async createPost(body, idempotencyKey) {
    const payload = buildPostPayload(body);
    const headers = idempotencyKey ? { 'Idempotency-Key': String(idempotencyKey).trim() } : undefined;
    try {
      const result = await request(`${API_PREFIX}/posts`, {
        method: 'POST',
      headers,
      body: JSON.stringify(payload),
      retryUnsafe: Boolean(idempotencyKey),
      });
      clearNetworkCaches();
      return result;
    } catch (err) {
      if (!shouldFallbackWrite(err)) throw err;
      // legacy interface compatibility
      const {
        spotId, spotName, district, latitude, longitude,
        camera, lens, focal, aperture, shutter, iso,
      } = payload;
      const mediaFirst = (payload.media || [])[0]?.url || '';
      const result = await request('/api/posts', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          title: payload.title,
          cover: mediaFirst,
          media: payload.media,
          images: (payload.media || []).map((m) => m.url),
          content: payload.content,
          spotId,
          spotName,
          district,
          latitude,
          longitude,
          author: payload.author || getDefaultAuthor(),
          authorBio: payload.authorBio || '',
          gear: {
            camera: camera || '',
            lens: lens || '',
            focal: focal || '',
            aperture: aperture || '',
            shutter: shutter || '',
            iso: iso || '',
          },
          angle: payload.angle || '',
          direction: payload.direction || '',
          timeWindow: payload.timeWindow || '',
          bestTime: payload.bestTime || '',
          styles: payload.styles,
          tags: payload.tags,
        }),
      });
      clearNetworkCaches();
      return result;
    }
  },

  async getPostComments(id, options = {}) {
    const query = buildCommentsQuery({
      cursor: options.cursor,
      limit: options.limit || 20,
    });
    const primary = await safeRequestWithFallback(
      `${API_PREFIX}/posts/${id}/comments${query}`,
      `/api/posts/${id}/comments${query}`,
      { cacheTtl: 0, noCache: true },
    );
    return normalizePostCommentsResponse(primary);
  },

  async toggleLike(id, author, action = 'toggle') {
    const body = {
      author: (author || '').trim() || getDefaultAuthor(),
      action,
      avatar: getActorAvatar(),
    };
    const headers = { 'Idempotency-Key': buildSessionIdempotencyKey('post-like', `${id}-${action}`) };
    try {
      const fresh = await request(`${API_PREFIX}/posts/${id}/like`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        retryUnsafe: true,
      });
      if (action === 'like' || action === 'unlike') {
        clearNetworkCaches({ postId: id });
      }
      emitNotificationRefresh();
      return fresh;
    } catch (err) {
      if (!shouldFallbackWrite(err)) throw err;
      const fresh = await request(`/api/posts/${id}/like`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        retryUnsafe: true,
      });
      if (action === 'like' || action === 'unlike') {
        clearNetworkCaches({ postId: id });
      }
      emitNotificationRefresh();
      return fresh;
    }
  },

  async toggleFavorite(id, author, action = 'toggle') {
    const body = {
      author: (author || '').trim() || getDefaultAuthor(),
      action,
      avatar: getActorAvatar(),
    };
    const headers = { 'Idempotency-Key': buildSessionIdempotencyKey('post-favorite', `${id}-${action}`) };
    try {
      const fresh = await request(`${API_PREFIX}/posts/${id}/favorite`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        retryUnsafe: true,
      });
      if (action === 'favorite' || action === 'unfavorite') {
        clearNetworkCaches({ postId: id });
      }
      emitNotificationRefresh();
      return fresh;
    } catch (err) {
      if (!shouldFallbackWrite(err)) throw err;
      // optional fallback: legacy endpoint
      const res = await request(`/api/posts/${id}/favorite`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        retryUnsafe: true,
      });
      if (action === 'favorite' || action === 'unfavorite') {
        clearNetworkCaches({ postId: id });
      }
      emitNotificationRefresh();
      return { ...res, favorited: Boolean((res && res.favorited) || false) };
    }
  },

  async comment(id, author, text, idempotencyKey) {
    const body = {
      author: (author || '').trim() || getDefaultAuthor(),
      text: (text || '').trim(),
      avatar: getActorAvatar(),
    };
    const headers = idempotencyKey ? { 'Idempotency-Key': String(idempotencyKey).trim() } : undefined;
    if (!body.text) throw new Error('comment required');
    try {
      const fresh = await request(`${API_PREFIX}/posts/${id}/comments`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        retryUnsafe: Boolean(idempotencyKey),
      });
      clearNetworkCaches({ postId: id });
      emitNotificationRefresh();
      return fresh;
    } catch (err) {
      if (!shouldFallbackWrite(err)) throw err;
      const fresh = await request(`/api/posts/${id}/comment`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        retryUnsafe: Boolean(idempotencyKey),
      });
      clearNetworkCaches({ postId: id });
      emitNotificationRefresh();
      return fresh;
    }
  },

  async chat(message, context = {}) {
    return request('/api/agent/chat', {
      method: 'POST',
      body: JSON.stringify({ message, context }),
    });
  },

  async uploadMedia(fileUri, mime = 'image/jpeg', kind = 'image', sourceFile = null, idempotencyKey = '', onProgress) {
    const form = new FormData();
    const normalizedMime = String(mime || '').toLowerCase();
    const extension = normalizedMime.includes('video')
      ? (normalizedMime.includes('quicktime') ? 'mov' : 'mp4')
      : normalizedMime.includes('heic')
        ? 'heic'
        : normalizedMime.includes('heif')
          ? 'heif'
          : normalizedMime.includes('webp')
            ? 'webp'
            : normalizedMime.includes('png')
              ? 'png'
              : 'jpg';
    const fileName = `chupian-${Date.now()}.${extension}`;
    let browserFile = sourceFile;
    if (!browserFile && typeof window !== 'undefined' && /^(blob|data):/i.test(String(fileUri || ''))) {
      try {
        browserFile = await fetch(fileUri).then((response) => response.blob());
      } catch (_err) {
        browserFile = null;
      }
    }

    if (browserFile && typeof browserFile === 'object' && typeof browserFile.arrayBuffer === 'function') {
      form.append('file', browserFile, browserFile.name || fileName);
    } else {
      form.append('file', {
        uri: fileUri,
        name: fileName,
        type: mime,
      });
    }

    const headers = idempotencyKey
      ? { 'Idempotency-Key': String(idempotencyKey).trim() }
      : {};
    return request(`${API_PREFIX}/media/upload`, {
      method: 'POST',
      headers,
      body: form,
      timeout: 180_000,
      onUploadProgress: onProgress,
      // The upload route is idempotent by key; only retry writes with that guarantee.
      retryUnsafe: Boolean(idempotencyKey),
    });
  },
};
