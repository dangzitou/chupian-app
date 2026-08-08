import { API_BASE, API_PREFIX } from './config';
import { buildPostPayload, normalizePostShape } from './utils/postCodec';
import {
  clearAuthenticatedSession,
  getActorId,
  getActorName,
  getActorToken,
  refreshActorSession,
  setAuthenticatedSession,
} from './lib/actor';
import { buildSessionIdempotencyKey } from './lib/idempotency';

const NETWORK_TIMEOUT_MS = 12_000;
const GET_CACHE_TTL_MS = 4000;
const MAX_RETRIES = 2;

const inFlightGetRequests = new Map();
const getResponseCache = new Map();

class ApiError extends Error {
  constructor(message, { status, path, method, payload, cause } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.path = path;
    this.method = method;
    this.payload = payload;
    this.cause = cause;
  }
}

const getDefaultAuthor = () => {
  return getActorName();
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clonePayload(value) {
  if (value === undefined) return value;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (_err) {
    return value;
  }
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

function shouldRetry(status, method, error) {
  if (!status) return true;
  if (method !== 'GET') return false;
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

async function doRequest(path, options = {}) {
  const {
    method: customMethod = 'GET',
    body: requestBody,
    timeout: _timeout,
    noCache: _noCache,
    noDedup: _noDedup,
    cacheTtl: _cacheTtl,
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

  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new Error('请求超时'));
  }, timeout);

  try {
    const res = await fetch(`${API_BASE}${path}`, {
      ...forwardOptions,
      method,
      headers: finalHeaders,
      body: requestBody,
      signal: controller.signal,
    });
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
      });
    }

    return data;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    if (err?.name === 'AbortError') {
      throw new ApiError('请求超时，请稍后重试', { status: 0, path, method, cause: err });
    }
    if (err instanceof TypeError) {
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
          getResponseCache.set(key, {
            value: clonePayload(value),
            expiresAt: Date.now() + cacheTtl,
          });
        }
        return value;
      } catch (err) {
        lastError = err;
        if (err?.status === 401 && !refreshedSession && !path.endsWith('/auth/anonymous')) {
          refreshedSession = true;
          const actorId = await refreshActorSession();
          if (actorId && getActorToken()) continue;
        }
        if (!shouldRetry(err.status, method, err) || i >= MAX_RETRIES) {
          throw err;
        }
        await sleep(Math.min(1200, 120 * 2 ** i) + Math.floor(Math.random() * 80));
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

function clearNetworkCaches({ postId } = {}) {
  const targetPostPath = postId == null ? '' : `/posts/${encodeURIComponent(String(postId))}`;
  for (const key of getResponseCache.keys()) {
    const path = String(key).split(' actor:')[0];
    const isFeedCache = path.includes('/community/feed')
      || path.includes('/community/me/')
      || path.includes('/api/posts?');
    const isTargetPostCache = targetPostPath && path.includes(targetPostPath);
    if (isFeedCache || isTargetPostCache) {
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

  async updateProfile(displayName, bio = '') {
    const nextName = String(displayName || '').trim();
    if (!nextName) throw new Error('displayName required');
    const result = await request(`${API_PREFIX}/auth/me`, {
      method: 'PATCH',
      body: JSON.stringify({ displayName: nextName, bio: String(bio || '').trim() }),
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
    return safeRequestWithFallback('/api/v1/health', '/health');
  },

  async weather() {
    return safeRequestWithFallback(
      '/api/v1/weather',
      '/api/weather',
      { cacheTtl: 15_000 },
    );
  },

  async spots() {
    return safeRequestWithFallback(
      `${API_PREFIX}/spots`,
      '/api/spots',
      { cacheTtl: 30_000 },
    );
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

  async markNotificationRead(id) {
    const target = String(id || '').trim();
    if (!target) throw new Error('notification id required');
    return request(`${API_PREFIX}/notifications/${encodeURIComponent(target)}/read`, {
      method: 'POST',
      headers: { 'Idempotency-Key': buildSessionIdempotencyKey('notification-read', target) },
      body: JSON.stringify({}),
      noCache: true,
    });
  },

  async markAllNotificationsRead() {
    return request(`${API_PREFIX}/notifications/read-all`, {
      method: 'POST',
      headers: { 'Idempotency-Key': buildSessionIdempotencyKey('notification-read-all', 'current') },
      body: JSON.stringify({}),
      noCache: true,
    });
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
    const body = { action, author: getDefaultAuthor() };
    const headers = { 'Idempotency-Key': buildSessionIdempotencyKey('author-follow', `${target}-${action}`) };
    try {
      return await request(`${API_PREFIX}/authors/${encoded}/follow`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });
    } catch (err) {
      if (!shouldFallbackWrite(err)) throw err;
      return request(`/api/authors/${encoded}/follow`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });
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
    return request(`${API_PREFIX}/authors/${encoded}/block`, {
      method: 'POST',
      headers: { 'Idempotency-Key': buildSessionIdempotencyKey('author-block', `${target}-${action}`) },
      body: JSON.stringify(body),
      noCache: true,
    });
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

  async archivePost(id) {
    const target = String(id || '').trim();
    if (!target) throw new Error('post id required');
    const headers = {
      'Idempotency-Key': buildSessionIdempotencyKey('post-archive', target),
    };
    const result = await request(`${API_PREFIX}/posts/${encodeURIComponent(target)}`, {
      method: 'DELETE',
      headers,
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
    });
  },

  async createPost(body, idempotencyKey) {
    const payload = buildPostPayload(body);
    const headers = idempotencyKey ? { 'Idempotency-Key': String(idempotencyKey).trim() } : undefined;
    try {
      return await request(`${API_PREFIX}/posts`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });
    } catch (err) {
      if (!shouldFallbackWrite(err)) throw err;
      // legacy interface compatibility
      const {
        spotId, spotName, district, latitude, longitude,
        camera, lens, focal, aperture, shutter, iso,
      } = payload;
      const mediaFirst = (payload.media || [])[0]?.url || '';
      return request('/api/posts', {
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
          bestTime: payload.bestTime || 'day',
          styles: payload.styles,
          tags: payload.tags,
        }),
      });
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
    };
    const headers = { 'Idempotency-Key': buildSessionIdempotencyKey('post-like', `${id}-${action}`) };
    try {
      const fresh = await request(`${API_PREFIX}/posts/${id}/like`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });
      if (action === 'like' || action === 'unlike') {
        clearNetworkCaches({ postId: id });
      }
      return fresh;
    } catch (err) {
      if (!shouldFallbackWrite(err)) throw err;
      const fresh = await request(`/api/posts/${id}/like`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });
      if (action === 'like' || action === 'unlike') {
        clearNetworkCaches({ postId: id });
      }
      return fresh;
    }
  },

  async toggleFavorite(id, author, action = 'toggle') {
    const body = { author: (author || '').trim() || getDefaultAuthor(), action };
    const headers = { 'Idempotency-Key': buildSessionIdempotencyKey('post-favorite', `${id}-${action}`) };
    try {
      const fresh = await request(`${API_PREFIX}/posts/${id}/favorite`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });
      if (action === 'favorite' || action === 'unfavorite') {
        clearNetworkCaches({ postId: id });
      }
      return fresh;
    } catch (err) {
      if (!shouldFallbackWrite(err)) throw err;
      // optional fallback: legacy endpoint
      const res = await request(`/api/posts/${id}/favorite`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });
      if (action === 'favorite' || action === 'unfavorite') {
        clearNetworkCaches({ postId: id });
      }
      return { ...res, favorited: Boolean((res && res.favorited) || false) };
    }
  },

  async comment(id, author, text, idempotencyKey) {
    const body = {
      author: (author || '').trim() || getDefaultAuthor(),
      text: (text || '').trim(),
    };
    const headers = idempotencyKey ? { 'Idempotency-Key': String(idempotencyKey).trim() } : undefined;
    if (!body.text) throw new Error('comment required');
    try {
      const fresh = await request(`${API_PREFIX}/posts/${id}/comments`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });
      clearNetworkCaches({ postId: id });
      return fresh;
    } catch (err) {
      if (!shouldFallbackWrite(err)) throw err;
      const fresh = await request(`/api/posts/${id}/comment`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });
      clearNetworkCaches({ postId: id });
      return fresh;
    }
  },

  async chat(message, context = {}) {
    return request('/api/agent/chat', {
      method: 'POST',
      body: JSON.stringify({ message, context }),
    });
  },

  async uploadMedia(fileUri, mime = 'image/jpeg', kind = 'image', sourceFile = null, idempotencyKey = '') {
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
    });
  },
};
