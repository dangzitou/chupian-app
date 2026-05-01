import { Platform, Share } from 'react-native';

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
  if (Platform.OS === 'web' && typeof window !== 'undefined' && window.location?.origin) {
    return `${window.location.origin}/post/${encodeURIComponent(id)}`;
  }
  return `chupian://post/${encodeURIComponent(id)}`;
}

export async function shareText(message, title = '出片地图', shareUrl = '') {
  const text = String(message || '').trim();
  if (!text) throw new Error('分享内容为空');
  const url = String(shareUrl || '').trim();

  if (Platform.OS === 'web') {
    const browserNavigator = typeof navigator !== 'undefined' ? navigator : null;
    if (typeof browserNavigator?.share === 'function') {
      await browserNavigator.share({
        title,
        text,
        url: url || (typeof window !== 'undefined' ? window.location.href : undefined),
      });
      return 'shared';
    }
    if (typeof browserNavigator?.clipboard?.writeText === 'function') {
      await browserNavigator.clipboard.writeText([text, url].filter(Boolean).join('\n'));
      return 'copied';
    }
    throw new Error('当前浏览器不支持分享或复制');
  }

  await Share.share({ message: [text, url].filter(Boolean).join('\n'), title });
  return 'shared';
}

export function sharePost(post) {
  return shareText(buildPostShareMessage(post), post?.title || '出片地图', buildPostShareUrl(post));
}
