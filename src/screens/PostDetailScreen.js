import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Alert,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../api';
import { COLORS } from '../config';
import { APP_ROUTES } from '../constants/routes';
import { usePostListActions } from '../hooks/usePostListActions';
import ActionBar from '../components/ActionBar';
import MediaGallery from '../components/MediaGallery';
import VideoSurface from '../components/VideoSurface';
import ShotMetaBoard from '../components/ShotMetaBoard';
import { formatRelativeTime } from '../utils/time';
import { sharePost } from '../utils/share';
import { buildSessionIdempotencyKey } from '../lib/idempotency';
import { getActorName } from '../lib/actor';

const COMMENT_PAGE_SIZE = 12;

function CommentBubble({ comment }) {
  const author = comment.author || '匿名拍友';
  return (
    <View style={styles.commentItem}>
      <View style={styles.commentAvatar}>
        <Text style={styles.commentAvatarText}>{author.slice(0, 1)}</Text>
      </View>
      <View style={styles.commentBody}>
        <Text style={styles.commentAuthor}>{author}</Text>
        <Text style={styles.commentText}>{comment.text}</Text>
        <Text style={styles.commentTime}>{formatRelativeTime(comment.createdAt)}</Text>
      </View>
    </View>
  );
}

function normalizeComment(raw = {}, fallbackAuthor) {
  const source = raw.comment || raw;
  return {
    id: source.id || source.commentId || source._id || `c-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    author: source.author || source.actorName || fallbackAuthor || '匿名拍友',
    text: source.text || source.content || '',
    createdAt: source.createdAt || source.created_at || new Date().toISOString(),
  };
}

function isPlayableMedia(item) {
  return item?.kind === 'video'
    || (item?.kind === 'live' && item.cover && item.url && item.url !== item.cover);
}

function MediaViewer({ item, index, count, onClose, onStep }) {
  if (!item) return null;
  const playable = isPlayableMedia(item);
  const imageUri = item.kind === 'live' ? (item.cover || item.url) : item.url;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.viewerBackdrop}>
        <Pressable
          style={styles.viewerClose}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="关闭媒体预览"
        >
          <Text style={styles.viewerCloseText}>×</Text>
        </Pressable>
        <View style={styles.viewerStage}>
          {playable ? (
            <VideoSurface
              uri={item.url}
              style={styles.viewerVideo}
              shouldPlay
              controls
              loop={item.kind === 'live'}
              poster={item.cover}
            />
          ) : (
            imageUri ? (
              <Image source={{ uri: imageUri }} style={styles.viewerImage} resizeMode="contain" />
            ) : (
              <Text style={styles.viewerError}>素材地址已失效</Text>
            )
          )}
        </View>
        <View style={styles.viewerControls}>
          <Pressable
            style={[styles.viewerArrow, index <= 0 && styles.viewerArrowDisabled]}
            onPress={() => onStep(-1)}
            disabled={index <= 0}
            accessibilityRole="button"
            accessibilityLabel="上一份素材"
          >
            <Text style={styles.viewerArrowText}>‹</Text>
          </Pressable>
          <Text style={styles.viewerIndex}>{index + 1} / {count}</Text>
          <Pressable
            style={[styles.viewerArrow, index >= count - 1 && styles.viewerArrowDisabled]}
            onPress={() => onStep(1)}
            disabled={index >= count - 1}
            accessibilityRole="button"
            accessibilityLabel="下一份素材"
          >
            <Text style={styles.viewerArrowText}>›</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

export default function PostDetailScreen({ route, navigation }) {
  const { postId } = route?.params || {};
  const [post, setPost] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [commentInput, setCommentInput] = useState('');
  const [commentSending, setCommentSending] = useState(false);
  const [commentError, setCommentError] = useState(null);
  const [comments, setComments] = useState([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentsCursor, setCommentsCursor] = useState(null);
  const [commentsHasMore, setCommentsHasMore] = useState(false);
  const [commentsLoadError, setCommentsLoadError] = useState(null);
  const [viewerIndex, setViewerIndex] = useState(-1);
  const [metaOpen, setMetaOpen] = useState(false);

  const listRef = useRef(null);
  const commentInputRef = useRef(null);
  const commentIdempotencyRef = useRef('');
  const commentSeedRef = useRef('');

  const applyPost = useCallback((updater) => {
    setPost((prev) => {
      if (!prev) return prev;
      return typeof updater === 'function' ? updater(prev) : { ...prev, ...updater };
    });
  }, []);

  const getPostById = useCallback((postId) => {
    return post && String(post.id) === String(postId) ? post : null;
  }, [post]);

  const patchById = useCallback((postId, patch) => {
    applyPost((prev) => {
      if (!prev || String(prev.id) !== String(postId)) return prev;
      return typeof patch === 'function' ? { ...prev, ...patch(prev) } : { ...prev, ...patch };
    });
  }, [applyPost, post]);

  const {
    isBusy: isPostBusy,
    toggleAction,
  } = usePostListActions({
    getPostById,
    patchById,
    busyKey: (id, stateField) => `${String(id)}:${String(stateField || '')}`,
  });

  const loadComments = useCallback(async ({ append = false } = {}) => {
    if (!postId) return;
    if (commentsLoading) return;
    const cursor = append ? commentsCursor : null;
    setCommentsLoading(true);
    if (!append) {
      setComments([]);
      setCommentsCursor(null);
      setCommentsHasMore(false);
    }
    setCommentsLoadError(null);

    try {
      const payload = await api.getPostComments(postId, {
        limit: COMMENT_PAGE_SIZE,
        cursor,
      });
      setComments((prev) => (append ? [...prev, ...payload.comments] : payload.comments));
      setCommentsCursor(payload.nextCursor || null);
      setCommentsHasMore(Boolean(payload.hasMore));
    } catch (err) {
      setCommentsLoadError(err?.message || '评论加载失败');
      if (!append) {
        setComments([]);
        setCommentsCursor(null);
        setCommentsHasMore(false);
      }
    } finally {
      setCommentsLoading(false);
    }
  }, [api, postId, commentsCursor, commentsLoading]);

  const loadPost = useCallback(async () => {
    if (!postId) return;
    setLoading(true);
    setError(null);
    setCommentError(null);
    setCommentsLoadError(null);

    try {
      const payload = await api.getPost(postId, { withComments: false });
      setPost(payload);
      commentIdempotencyRef.current = '';
      commentSeedRef.current = '';
      await loadComments();
    } catch (err) {
      setError(err?.message || '加载失败');
      setPost(null);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [api, loadComments, postId]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadPost();
  }, [loadPost]);

  useEffect(() => {
    loadPost();
  }, [loadPost]);

  const onLike = useCallback(() => {
    if (!post) return;
    return toggleAction({
      postId: post.id,
      metricField: 'likes',
      stateField: 'liked',
      actionResolver: async ({ post: resolvedPost, next }) => api.toggleLike(resolvedPost.id, undefined, next ? 'like' : 'unlike'),
    });
  }, [api, post, toggleAction]);

  const onFavorite = useCallback(() => {
    if (!post) return;
    return toggleAction({
      postId: post.id,
      metricField: 'favorites',
      stateField: 'favorited',
      actionResolver: async ({ post: resolvedPost, next }) => api.toggleFavorite(resolvedPost.id, undefined, next ? 'favorite' : 'unfavorite'),
    });
  }, [api, post, toggleAction]);

  const onFollow = useCallback(() => {
    if (!post?.authorId) return;
    return toggleAction({
      postId: post.id,
      metricField: 'followers',
      stateField: 'followed',
      actionResolver: async ({ post: resolvedPost, next }) => api.toggleFollow(
        resolvedPost.authorId,
        next ? 'follow' : 'unfollow',
      ),
    });
  }, [api, post, toggleAction]);

  const onOpenAuthor = useCallback(() => {
    if (!post?.authorId) return;
    const params = {
      authorId: post.authorId,
      authorName: post.author || '创作者主页',
    };
    const parent = navigation?.getParent?.();
    if (parent) {
      parent.navigate(APP_ROUTES.DISCOVERY, {
        screen: 'AuthorProfile',
        params,
      });
      return;
    }
    navigation?.navigate?.('AuthorProfile', params);
  }, [navigation, post]);

  const scrollToBottom = useCallback(() => {
    if (listRef.current) {
      listRef.current.scrollToEnd({ animated: true });
    }
  }, []);

  const scrollToTop = useCallback(() => {
    if (listRef.current) {
      listRef.current.scrollToOffset({ offset: 0, animated: true });
    }
  }, []);

  const onJumpToComment = useCallback(() => {
    commentInputRef.current?.focus();
    setTimeout(() => {
      scrollToBottom();
    }, 80);
  }, [scrollToBottom]);

  const onShare = useCallback(async () => {
    if (!post) return;
    try {
      await sharePost(post);
    } catch (_err) {
      Alert.alert('分享失败', '暂不支持当前环境分享');
    }
  }, [post]);

  const submitReport = useCallback(async (reason) => {
    if (!post) return;
    try {
      const result = await api.reportPost(post.id, reason);
      Alert.alert(
        result?.duplicate ? '你已举报过' : '举报已提交',
        '感谢反馈，我们会按社区规则核查这条出片。',
      );
    } catch (err) {
      Alert.alert('举报失败', err?.cause || err?.message || '网络异常，请稍后重试');
    }
  }, [post]);

  const submitBlock = useCallback(async () => {
    if (!post?.authorId) return;
    try {
      await api.toggleBlock(post.authorId, 'block', post.author);
      Alert.alert('已屏蔽创作者', 'TA 的作品将从发现、地图和详情中隐藏，可在我的 - 屏蔽管理恢复。');
      navigation?.goBack?.();
    } catch (err) {
      Alert.alert('屏蔽失败', err?.cause || err?.message || '网络异常，请稍后重试');
    }
  }, [navigation, post]);

  const onBlock = useCallback(() => {
    if (!post?.authorId) return;
    Alert.alert('屏蔽该创作者？', '之后不再看到 TA 的公开作品。', [
      { text: '取消', style: 'cancel' },
      { text: '屏蔽', style: 'destructive', onPress: submitBlock },
    ]);
  }, [post, submitBlock]);

  const onReport = useCallback(() => {
    if (!post) return;
    Alert.alert('举报这条出片', '请选择最符合的原因', [
      { text: '屏蔽该创作者', style: 'destructive', onPress: onBlock },
      { text: '内容不实或误导', onPress: () => submitReport('misleading') },
      { text: '侵犯版权或肖像', onPress: () => submitReport('copyright') },
      { text: '不安全或违规内容', onPress: () => submitReport('unsafe') },
      { text: '广告或垃圾内容', onPress: () => submitReport('spam') },
      { text: '其他', onPress: () => submitReport('other') },
      { text: '取消', style: 'cancel' },
    ]);
  }, [onBlock, post, submitReport]);

  const onOpenMap = useCallback(() => {
    if (!post) return;
    const lat = Number(post.latitude);
    const lng = Number(post.longitude);
    const params = Number.isFinite(lat) && Number.isFinite(lng)
      ? { focusLocation: { lat, lng, label: post.spotName || '出片位置' } }
      : {};
    const parent = navigation?.getParent?.();
    if (parent) {
      parent.navigate(APP_ROUTES.MAP, {
        screen: 'Map',
        params,
      });
      return;
    }
    navigation?.navigate?.(APP_ROUTES.MAP, params);
  }, [navigation, post]);

  const onOpenMedia = useCallback((_item, index) => {
    setViewerIndex(Number.isInteger(index) ? index : -1);
  }, []);

  const onSubmitComment = useCallback(async () => {
    const text = String(commentInput || '').trim();
    if (!text || !post || commentSending) return;

    if (commentSeedRef.current !== text) {
      commentSeedRef.current = text;
      commentIdempotencyRef.current = buildSessionIdempotencyKey('post-comment', `${post.id}-${text}`);
    }

    const tempId = `tmp-${Date.now()}`;
    const tempAt = new Date().toISOString();
    setCommentSending(true);
    setCommentError(null);
    applyPost((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        commentsCount: Math.max(0, Number(prev.commentsCount || 0) + 1),
      };
    });
    setCommentInput('');
    Keyboard.dismiss();
    scrollToBottom();

    setComments((prev) => [
      {
        id: tempId,
        author: getActorName(),
        text,
        createdAt: tempAt,
        _optimistic: true,
      },
      ...prev,
    ]);

    try {
      const response = await api.comment(post.id, undefined, text, commentIdempotencyRef.current);
      const normalized = normalizeComment(response.comment || response, post.author);
      setComments((prev) => {
        const withoutTemp = prev.filter((item) => item.id !== tempId);
        return [
          { ...normalized, _fromNetwork: true },
          ...withoutTemp,
        ];
      });
      applyPost((prev) => {
        if (!prev) return prev;
        const nextCount = Math.max(Number(prev.commentsCount || 0), 0);
        return {
          ...prev,
          commentsCount: nextCount,
        };
      });
      setCommentError(null);
      commentIdempotencyRef.current = '';
      commentSeedRef.current = '';
      Keyboard.dismiss();
      scrollToBottom();
    } catch (err) {
      setComments((prev) => prev.filter((item) => item.id !== tempId));
      applyPost((prev) => {
        if (!prev) return prev;
        const previousCount = Number(prev.commentsCount || prev.comments?.length || 0);
        return {
          ...prev,
          commentsCount: Math.max(previousCount - 1, 0),
        };
      });
      setCommentError(err?.message || '评论发送失败');
      setCommentInput(text);
    } finally {
      setCommentSending(false);
    }
  }, [commentInput, commentSending, post, applyPost, scrollToBottom]);

  const postMeta = useMemo(() => {
    const media = Array.isArray(post?.media) ? post.media : [];
    const tags = [...(post?.styles || []), ...(post?.tags || [])].filter(Boolean);
    const title = post?.title || '无标题';
    const subtitlePieces = [
      post?.spotName || '',
      post?.district || '',
    ].filter(Boolean);
    const subtitle = subtitlePieces.join(' · ') || '匿名作品';
    const commentsCount = Number(post?.commentsCount || 0);
    const metaSummary = [
      post?.camera,
      post?.lens,
      post?.focalLength || post?.focal,
      post?.aperture,
    ].filter(Boolean).slice(0, 3).join(' · ') || '记录相机、镜头和曝光参数';

    return {
      media,
      tags,
      title,
      subtitle,
      commentsCount,
      metaSummary,
    };
  }, [post]);

  const onStepMedia = useCallback((delta) => {
    setViewerIndex((current) => {
      const next = current + Number(delta || 0);
      if (next < 0 || next >= postMeta.media.length) return current;
      return next;
    });
  }, [postMeta.media.length]);

  const renderHeader = useMemo(() => {
    if (!post) return null;
    return (
      <View>
        {loading ? null : <View style={styles.metaTopSpacer} />}
        <View style={styles.coverWrap}>
          <MediaGallery media={postMeta.media} showAll columns={1} onPressMedia={onOpenMedia} />
        </View>

        <View style={styles.contentWrap}>
          <View style={styles.authorRow}>
            <Pressable
              style={styles.authorPress}
              onPress={onOpenAuthor}
              disabled={!post.authorId}
              accessibilityRole="button"
              accessibilityLabel={`查看${post.author || '创作者'}主页`}
            >
              <View style={styles.authorAvatar}>
                <Text style={styles.authorAvatarText}>{String(post.author || '匿名拍友').slice(0, 2)}</Text>
              </View>
              <View style={styles.authorCopy}>
                <Text style={styles.authorName} numberOfLines={1}>{post.author || '匿名拍友'}</Text>
                <Text style={styles.authorBio} numberOfLines={1}>{post.authorBio || '出片位置记录者'}</Text>
              </View>
            </Pressable>
            <View style={styles.authorActions}>
              <Pressable
                style={[styles.followBtn, post.followed && styles.followBtnActive]}
                onPress={onFollow}
                disabled={!post.authorId || isPostBusy(post.id, 'followed', 'followed')}
              >
                <Text style={[styles.followText, post.followed && styles.followTextActive]}>
                  {isPostBusy(post.id, 'followed', 'followed') ? '...' : (post.followed ? '已关注' : '关注')}
                </Text>
              </Pressable>
              <Pressable
                style={styles.moreBtn}
                onPress={onReport}
                accessibilityRole="button"
                accessibilityLabel="举报这条出片"
              >
                <Text style={styles.moreText}>•••</Text>
              </Pressable>
            </View>
          </View>
          <Text style={styles.title}>{postMeta.title}</Text>
          <Pressable style={styles.locationLink} onPress={onOpenMap}>
            <Text style={styles.subtitle}>📍 {postMeta.subtitle}</Text>
            <Text style={styles.locationAction}>地图</Text>
          </Pressable>

          {!!post.content ? <Text style={styles.bodyText}>{post.content}</Text> : null}

          <View style={styles.metaSection}>
            <Pressable
              style={styles.metaToggle}
              onPress={() => setMetaOpen((value) => !value)}
              accessibilityRole="button"
              accessibilityState={{ expanded: metaOpen }}
            >
              <View style={styles.metaToggleCopy}>
                <Text style={styles.metaToggleTitle}>拍摄参数</Text>
                <Text style={styles.metaToggleSummary} numberOfLines={1}>{postMeta.metaSummary}</Text>
              </View>
              <Text style={styles.metaToggleAction}>{metaOpen ? '收起' : '查看'}</Text>
            </Pressable>
            <ShotMetaBoard
              source={post}
              title={null}
              options={{ includeSpot: true, includeLocation: true, includeMedia: true, maxItems: 8 }}
              compact={!metaOpen}
              fallback="暂无拍摄参数"
              showStrip
              showPanel={metaOpen}
            />
          </View>

          {!!postMeta.tags.length ? (
            <View style={styles.tagsWrap}>
              {postMeta.tags.map((tag) => (
                <Text key={tag} style={styles.tag}>#{tag}</Text>
              ))}
            </View>
          ) : null}

          <View style={styles.statRow}>
            <Text style={styles.statText}>浏览 {post.views || 0} · 发布于 {formatRelativeTime(post.createdAt)}</Text>
            {postMeta.commentsCount > 0 ? <Text style={styles.statText}>共 {postMeta.commentsCount} 条评论</Text> : null}
          </View>

          <View style={styles.commentSectionHeader}>
            <Text style={styles.sectionTitle}>评论区</Text>
            <Pressable onPress={scrollToTop}>
              <Text style={styles.commentTopAction}>回到顶部</Text>
            </Pressable>
          </View>
        </View>
      </View>
    );
  }, [isPostBusy, metaOpen, onBlock, onFollow, onOpenAuthor, onOpenMap, onOpenMedia, onReport, post, postMeta, loading, scrollToTop]);

  const renderComment = useCallback(({ item }) => <CommentBubble comment={item} />, []);

  const remainingCommentCount = Math.max(0, postMeta.commentsCount - comments.length);
  const hasMoreComments = commentsHasMore;
  const onLoadMoreComments = useCallback(() => {
    if (!postId || commentsLoading || !commentsHasMore) return;
    return loadComments({ append: true });
  }, [commentsHasMore, commentsLoading, loadComments, postId]);

  const renderCommentFooter = useMemo(() => {
    if (commentsLoading) {
      return <ActivityIndicator color={COLORS.accent} />;
    }
    if (commentsLoadError) {
      return (
        <Text style={styles.commentStatusText}>
          {commentsLoadError}
        </Text>
      );
    }
    if (!hasMoreComments) return null;
    return (
      <Pressable onPress={onLoadMoreComments} style={styles.loadMoreWrap}>
        <Text style={styles.loadMoreText}>
          查看更多评论（还有 {remainingCommentCount} 条）
        </Text>
      </Pressable>
    );
  }, [commentsLoadError, commentsLoading, hasMoreComments, onLoadMoreComments, remainingCommentCount]);
  const listEmptyComment = useMemo(() => {
    if (loading || commentsLoading) return <View style={styles.commentEmpty}><ActivityIndicator color={COLORS.accent} /></View>;
    if (commentsLoadError) return <Text style={styles.commentStatusText}>{commentsLoadError}</Text>;
    return (
      <View style={styles.commentEmpty}>
        <Text style={styles.commentEmptyText}>暂时没有评论，抢占第一条吧。</Text>
      </View>
    );
  }, [commentsLoading, commentsLoadError, loading]);

  if (!postId) {
    return (
      <SafeAreaView style={styles.center} edges={['top']}>
        <Text style={styles.error}>参数错误：缺少作品 ID</Text>
      </SafeAreaView>
    );
  }

  if (loading && !post) {
    return (
      <SafeAreaView style={styles.center} edges={['top']}>
        {!!error ? <Text style={styles.error}>{error}</Text> : <ActivityIndicator size="large" color={COLORS.accent} />}
      </SafeAreaView>
    );
  }

  if (!post && error) {
    return (
      <SafeAreaView style={styles.center} edges={['top']}>
        <Text style={styles.error}>加载失败：{error}</Text>
        <Pressable style={styles.retryBtn} onPress={loadPost}>
          <Text style={styles.retryText}>重试</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
        style={styles.flex}
      >
        <View style={styles.detailTopBar}>
          <Pressable
            accessibilityLabel="返回"
            accessibilityRole="button"
            style={styles.backBtn}
            onPress={() => navigation?.goBack?.()}
          >
            <Text style={styles.backIcon}>‹</Text>
          </Pressable>
          <Text style={styles.topBarTitle} numberOfLines={1}>{postMeta.title}</Text>
          <View style={styles.backBtn} />
        </View>
        <FlatList
          ref={listRef}
          data={comments}
          keyExtractor={(item, index) => String(item.id || item.createdAt || `${post?.id || 'post'}-${index}`)}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[COLORS.accent]} />}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={renderHeader}
          ListEmptyComponent={listEmptyComment}
          renderItem={renderComment}
          contentContainerStyle={styles.list}
          ListFooterComponent={<View style={styles.commentFooter}>
            {renderCommentFooter}
            <View style={{ height: 90 }} />
          </View>}
          ListHeaderComponentStyle={styles.header}
        />

        <View style={styles.bottomDock}>
          {!!commentError ? <Text style={styles.commentErr}>评论发送失败：{commentError}</Text> : null}
          <View style={styles.bottomActions}>
            <ActionBar
              likes={post.likes || 0}
              favorites={post.favorites || 0}
              comments={postMeta.commentsCount || 0}
              liked={post.liked}
              favorited={post.favorited}
              likeBusy={isPostBusy(post?.id, 'liked', 'liked')}
              favoriteBusy={isPostBusy(post?.id, 'favorited', 'favorited')}
              onLike={onLike}
              onFavorite={onFavorite}
              onComment={onJumpToComment}
              onShare={onShare}
              compact
            />
          </View>
          <View style={styles.commentBar}>
            <TextInput
              ref={commentInputRef}
              style={styles.commentInput}
              value={commentInput}
              onChangeText={setCommentInput}
              placeholder="写下你的建议、复盘或打卡心得..."
              placeholderTextColor={COLORS.muted}
              maxLength={500}
              multiline
              scrollEnabled
              textAlignVertical="top"
              returnKeyType="send"
              onSubmitEditing={() => {
                if (!commentSending) onSubmitComment();
              }}
            />
            <Pressable
              style={[
                styles.sendBtn,
                (commentSending || !commentInput.trim()) && styles.sendBtnDisabled,
              ]}
              onPress={onSubmitComment}
              disabled={commentSending || !commentInput.trim()}
              android_ripple={{ color: '#d98b98' }}
            >
              <Text style={[
                styles.sendText,
                (commentSending || !commentInput.trim()) && styles.sendTextDisabled,
              ]}>
                {commentSending ? '发送中...' : '发送'}
              </Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
      <MediaViewer
        item={viewerIndex >= 0 ? postMeta.media[viewerIndex] : null}
        index={viewerIndex}
        count={postMeta.media.length}
        onClose={() => setViewerIndex(-1)}
        onStep={onStepMedia}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.bg,
    gap: 10,
  },
  error: {
    color: '#b14b4b',
  },
  retryBtn: {
    marginTop: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: COLORS.accent,
  },
  retryText: {
    color: COLORS.onAccent,
    fontWeight: '600',
  },
  header: {
    paddingHorizontal: 12,
    backgroundColor: COLORS.bg,
  },
  list: {
    paddingBottom: 18,
    backgroundColor: COLORS.bg,
  },
  metaTopSpacer: {
    height: 4,
  },
  detailTopBar: {
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    backgroundColor: COLORS.panel,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.line,
  },
  backBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 18,
  },
  backIcon: {
    color: COLORS.ink,
    fontSize: 32,
    fontWeight: '300',
    lineHeight: 34,
  },
  topBarTitle: {
    flex: 1,
    color: COLORS.ink,
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'center',
    paddingHorizontal: 8,
  },
  coverWrap: {
    marginHorizontal: 0,
    borderRadius: 0,
    overflow: 'hidden',
    backgroundColor: COLORS.card,
    borderWidth: 0,
  },
  viewerBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(8,10,14,0.98)',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 24,
  },
  viewerClose: {
    alignSelf: 'flex-end',
    width: 42,
    height: 42,
    marginRight: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 21,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  viewerCloseText: {
    color: '#fff',
    fontSize: 28,
    fontWeight: '300',
    lineHeight: 30,
  },
  viewerStage: {
    flex: 1,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  viewerImage: {
    width: '100%',
    height: '100%',
  },
  viewerVideo: {
    width: '100%',
    height: '76%',
    backgroundColor: '#000',
  },
  viewerError: {
    color: 'rgba(255,255,255,0.72)',
    fontSize: 13,
  },
  viewerControls: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 22,
    paddingHorizontal: 18,
  },
  viewerArrow: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  viewerArrowDisabled: { opacity: 0.3 },
  viewerArrowText: {
    color: '#fff',
    fontSize: 28,
    fontWeight: '300',
    lineHeight: 31,
  },
  viewerIndex: {
    minWidth: 54,
    color: 'rgba(255,255,255,0.82)',
    fontSize: 12,
    textAlign: 'center',
  },
  contentWrap: {
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 12,
    gap: 10,
  },
  authorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    marginBottom: 2,
  },
  authorActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  authorPress: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  authorAvatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.bgDeep,
  },
  authorAvatarText: { color: COLORS.accent, fontSize: 13, fontWeight: '800' },
  authorCopy: { flex: 1 },
  authorName: { color: COLORS.ink, fontSize: 13, fontWeight: '700' },
  authorBio: { color: COLORS.muted, fontSize: 11.2, marginTop: 2 },
  followBtn: {
    minWidth: 58,
    alignItems: 'center',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: COLORS.accent,
  },
  followBtnActive: { backgroundColor: '#ececf1' },
  followText: { color: COLORS.onAccent, fontSize: 11.5, fontWeight: '700' },
  followTextActive: { color: COLORS.muted },
  moreBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  moreText: { color: COLORS.muted, fontSize: 16, letterSpacing: 1, lineHeight: 18 },
  title: {
    color: COLORS.ink,
    fontSize: 20,
    fontWeight: '700',
    lineHeight: 28,
  },
  subtitle: {
    color: COLORS.muted,
    fontSize: 12.5,
  },
  locationLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    paddingVertical: 2,
  },
  locationAction: {
    color: COLORS.accent,
    fontSize: 12,
    fontWeight: '700',
  },
  bodyText: {
    fontSize: 14.5,
    color: COLORS.ink,
    lineHeight: 22,
  },
  metaCard: {
    marginTop: 2,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    padding: 10,
    gap: 5,
    backgroundColor: COLORS.panel,
  },
  metaSection: {
    marginTop: 2,
    gap: 6,
  },
  metaToggle: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 11,
    backgroundColor: COLORS.accentBg,
  },
  metaToggleCopy: {
    flex: 1,
    minWidth: 0,
  },
  metaToggleTitle: {
    color: COLORS.ink,
    fontSize: 12.5,
    fontWeight: '700',
  },
  metaToggleSummary: {
    color: COLORS.muted,
    fontSize: 10.8,
    marginTop: 2,
  },
  metaToggleAction: {
    color: COLORS.accent,
    fontSize: 11.5,
    fontWeight: '700',
  },
  metaLine: {
    color: COLORS.ink,
    fontSize: 12.2,
    lineHeight: 18,
  },
  tagsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
    marginTop: 4,
  },
  tag: {
    backgroundColor: COLORS.accentBg,
    color: COLORS.accent,
    borderRadius: 999,
    fontSize: 11,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  statRow: {
    marginTop: 6,
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  statText: {
    color: COLORS.muted,
    fontSize: 11.5,
  },
  sectionTitle: {
    fontSize: 17,
    color: COLORS.ink,
    fontWeight: '700',
    marginTop: 2,
    marginBottom: 2,
  },
  commentSectionHeader: {
    marginTop: 2,
    marginBottom: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  commentTopAction: {
    color: COLORS.accent,
    fontSize: 12.5,
    fontWeight: '700',
  },
  commentItem: {
    marginHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 9,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.06)',
    paddingVertical: 10,
  },
  commentAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.accentBg,
  },
  commentAvatarText: {
    color: COLORS.accent,
    fontSize: 12,
    fontWeight: '800',
  },
  commentBody: {
    flex: 1,
    gap: 4,
  },
  commentAuthor: {
    color: COLORS.ink,
    fontSize: 12.5,
    fontWeight: '700',
  },
  commentText: {
    color: COLORS.ink,
    fontSize: 13.5,
    lineHeight: 19,
  },
  commentTime: {
    color: COLORS.muted,
    fontSize: 10.8,
  },
  commentEmpty: {
    paddingHorizontal: 12,
    paddingVertical: 24,
    alignItems: 'center',
  },
  commentEmptyText: {
    color: COLORS.muted,
    fontSize: 13,
  },
  commentStatusText: {
    color: '#a83f3f',
    fontSize: 11.5,
    textAlign: 'center',
    paddingHorizontal: 12,
  },
  commentBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
    borderTopWidth: 0,
    backgroundColor: COLORS.panel,
  },
  bottomDock: {
    borderTopWidth: 1,
    borderTopColor: COLORS.line,
    backgroundColor: COLORS.panel,
  },
  bottomActions: {
    paddingHorizontal: 8,
    paddingTop: 4,
  },
  commentInput: {
    flex: 1,
    maxHeight: 110,
    minHeight: 40,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    backgroundColor: COLORS.white,
    color: COLORS.ink,
    fontSize: 13.5,
  },
  sendBtn: {
    backgroundColor: COLORS.accent,
    borderRadius: 999,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 1,
  },
  sendBtnDisabled: {
    opacity: 0.6,
  },
  sendText: {
    color: COLORS.onAccent,
    fontSize: 13,
    fontWeight: '600',
  },
  sendTextDisabled: {
    color: 'rgba(255,255,255,0.8)',
  },
  commentErr: {
    color: '#a83f3f',
    fontSize: 11.5,
    backgroundColor: '#fff0f0',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  commentFooter: {
    marginTop: 6,
    marginBottom: 4,
  },
  loadMoreWrap: {
    marginHorizontal: 12,
    marginBottom: 4,
    backgroundColor: COLORS.accentBg,
    borderRadius: 999,
    paddingVertical: 10,
    alignItems: 'center',
  },
  loadMoreText: {
    color: COLORS.accent,
    fontSize: 12,
    fontWeight: '700',
  },
}); 
