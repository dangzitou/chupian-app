import { splitTags } from './postCodec';
import { MAX_MEDIA_UPLOAD_BYTES } from '../config';

const FIELD_LIMITS = {
  title: 90,
  content: 3000,
  tags: 12,
  styles: 12,
  spotName: 80,
  district: 24,
  mediaList: 9,
  author: 18,
};

function normalize(value) {
  return String(value || '').trim();
}

function isValidDate(value) {
  if (!value) return true;
  const parsed = new Date(String(value).replace(/\//g, '-'));
  return !Number.isNaN(parsed.getTime());
}

function isPositiveInteger(value) {
  const trimmed = normalize(value);
  if (!trimmed) return true;
  return /^\d+$/.test(trimmed);
}

export function validatePostDraft(state = {}, mediaList = []) {
  const errors = {};
  const title = normalize(state.title);
  const content = normalize(state.content);
  const spotName = normalize(state.spotName);
  const district = normalize(state.district);
  const shotAt = normalize(state.shotAt);
  const author = normalize(state.author);
  const authorBio = normalize(state.authorBio);

  const tags = splitTags(state.tags);
  const styles = splitTags(state.stylesText);

  if (title.length > FIELD_LIMITS.title) errors.title = `标题不能超过${FIELD_LIMITS.title}字`;

  if (content.length > FIELD_LIMITS.content) errors.content = `正文不能超过${FIELD_LIMITS.content}字`;

  if (!mediaList.length) errors.media = '请至少上传1张图片/视频';
  if (mediaList.length > FIELD_LIMITS.mediaList) errors.media = `素材不能超过${FIELD_LIMITS.mediaList}个`;
  if (mediaList.some((item) => (
    Number(item?.size || 0) > MAX_MEDIA_UPLOAD_BYTES
    || Number(item?.pairedVideo?.size || 0) > MAX_MEDIA_UPLOAD_BYTES
  ))) {
    errors.media = '单个图片、实况或视频不能超过120MB';
  }

  if (tags.length > FIELD_LIMITS.tags) errors.tags = `标签最多${FIELD_LIMITS.tags}个`;
  if (styles.length > FIELD_LIMITS.styles) errors.stylesText = `风格标签最多${FIELD_LIMITS.styles}个`;

  if (spotName && spotName.length > FIELD_LIMITS.spotName) {
    errors.spotName = `地点名称不能超过${FIELD_LIMITS.spotName}字`;
  }
  if (district && district.length > FIELD_LIMITS.district) {
    errors.district = `行政区不能超过${FIELD_LIMITS.district}字`;
  }

  if (author && author.length > FIELD_LIMITS.author) errors.author = `昵称不能超过${FIELD_LIMITS.author}字`;
  if (authorBio && authorBio.length > 80) errors.authorBio = '简介不能超过80字';

  if (shotAt && !isValidDate(shotAt)) {
    errors.shotAt = '拍摄时间格式错误，请使用 2026-08-08 20:30';
  }
  if (!isPositiveInteger(state.iso)) {
    errors.iso = 'ISO 建议填写正整数';
  }

  const firstError = Object.keys(errors)[0]
    ? errors[Object.keys(errors)[0]]
    : '';

  return {
    errors,
    isValid: Object.keys(errors).length === 0,
    firstError,
  };
}
