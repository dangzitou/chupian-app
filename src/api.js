import { API_BASE, API_PREFIX } from './config';
import { buildPostPayload, normalizePostShape } from './utils/postCodec';

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
  try {
    return `影友${Math.floor(Math.random() * 10000).toString().padStart(4, '0')}`;
  } catch (e) {
    return '匿名拍友';
  }
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
  return `${normalized}${filteredHeaders ? ` ${filteredHeaders}` : ''}`;
}

function shouldRetry(status, method, error) {
  if (!status) return true;
  if (method !== 'GET') return false;
  if (status >= 500 && status < 600) return true;
  return status === 408 || status === 429 || status === 503;
}

function shouldFallback(error) {
  if (!error) return false;
  if (error.name === 'TypeError' || error.name === 'AbortError') return true;
  if (error.status === 404 || error.status === 405 || error.status === 410) return true;
  return false;
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
  const finalHeaders = { ...headers, ...(options.headers || {}) };

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

function clearNetworkCaches() {
  inFlightGetRequests.clear();
  getResponseCache.clear();
}

function toPostShape(item) {
  return normalizePostShape(item);
}

export const api = {
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
    const q = new URLSearchParams({
      ...params,
      limit: String(params.limit || 20),
      sort: params.sort || 'latest',
    }).toString();

    const primary = await safeRequestWithFallback(
      `${API_PREFIX}/community/feed?${q}`,
      `/api/posts?${q}`,
      { cacheTtl: 2500, noCache: params.noCache },
    );

    const list = Array.isArray(primary.posts)
      ? primary.posts.map(toPostShape)
      : [];

    return {
      posts: list,
      nextCursor: primary.nextCursor || null,
      hasMore: Boolean(primary.hasMore),
      total: Number(primary.total || primary.posts?.length || 0),
      stats: primary.stats || null,
    };
  },

  async getPost(id, options = {}) {
    const userId = options.userId || null;
    const suffix = userId ? `?userId=${encodeURIComponent(userId)}` : '';
    const post = await safeRequestWithFallback(
      `${API_PREFIX}/posts/${id}${suffix}`,
      `/api/posts/${id}`,
      { cacheTtl: 6000 },
    );
    const item = post.post || post;
    return toPostShape(item);
  },

  async createPost(body) {
    const payload = buildPostPayload(body);
    try {
      return await request(`${API_PREFIX}/posts`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    } catch (err) {
      // legacy interface compatibility
      const { spotId, spotName, district, camera, lens, focal, aperture, shutter, iso } = payload;
      const mediaFirst = (payload.media || [])[0]?.url || '';
      return request('/api/posts', {
        method: 'POST',
        body: JSON.stringify({
          title: payload.title,
          cover: mediaFirst,
          media: payload.media,
          images: (payload.media || []).map((m) => m.url),
          content: payload.content,
          spotId,
          spotName,
          district,
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

  async toggleLike(id, author, action = 'toggle') {
    const body = {
      author: (author || '').trim() || getDefaultAuthor(),
      action,
    };
    try {
      const fresh = await request(`${API_PREFIX}/posts/${id}/like`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      if (action === 'like' || action === 'unlike') {
        clearNetworkCaches();
      }
      return fresh;
    } catch (err) {
      const fresh = await request(`/api/posts/${id}/like`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      if (action === 'like' || action === 'unlike') {
        clearNetworkCaches();
      }
      return fresh;
    }
  },

  async toggleFavorite(id, author, action = 'toggle') {
    const body = { author: (author || '').trim() || getDefaultAuthor(), action };
    try {
      const fresh = await request(`${API_PREFIX}/posts/${id}/favorite`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      if (action === 'favorite' || action === 'unfavorite') {
        clearNetworkCaches();
      }
      return fresh;
    } catch (err) {
      // optional fallback: legacy endpoint
      const res = await request(`/api/posts/${id}/favorite`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      if (action === 'favorite' || action === 'unfavorite') {
        clearNetworkCaches();
      }
      return { ...res, favorited: Boolean((res && res.favorited) || false) };
    }
  },

  async comment(id, author, text) {
    const body = {
      author: (author || '').trim() || getDefaultAuthor(),
      text: (text || '').trim(),
    };
    if (!body.text) throw new Error('comment required');
    try {
      const fresh = await request(`${API_PREFIX}/posts/${id}/comments`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      clearNetworkCaches();
      return fresh;
    } catch (err) {
      const fresh = await request(`/api/posts/${id}/comment`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      clearNetworkCaches();
      return fresh;
    }
  },

  async chat(message, context = {}) {
    return request('/api/agent/chat', {
      method: 'POST',
      body: JSON.stringify({ message, context }),
    });
  },

  async uploadMedia(fileUri, mime = 'image/jpeg') {
    const form = new FormData();
    const file = {
      uri: fileUri,
      name: `chupian-${Date.now()}.${mime.includes('video') ? 'mp4' : 'jpg'}`,
      type: mime,
    };
    form.append('file', file);

    try {
      return request(`${API_PREFIX}/media/upload`, {
        method: 'POST',
        headers: {},
        body: form,
      });
    } catch (err) {
      // backend 未接入上传时，直接透传 URI，前端仍可预览
      return { ok: true, media: [{ kind: mime.includes('video') ? 'video' : 'image', url: fileUri }] };
    }
  },
};
