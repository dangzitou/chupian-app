import { TIME_LABELS } from '../config';
import { formatCompactDate } from './time';

const LABELS = {
  time: '时段',
  angle: '机位',
  direction: '方向',
  window: '时间窗口',
  shotAt: '拍摄',
  camera: '机身',
  lens: '镜头',
  focal: '焦段',
  aperture: '光圈',
  shutter: '快门',
  iso: 'ISO',
  whiteBalance: '白平衡',
  location: '地点',
};

export function buildShotMetaLines(raw = {}, options = {}) {
  const includeLocation = Boolean(options.includeLocation);
  const includeSpot = Boolean(options.includeSpot);
  const includeMedia = Boolean(options.includeMedia);
  const maxItems = Number.isFinite(options.maxItems) ? Number(options.maxItems) : 99;

  const source = raw || {};
  const focal = source.focalLength || source.focal || source.gear?.focal || source.gear?.focalLength || '';
  const camera = source.camera || source.gear?.camera || '';
  const lens = source.lens || source.gear?.lens || '';
  const spotName = source.spotName || source.locationName || '';
  const district = source.district || '';
  const mediaKind = source.mediaKind || source.media?.[0]?.kind || source.kind || (Array.isArray(source.media) && source.media.length ? 'image' : '');
  const mediaCount = Array.isArray(source.media)
    ? source.media.length
    : (Number.isFinite(Number(source.mediaCount)) ? Number(source.mediaCount) : 0);

  const locationLine = (() => {
    if (!(includeSpot || includeLocation) || !String(spotName).trim()) return null;
    return `${LABELS.location}：${String(spotName).trim()}${district ? ` · ${district}` : ''}`;
  })();

  const mediaLabel = (() => {
    const kind = String(mediaKind || '').toLowerCase();
    if (kind === 'video') return '视频';
    if (kind === 'live') return '实况';
    if (kind === 'image') return '图片';
    return '素材';
  })();

  const rows = [
    source.bestTime ? `${LABELS.time}：${TIME_LABELS[source.bestTime] || source.bestTime}` : null,
    source.angle ? `${LABELS.angle}：${source.angle}` : null,
    source.direction ? `${LABELS.direction}：${source.direction}` : null,
    source.timeWindow ? `${LABELS.window}：${source.timeWindow}` : null,
    source.shotAt ? `${LABELS.shotAt}：${formatCompactDate(source.shotAt)}` : null,
    camera ? `${LABELS.camera}：${camera}` : null,
    lens ? `${LABELS.lens}：${lens}` : null,
    focal ? `${LABELS.focal}：${focal}` : null,
    source.aperture ? `${LABELS.aperture}：${source.aperture}` : null,
    source.shutter ? `${LABELS.shutter}：${source.shutter}` : null,
    source.iso ? `${LABELS.iso}：${source.iso}` : null,
    source.whiteBalance ? `${LABELS.whiteBalance}：${source.whiteBalance}` : null,
  ];

  if (includeMedia) {
    if (mediaKind) {
      const count = mediaCount || 1;
      rows.push(`${mediaLabel} · ${count}`);
    }
  }

  if (locationLine) rows.unshift(locationLine);

  return rows
    .filter(Boolean)
    .filter((line) => line && String(line).trim())
    .filter((line, index, arr) => arr.indexOf(line) === index)
    .slice(0, Math.max(0, maxItems));
}
