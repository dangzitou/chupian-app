import { POST_FIELD_LIMIT } from '../config';

export function splitTags(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  return String(raw)
    .split(/[,，/|#\s]+/)
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, POST_FIELD_LIMIT.tags);
}

export function normalizeMediaItem(item = {}) {
  return {
    kind: item.kind || item.type || item.mediaType || 'image',
    url: item.url || '',
    width: Number(item.width || 0),
    height: Number(item.height || 0),
    duration: Number(item.duration || 0),
    cover: item.cover || '',
  };
}

export function toShotParamPairs(post) {
  const rows = [
    ['机位', post.angle || post.direction || ''],
    ['方向', post.direction || ''],
    ['地点', post.spotName || post.locationName || ''],
    ['时间窗口', post.timeWindow || post.shotTime || ''],
    ['时段', post.bestTime || ''],
    ['相机', post.gear?.camera || post.camera || ''],
    ['镜头', post.gear?.lens || post.lens || ''],
    ['焦距', post.gear?.focal || post.focal || post.focalLength || ''],
    ['光圈', post.gear?.aperture || post.aperture || ''],
    ['快门', post.gear?.shutter || post.shutter || ''],
    ['ISO', post.gear?.iso || post.iso || ''],
    ['白平衡', post.gear?.whiteBalance || post.whiteBalance || ''],
  ];
  return rows.filter(([, value]) => Boolean(value));
}

export function normalizePostShape(item = {}) {
  const media = Array.isArray(item.media)
    ? item.media
    : (item.images || []).map((url) => ({ kind: 'image', url }));
  const tags = splitTags(item.tags || item.topics);
  const styles = splitTags(item.styles);

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
    media: media.map(normalizeMediaItem),
    angle: item.angle || item.direction || '',
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
      ? item.comments.map((c = {}) => ({
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

export function buildPostPayload(raw = {}) {
  return {
    ...raw,
    title: (raw.title || '').trim().slice(0, POST_FIELD_LIMIT.title),
    content: (raw.content || '').trim().slice(0, POST_FIELD_LIMIT.content),
    tags: splitTags(raw.tags),
    styles: splitTags(raw.styles),
  };
}
