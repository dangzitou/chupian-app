import React, { memo, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { COLORS } from '../config';
import ActionBar from './ActionBar';
import MediaGallery from './MediaGallery';
import ShotMetaBoard from './ShotMetaBoard';
import { toShotParamPairs } from '../utils/postCodec';
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
  onAuthorPress,
  onLike,
  onFavorite,
  onComment,
  onShare,
  onManage,
  onFollow,
  showFollow = true,
  hideCompactAuthor = false,
  likeBusy = false,
  favoriteBusy = false,
  followBusy = false,
  manageBusy = false,
  compact = false,
  style,
}) {
  const [expanded, setExpanded] = useState(false);
  const [cardWidth, setCardWidth] = useState(0);
  const cardMedia = post.media || [];
  const mediaColumns = cardMedia.length > 1 ? Math.min(cardMedia.length, 3) : 1;
  const mediaSummary = useMemo(() => {
    const counts = cardMedia.reduce((acc, item) => {
      const kind = String(item?.kind || 'image');
      if (kind === 'live') acc.live += 1;
      else if (kind === 'video') acc.video += 1;
      else acc.image += 1;
      return acc;
    }, { image: 0, video: 0, live: 0 });
    const chips = [];
    if (counts.image) chips.push(`图片 ${counts.image}`);
    if (counts.video) chips.push(`视频 ${counts.video}`);
    if (counts.live) chips.push(`实况 ${counts.live}`);
    return chips.join(' · ');
  }, [cardMedia]);
  const shotBits = useMemo(() => {
    return toShotParamPairs(post)
      .slice(0, compact ? 3 : 5)
      .map(([name, value]) => `${name}: ${value}`);
  }, [compact, post]);
  const tags = [...(post.styles || []), ...(post.tags || [])].filter(Boolean).slice(0, compact ? 2 : 3);
  const compactParam = shotBits[0] || tags[0] || '';
  const content = String(post.content || '').trim();
  const shouldCut = content.length > 96 && !expanded;
  const contentText = shouldCut ? `${content.slice(0, 96)}...` : content;
  const created = formatRelativeTime(post.createdAt);

  const locationText = [post.spotName || '未知地点', post.district].filter(Boolean).join(' · ') || '匿名作品';
  const subtitle = useMemo(() => {
    const totalComments = Number(post.commentsCount || (post.comments?.length || 0));
    const statPieces = [
      post.views ? `${post.views} 浏览` : null,
      post.likes ? `${post.likes} 赞` : null,
      totalComments ? `${totalComments} 评论` : null,
    ].filter(Boolean);
    return statPieces.join(' · ');
  }, [post.comments?.length, post.commentsCount, post.likes, post.views]);
  const isFollowing = Boolean(post.followed);
  const followLabel = isFollowing ? '已关注' : '关注';
  const followable = Boolean(post.authorId);

  if (compact) {
    return (
      <View
        style={[styles.card, styles.cardCompact, style]}
        onLayout={(event) => {
          const nextWidth = Math.floor(event.nativeEvent.layout.width);
          if (nextWidth && nextWidth > 0 && nextWidth !== cardWidth) {
            setCardWidth(nextWidth);
          }
        }}
      >
        <View style={styles.compactMediaWrap}>
          <MediaGallery
            media={cardMedia}
            onPressImage={onPress}
            showAll={false}
            columns={1}
            containerWidth={Math.max(0, cardWidth - 4)}
          />
          {cardMedia.length > 1 ? (
            <Text style={styles.multiMark}>▢ {cardMedia.length}</Text>
          ) : null}
        </View>
        <View style={styles.compactBody}>
          <Pressable onPress={onPress}>
          <Text style={styles.titleCompact} numberOfLines={2}>{post.title || '出片记录'}</Text>
          </Pressable>
          <View style={styles.compactMetaLine}>
            <Text style={styles.compactLocation} numberOfLines={1}>{locationText}</Text>
            {!!compactParam ? (
              <Text style={styles.compactParam} numberOfLines={1}>{compactParam}</Text>
            ) : null}
          </View>
          <View style={styles.compactFooter}>
            {hideCompactAuthor ? <View style={styles.compactAuthorSpacer} /> : (
              <Pressable style={styles.compactAuthor} onPress={onAuthorPress || onPress}>
                <View style={styles.avatarCompact}>
                  <AuthorAvatar name={post.author} />
                </View>
                <Text style={styles.compactAuthorText} numberOfLines={1}>{post.author}</Text>
              </Pressable>
            )}
            <ActionBar
              compact
              likes={post.likes || 0}
              favorites={post.favorites || 0}
              comments={post.commentsCount || post.comments?.length || 0}
              liked={post.liked}
              favorited={post.favorited}
              likeBusy={likeBusy}
              favoriteBusy={favoriteBusy}
              onLike={onLike}
              onFavorite={onFavorite}
              onComment={onComment}
              onShare={null}
            />
            {onManage ? (
              <Pressable
                style={styles.manageBtn}
                onPress={onManage}
                disabled={manageBusy}
                accessibilityRole="button"
                accessibilityLabel="管理这条出片记录"
              >
                <Text style={styles.manageText}>{manageBusy ? '…' : '⋯'}</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      </View>
    );
  }

  return (
    <View
      style={[styles.card, compact && styles.cardCompact, style]}
      onLayout={(event) => {
        const nextWidth = Math.floor(event.nativeEvent.layout.width);
        if (nextWidth && nextWidth > 0 && nextWidth !== cardWidth) {
          setCardWidth(nextWidth);
        }
      }}
    >
      <View style={[styles.header, compact && styles.headerCompact]}>
        <Pressable style={styles.authorTap} onPress={onAuthorPress || onPress}>
          <View style={[styles.avatar, compact && styles.avatarCompact]}>
            <AuthorAvatar name={post.author} />
          </View>
          <View style={styles.meta}>
            <Text style={[styles.author, compact && styles.authorCompact]} numberOfLines={1}>
              {post.author}
            </Text>
            <Text style={[styles.sub, compact && styles.subCompact]}>{locationText}</Text>
            <Text style={[styles.sub, compact && styles.subCompact]}>{created}</Text>
          </View>
        </Pressable>
        {showFollow ? (
          <View style={compact && styles.followWrapCompact}>
            <Pressable
              style={[styles.followBtn, isFollowing && styles.followBtnActive]}
              disabled={!onFollow || followBusy || !followable}
              onPress={() => onFollow?.(post.authorId)}
            >
              <Text style={[styles.followText, isFollowing && styles.followTextActive]}>{followLabel}</Text>
            </Pressable>
          </View>
        ) : null}
      </View>

      <View style={styles.mediaTapWrap}>
        <MediaGallery
          media={cardMedia}
          onPressImage={onPress}
          showAll={!compact}
          columns={compact ? 1 : mediaColumns}
          containerWidth={compact ? Math.max(0, cardWidth - 4) : 0}
        />
        {cardMedia.length > 1 ? <Text style={styles.multiMark}>▢ {cardMedia.length} 张素材</Text> : null}
      </View>

      <View style={[styles.body, compact && styles.bodyCompact]}>
        <Pressable onPress={onPress}>
          <Text style={[styles.title, compact && styles.titleCompact]} numberOfLines={2}>
            {post.title || '无标题'}
          </Text>
          {!!content ? (
            <Text style={[styles.content, compact && styles.contentCompact]} numberOfLines={expanded ? undefined : 2}>
              {contentText}
            </Text>
          ) : null}
        </Pressable>
        {content.length > 96 ? (
          <Pressable onPress={() => setExpanded((v) => !v)} style={styles.expandWrap}>
            <Text style={styles.expandText}>{expanded ? '收起' : '展开全文'}</Text>
          </Pressable>
        ) : null}

        <View style={styles.tagRow}>
          {shotBits.slice(0, compact ? 3 : 5).map((item) => (
            <TagPill key={item}>{item}</TagPill>
          ))}
          {mediaSummary ? <TagPill>素材 {mediaSummary}</TagPill> : null}
        </View>

        {tags.length > 0 ? (
          <View style={styles.tagsWrap}>
            {tags.map((tag) => (
              <Text style={styles.tagPill} key={tag}>#{tag}</Text>
            ))}
          </View>
        ) : null}

        <ShotMetaBoard
          source={post}
          options={{ includeSpot: true, includeLocation: true, includeMedia: false, maxItems: 5 }}
          compact
          showPanel={false}
          showStrip
          fallback={null}
        />

        {compact ? null : subtitle ? <Text style={styles.subStat}>{subtitle}</Text> : null}

        <ActionBar
          likes={post.likes || 0}
          favorites={post.favorites || 0}
          comments={post.commentsCount || post.comments?.length || 0}
          liked={post.liked}
          favorited={post.favorited}
          likeBusy={likeBusy}
          favoriteBusy={favoriteBusy}
          onLike={onLike}
          onFavorite={onFavorite}
          onComment={onComment}
          onShare={onShare}
          compact={compact}
        />
      </View>
    </View>
  );
}

export default memo(PostCard);

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.card,
    borderRadius: 14,
    borderWidth: 0,
    overflow: 'hidden',
    marginHorizontal: 6,
    marginBottom: 12,
    gap: 6,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  cardCompact: {
    backgroundColor: 'transparent',
    borderRadius: 12,
    marginBottom: 8,
    marginHorizontal: 0,
    shadowOpacity: 0,
    shadowRadius: 0,
    shadowOffset: { width: 0, height: 2 },
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    gap: 8,
    paddingBottom: 8,
  },
  headerCompact: {
    padding: 8,
    gap: 6,
  },
  authorTap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
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
  avatarCompact: {
    width: 24,
    height: 24,
    borderRadius: 12,
  },
  avatarText: {
    color: COLORS.accent,
    fontSize: 14,
    fontWeight: '700',
  },
  meta: { flex: 1 },
  author: { fontSize: 13.5, color: COLORS.ink, fontWeight: '700' },
  authorCompact: {
    fontSize: 12,
    fontWeight: '700',
  },
  sub: { fontSize: 11.5, color: COLORS.muted, marginTop: 1 },
  subCompact: {
    fontSize: 10.5,
  },
  followWrapCompact: {
    opacity: 0.9,
    transform: [{ scale: 0.92 }],
  },
  body: { paddingHorizontal: 12, paddingTop: 6, gap: 6 },
  bodyCompact: {
    paddingHorizontal: 8,
    paddingTop: 5,
    gap: 5,
  },
  title: { fontSize: 16, color: COLORS.ink, fontWeight: '700', lineHeight: 21 },
  titleCompact: {
    fontSize: 14,
    lineHeight: 19,
  },
  content: {
    marginTop: 6,
    color: COLORS.ink,
    fontSize: 13.5,
    lineHeight: 19,
  },
  contentCompact: {
    fontSize: 12,
    lineHeight: 16,
    marginTop: 4,
  },
  tagPill: {
    backgroundColor: COLORS.accentBg,
    color: COLORS.accent,
    borderRadius: 999,
    fontSize: 10,
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
  followBtnActive: {
    backgroundColor: '#ececf1',
  },
  followText: {
    color: COLORS.accent,
    fontSize: 11.5,
    fontWeight: '700',
  },
  followTextActive: {
    color: COLORS.muted,
  },
  tagsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 8,
  },
  multiMark: {
    position: 'absolute',
    right: 12,
    bottom: 12,
    color: COLORS.onAccent,
    fontSize: 11,
    fontWeight: '700',
    backgroundColor: 'rgba(0,0,0,0.56)',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
    overflow: 'hidden',
  },
  mediaTapWrap: {
    position: 'relative',
  },
  compactMediaWrap: {
    position: 'relative',
    overflow: 'hidden',
  },
  compactBody: {
    paddingHorizontal: 9,
    paddingBottom: 2,
  },
  compactMetaLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
  },
  compactLocation: {
    flex: 1,
    color: COLORS.muted,
    fontSize: 10.5,
  },
  compactParam: {
    maxWidth: '54%',
    color: COLORS.accent,
    fontSize: 10.5,
    fontWeight: '600',
    textAlign: 'right',
  },
  compactFooter: {
    minHeight: 28,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  compactAuthor: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  compactAuthorSpacer: { flex: 1 },
  compactAuthorText: {
    flex: 1,
    color: COLORS.muted,
    fontSize: 10.5,
  },
  manageBtn: {
    width: 24,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
  },
  manageText: {
    color: COLORS.muted,
    fontSize: 18,
    lineHeight: 20,
  },
});
