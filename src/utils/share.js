import { Platform, Share } from 'react-native';
import { PUBLIC_WEB_ORIGIN } from '../config';

export function buildPostShareMessage(post = {}) {
  const title = String(post?.title || '无标题').trim();
  const intro = [post?.content?.trim(), post?.spotName ? `📍 ${post.spotName}` : null]
    .filter(Boolean)
    .join('\n');
  return `${title}\n${intro ? `${intro}\n` : ''}—— 来自出片地图`;
}

export function buildPostShareUrl(post = {}) {
  const id = String(post?.id || '').trim();
  if (!id) return '';
  if (PUBLIC_WEB_ORIGIN) return `${PUBLIC_WEB_ORIGIN}/share/post/${encodeURIComponent(id)}`;
  return `chupian://post/${encodeURIComponent(id)}`;
}

function copyWithDocument(value) {
  if (typeof document === 'undefined' || typeof document.execCommand !== 'function') return false;
  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.setAttribute('readonly', 'true');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body?.appendChild(textarea);
  textarea.select();
  let copied = false;
  try {
    copied = document.execCommand('copy');
  } catch (_err) {
    copied = false;
  }
  textarea.parentNode?.removeChild(textarea);
  return copied;
}

export async function shareText(message, title = '出片地图', shareUrl = '') {
  const text = String(message || '').trim();
  if (!text) throw new Error('分享内容为空');
  const url = String(shareUrl || '').trim();

  if (Platform.OS === 'web') {
    const browserNavigator = typeof navigator !== 'undefined' ? navigator : null;
    const sharePayload = [text, url].filter(Boolean).join('\n');
    if (typeof browserNavigator?.share === 'function') {
      await browserNavigator.share({
        title,
        text,
        url: url || (typeof window !== 'undefined' ? window.location.href : undefined),
      });
      return 'shared';
    }
    if (typeof browserNavigator?.clipboard?.writeText === 'function') {
      await browserNavigator.clipboard.writeText(sharePayload);
      return 'copied';
    }
    if (copyWithDocument(sharePayload)) return 'copied';
    throw new Error('当前浏览器不支持分享或复制');
  }

  await Share.share({ message: [text, url].filter(Boolean).join('\n'), title });
  return 'shared';
}

export function sharePost(post) {
  return shareText(buildPostShareMessage(post), post?.title || '出片地图', buildPostShareUrl(post));
}
