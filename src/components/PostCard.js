import React, { memo, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { COLORS } from '../config';
import ActionBar from './ActionBar';
import MediaGallery from './MediaGallery';
import ShotMetaPanel from './ShotMetaPanel';
import { formatRelativeTime } from '../utils/time';

function AuthorAvatar({ name }) {
  const label = String(name || '匿名').trim().slice(0, 2) || '拍';
  return <Text style={styles.avatarText}>{label}</Text>;
}

function TagPill({ children }) {
  return <Text style={styles.tagPill}>{children}</Text>;
}

function PostCard({
  post,
  onPress,
  onLike,
  onFavorite,
  onComment,
  likeBusy = false,
  favoriteBusy = false,
}) {
  const [expanded, setExpanded] = useState(false);
  const cardMedia = post.media || [];
  const mediaColumns = cardMedia.length > 1 ? Math.min(cardMedia.length, 3) : 1;
  const tags = [...(post.styles || []), ...(post.tags || [])].filter(Boolean).slice(0, 3);
  const shotBits = [
    post.angle ? `📷 ${post.angle}` : null,
    post.direction ? `方向 ${post.direction}` : null,
    post.timeWindow ? `⏱ ${post.timeWindow}` : null,
    post.bestTime ? `时段 ${post.bestTime}` : null,
    post.gear?.camera || post.camera ? `机身 ${post.gear?.camera || post.camera}` : null,
    post.gear?.lens || post.lens ? `镜头 ${post.gear?.lens || post.lens}` : null,
    post.gear?.focal || post.focalLength ? `焦距 ${post.gear?.focal || post.focalLength}` : null,
  ].filter(Boolean);
  const content = String(post.content || '').trim();
  const shouldCut = content.length > 96 && !expanded;
  const contentText = shouldCut ? `${content.slice(0, 96)}...` : content;
  const created = formatRelativeTime(post.createdAt);

  const locationText = [post.spotName || '未知地点', post.district].filter(Boolean).join(' · ') || '匿名作品';
  const subtitle = useMemo(() => {
    const statPieces = [
      post.views ? `${post.views} 浏览` : null,
      post.likes ? `${post.likes} 赞` : null,
      post.comments?.length ? `${post.comments.length} 评论` : null,
    ].filter(Boolean);
    return statPieces.join(' · ');
  }, [post.comments?.length, post.likes, post.views]);

  return (
    <Pressable style={styles.card} onPress={onPress}>
      <View style={styles.header}>
        <View style={styles.avatar}>
          <AuthorAvatar name={post.author} />
        </View>
        <View style={styles.meta}>
          <Text style={styles.author} numberOfLines={1}>
            {post.author}
          </Text>
          <Text style={styles.sub}>{locationText}</Text>
          <Text style={styles.sub}>{created}</Text>
        </View>
        <View>
          <Pressable style={styles.followBtn}>
            <Text style={styles.followText}>关注</Text>
          </Pressable>
        </View>
      </View>

      <MediaGallery media={cardMedia} showAll columns={mediaColumns} />
      {cardMedia.length > 1 ? <Text style={styles.multiMark}>▢ {cardMedia.length} 张素材</Text> : null}

      <View style={styles.body}>
        <Text style={styles.title} numberOfLines={2}>
          {post.title || '无标题'}
        </Text>
        {!!content && (
          <>
            <Text style={styles.content} numberOfLines={expanded ? undefined : 2}>
              {contentText}
            </Text>
            {content.length > 96 ? (
              <Pressable onPress={() => setExpanded((v) => !v)} style={styles.expandWrap}>
                <Text style={styles.expandText}>{expanded ? '收起' : '展开全文'}</Text>
              </Pressable>
            ) : null}
          </>
        )}

        <View style={styles.tagRow}>
          {shotBits.slice(0, 5).map((item) => (
            <TagPill key={item}>{item}</TagPill>
          ))}
        </View>

        {tags.length > 0 ? (
          <View style={styles.tagsWrap}>
            {tags.map((tag) => (
              <Text style={styles.tagPill} key={tag}>#{tag}</Text>
            ))}
          </View>
        ) : null}

        <ShotMetaPanel post={post} compact />

        {subtitle ? <Text style={styles.subStat}>{subtitle}</Text> : null}

        <ActionBar
          likes={post.likes || 0}
          favorites={post.favorites || 0}
          comments={post.comments?.length || 0}
          liked={post.liked}
          favorited={post.favorited}
          likeBusy={likeBusy}
          favoriteBusy={favoriteBusy}
          onLike={onLike}
          onFavorite={onFavorite}
          onComment={onComment}
        />
      </View>
    </Pressable>
  );
}

export default memo(PostCard);

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    overflow: 'hidden',
    marginHorizontal: 12,
    marginBottom: 14,
    paddingBottom: 10,
    gap: 6,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    gap: 8,
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: COLORS.accentBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: COLORS.accent,
    fontSize: 14,
    fontWeight: '700',
  },
  meta: { flex: 1 },
  author: { fontSize: 13.5, color: COLORS.ink, fontWeight: '700' },
  sub: { fontSize: 11.5, color: COLORS.muted, marginTop: 1 },
  body: { paddingHorizontal: 12, paddingTop: 6, gap: 6 },
  title: { fontSize: 16, color: COLORS.ink, fontWeight: '700', lineHeight: 21 },
  content: {
    marginTop: 6,
    color: COLORS.ink,
    fontSize: 13,
    lineHeight: 19,
  },
  tagPill: {
    backgroundColor: COLORS.accentBg,
    color: COLORS.accent,
    borderRadius: 999,
    fontSize: 10.5,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  tagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 6,
  },
  expandWrap: { marginTop: 2 },
  expandText: { color: COLORS.accent, fontSize: 12, fontWeight: '600' },
  subStat: {
    color: COLORS.muted,
    fontSize: 11,
    marginTop: 4,
  },
  followBtn: {
    borderRadius: 999,
    backgroundColor: COLORS.accentBg,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  followText: {
    color: COLORS.accent,
    fontSize: 11.5,
    fontWeight: '700',
  },
  tagsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 8,
  },
  multiMark: {
    position: 'absolute',
    right: 14,
    bottom: 14,
    color: COLORS.onAccent,
    fontSize: 11,
    fontWeight: '700',
    backgroundColor: 'rgba(0,0,0,0.56)',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
    overflow: 'hidden',
  },
});
