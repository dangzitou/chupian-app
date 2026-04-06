export function buildPostShareMessage(post = {}) {
  const title = String(post?.title || '无标题').trim();
  const intro = [post?.content?.trim(), post?.spotName ? `📍 ${post.spotName}` : null]
    .filter(Boolean)
    .join('\n');
  return `${title}\n${intro ? `${intro}\n` : ''}—— 来自出片地图`;
}

