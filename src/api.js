import { API_BASE, API_PREFIX, POST_FIELD_LIMIT } from './config';

const getDefaultAuthor = () => {
  try {
    return `影友${Math.floor(Math.random() * 10000).toString().padStart(4, '0')}`;
  } catch (e) {
    return '匿名拍友';
  }
};

async function request(path, options = {}) {
  const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
  const headers = isFormData ? {} : { 'Content-Type': 'application/json' };
  const finalHeaders = { ...headers, ...(options.headers || {}) };

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: finalHeaders,
  });
  const text = await res.text();

  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch (err) {
    throw new Error(`服务器返回非 JSON 响应（HTTP ${res.status}）`);
  }

  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data;
}

function splitTags(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  return String(raw)
    .split(/[,，/|#\s]+/)
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, POST_FIELD_LIMIT.tags);
}

function toPostShape(item) {
  const media = Array.isArray(item.media)
    ? item.media
    : (item.images || []).map((url) => ({ kind: 'image', url }));

  const tags = splitTags(item.tags || item.topics);
  const styles = splitTags(item.styles);
  const angle = item.angle || item.direction || '';

  return {
    id: item.id,
    title: item.title || '无标题',
    content: item.content || '',
    author: item.author || item.nickname || '匿名拍友',
    authorBio: item.authorBio || '',
    avatar: item.avatar || '',
    spotId: item.spotId || item.locationId || '',
    spotName: item.spotName || item.locationName || '',
    district: item.district || '',
    cover: item.cover || media?.[0]?.url || '',
    media: media.map((m) => ({
      kind: m.kind || (m.type === 'video' ? 'video' : 'image'),
      url: m.url,
      width: m.width || 0,
      height: m.height || 0,
      duration: m.duration || 0,
      cover: m.cover || '',
    })),
    angle: angle || '',
    direction: item.direction || '',
    timeWindow: item.timeWindow || item.shotTime || '',
    bestTime: item.bestTime || '',
    shotAt: item.shotAt || item.shootTime || '',
    gear: {
      camera: item.gear?.camera || item.camera || '',
      lens: item.gear?.lens || item.lens || '',
      focal: item.gear?.focal || item.focalLength || '',
      aperture: item.gear?.aperture || '',
      shutter: item.gear?.shutter || '',
      iso: item.gear?.iso || '',
      whiteBalance: item.gear?.whiteBalance || '',
    },
    tags,
    styles,
    comments: Array.isArray(item.comments)
      ? item.comments.map((c) => ({
          id: c.id,
          author: c.author || '匿名拍友',
          text: c.text || c.content || '',
          createdAt: c.createdAt || c.created_at || new Date().toISOString(),
        }))
      : [],
    likes: Number(item.likes || item.likeCount || 0),
    favorites: Number(item.favorites || item.favoriteCount || 0),
    views: Number(item.views || item.viewCount || 0),
    liked: Boolean(item.liked),
    favorited: Boolean(item.favorited),
    createdAt: item.createdAt || item.created_at || item.createdAtUTC || new Date().toISOString(),
  };
}

async function safeRequestWithFallback(primaryPath, fallbackPath, options = {}) {
  try {
    return await request(primaryPath, options);
  } catch (err) {
    if (!fallbackPath) throw err;
    return request(fallbackPath, options);
  }
}

export const api = {
  async health() {
    return request(`${API_PREFIX}/health`);
  },

  async weather() {
    try {
      return request('/api/v1/weather');
    } catch (err) {
      return request('/api/weather');
    }
  },

  async spots() {
    try {
      const d = await request(`${API_PREFIX}/spots`);
      return d;
    } catch (err) {
      const legacy = await request('/api/spots');
      return legacy;
    }
  },

  async feed(params = {}) {
    const q = new URLSearchParams({
      ...params,
      limit: String(params.limit || 20),
      sort: params.sort || 'latest',
    }).toString();

    const primary = await safeRequestWithFallback(`${API_PREFIX}/community/feed?${q}`, `/api/posts?${q}`);

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
    const post = await safeRequestWithFallback(`${API_PREFIX}/posts/${id}${suffix}`, `/api/posts/${id}`);
    const item = post.post || post;
    return toPostShape(item);
  },

  async createPost(body) {
    const payload = {
      ...body,
      title: (body.title || '').slice(0, POST_FIELD_LIMIT.title),
      content: (body.content || '').slice(0, POST_FIELD_LIMIT.content),
      tags: splitTags(body.tags),
      styles: splitTags(body.styles),
    };
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
      return request(`${API_PREFIX}/posts/${id}/like`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
    } catch (err) {
      return request(`/api/posts/${id}/like`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
    }
  },

  async toggleFavorite(id, author, action = 'toggle') {
    const body = { author: (author || '').trim() || getDefaultAuthor(), action };
    try {
      return request(`${API_PREFIX}/posts/${id}/favorite`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
    } catch (err) {
      // optional fallback: legacy endpoint
      const res = await request(`/api/posts/${id}/favorite`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
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
      return request(`${API_PREFIX}/posts/${id}/comments`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
    } catch (err) {
      return request(`/api/posts/${id}/comment`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
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
