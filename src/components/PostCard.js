import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { COLORS } from '../config';
import ActionBar from './ActionBar';
import MediaGallery from './MediaGallery';

function formatShortTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const now = Date.now();
  const delta = now - date.getTime();
  const m = Math.floor(delta / 60000);
  if (m < 1) return '刚刚';
  if (m < 60) return `${m}分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}小时前`;
  const d = Math.floor(h / 24);
  return `${d}天前`;
}

export default function PostCard({ post, onPress, onLike, onFavorite, onComment }) {
  const tags = [...(post.styles || []), ...(post.tags || [])].filter(Boolean).slice(0, 3);
  const gearText = [
    post.angle || null,
    post.direction || null,
    post.timeWindow || null,
    post.bestTime || null,
  ].filter(Boolean);
  const cardMedia = post.media || [];

  return (
    <Pressable style={styles.card} onPress={onPress}>
      <View style={styles.header}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{(post.author || '拍').slice(0, 1)}</Text>
        </View>
        <View style={styles.meta}>
          <Text style={styles.author} numberOfLines={1}>
            {post.author}
          </Text>
          <Text style={styles.sub}>
            {(post.spotName || '未知地点')}{post.timeWindow ? ` · ${post.timeWindow}` : ''}
          </Text>
          <Text style={styles.sub}>{formatShortTime(post.createdAt)}</Text>
        </View>
        <View style={styles.countWrap}>
          <Text style={styles.countText}>{post.likes || 0}</Text>
          <Text style={styles.countHint}>赞</Text>
        </View>
      </View>

      <MediaGallery media={cardMedia} showAll columns={cardMedia?.length > 1 ? 1 : 1} />
      {cardMedia.length > 1 ? <Text style={styles.multiMark}>▢ {cardMedia.length} 张素材</Text> : null}

      <View style={styles.body}>
        <Text style={styles.title} numberOfLines={2}>
          {post.title || '无标题'}
        </Text>
        {!!post.content && <Text style={styles.content} numberOfLines={3}>{post.content}</Text>}

        {!!gearText.length ? <Text style={styles.param} numberOfLines={1}>📷 {gearText.join(' · ')}</Text> : null}
        {gearText.length === 0 && (post.gear?.camera || post.gear?.focal) ? (
          <Text style={styles.param} numberOfLines={1}>
            📷 {[post.gear?.camera, post.gear?.lens, post.gear?.focal].filter(Boolean).join(' · ')}
          </Text>
        ) : null}

        {tags.length > 0 ? (
          <View style={styles.tags}>
            {tags.map((tag) => (
              <Text style={styles.tag} key={tag}>#{tag}</Text>
            ))}
          </View>
        ) : null}

        <ActionBar
          likes={post.likes || 0}
          favorites={post.favorites || 0}
          comments={post.comments?.length || 0}
          liked={post.liked}
          favorited={post.favorited}
          onLike={onLike}
          onFavorite={onFavorite}
          onComment={onComment}
        />
      </View>
    </Pressable>
  );
}

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
  body: { paddingHorizontal: 12, paddingTop: 6 },
  title: { fontSize: 16, color: COLORS.ink, fontWeight: '700', lineHeight: 21 },
  content: {
    marginTop: 6,
    color: COLORS.ink,
    fontSize: 13,
    lineHeight: 19,
  },
  param: {
    marginTop: 7,
    color: COLORS.muted,
    fontSize: 11.5,
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
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  tag: {
    backgroundColor: COLORS.accentBg,
    color: COLORS.accent,
    borderRadius: 999,
    fontSize: 11,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  countWrap: {
    alignItems: 'center',
    minWidth: 34,
    backgroundColor: COLORS.accentBg,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  countText: {
    color: COLORS.accent,
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 15,
  },
  countHint: {
    color: COLORS.accent,
    fontSize: 10,
    marginTop: 1,
  },
});
