import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Share,
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
import { usePostListActions } from '../hooks/usePostListActions';
import ActionBar from '../components/ActionBar';
import MediaGallery from '../components/MediaGallery';
import ShotMetaBoard from '../components/ShotMetaBoard';
import { formatRelativeTime } from '../utils/time';
import { buildPostShareMessage } from '../utils/share';
import { buildSessionIdempotencyKey } from '../lib/idempotency';

const COMMENT_PAGE_SIZE = 12;

function CommentBubble({ comment }) {
  return (
    <View style={styles.commentItem}>
      <Text style={styles.commentAuthor}>{comment.author || '匿名拍友'}</Text>
      <Text style={styles.commentText}>{comment.text}</Text>
      <Text style={styles.commentTime}>{formatRelativeTime(comment.createdAt)}</Text>
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

export default function PostDetailScreen({ route }) {
  const { postId } = route?.params || {};
  const [post, setPost] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [commentInput, setCommentInput] = useState('');
  const [commentSending, setCommentSending] = useState(false);
  const [commentError, setCommentError] = useState(null);
  const [commentPageSize, setCommentPageSize] = useState(COMMENT_PAGE_SIZE);

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

  const loadPost = useCallback(async () => {
    if (!postId) return;
    setLoading(true);
    setError(null);

    try {
      const payload = await api.getPost(postId);
      setPost(payload);
      setCommentPageSize(COMMENT_PAGE_SIZE);
      setCommentError(null);
      commentIdempotencyRef.current = '';
      commentSeedRef.current = '';
    } catch (err) {
      setError(err?.message || '加载失败');
      setPost(null);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [postId]);

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
      actionResolver: async ({ post: resolvedPost, next }) => api.toggleLike(resolvedPost.id, resolvedPost.author, next ? 'like' : 'unlike'),
    });
  }, [api, post, toggleAction]);

  const onFavorite = useCallback(() => {
    if (!post) return;
    return toggleAction({
      postId: post.id,
      metricField: 'favorites',
      stateField: 'favorited',
      actionResolver: async ({ post: resolvedPost, next }) => api.toggleFavorite(resolvedPost.id, resolvedPost.author, next ? 'favorite' : 'unfavorite'),
    });
  }, [api, post, toggleAction]);

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
      await Share.share({ message: buildPostShareMessage(post) });
    } catch (_err) {
      Alert.alert('分享失败', '暂不支持当前环境分享');
    }
  }, [post]);

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
      const nextCount = Math.max(0, Number(prev.commentsCount || prev.comments?.length || 0) + 1);
      const nextComments = [
        ...(prev.comments || []),
        {
          id: tempId,
          author: prev.author || '匿名拍友',
          text,
          createdAt: tempAt,
          _optimistic: true,
        },
      ];
      return {
        ...prev,
        comments: nextComments,
        commentsCount: nextCount,
      };
    });
    setCommentInput('');
    Keyboard.dismiss();
    scrollToBottom();

    try {
      const response = await api.comment(post.id, post.author, text, commentIdempotencyRef.current);
      applyPost((prev) => {
        if (!prev) return prev;
        const comments = (prev.comments || []).filter((item) => item.id !== tempId);
        const normalized = normalizeComment(response, prev.author);
        comments.push({
          ...normalized,
          _fromNetwork: true,
        });
        return {
          ...prev,
          comments,
          commentsCount: comments.length,
        };
      });
      setCommentError(null);
      commentIdempotencyRef.current = '';
      commentSeedRef.current = '';
      Keyboard.dismiss();
      scrollToBottom();
    } catch (err) {
      applyPost((prev) => {
        if (!prev) return prev;
        const comments = (prev.comments || []).filter((item) => item.id !== tempId);
        return {
          ...prev,
          comments,
          commentsCount: Math.max(0, Number(prev.commentsCount || prev.comments?.length || 0) - 1),
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
    const comments = Array.isArray(post?.comments) ? post.comments : [];
    const commentsCount = Number(post?.commentsCount || comments.length || 0);

    return {
      media,
      tags,
      title,
      subtitle,
      comments,
      commentsCount,
    };
  }, [post]);

  const renderHeader = useMemo(() => {
    if (!post) return null;
    return (
      <View>
        {loading ? null : <View style={styles.metaTopSpacer} />}
        <View style={styles.coverWrap}>
          <MediaGallery media={postMeta.media} showAll columns={1} />
        </View>

        <View style={styles.contentWrap}>
          <Text style={styles.title}>{postMeta.title}</Text>
          <Text style={styles.subtitle}>{postMeta.subtitle}</Text>

          {!!post.content ? <Text style={styles.bodyText}>{post.content}</Text> : null}

          <ShotMetaBoard
            source={post}
            title="拍摄参数"
            options={{ includeSpot: true, includeLocation: true, includeMedia: true, maxItems: 8 }}
            compact={false}
            fallback="暂无拍摄参数"
            showStrip
            showPanel
          />

          {!!postMeta.tags.length ? (
            <View style={styles.tagsWrap}>
              {postMeta.tags.map((tag) => (
                <Text key={tag} style={styles.tag}>#{tag}</Text>
              ))}
            </View>
          ) : null}

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
          />

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
  }, [isPostBusy, onFavorite, onJumpToComment, onLike, onShare, post, postMeta, loading, scrollToTop]);

  const renderComment = useCallback(({ item }) => <CommentBubble comment={item} />, []);

  const visibleComments = useMemo(() => {
    if (!Array.isArray(postMeta.comments) || postMeta.comments.length <= commentPageSize) {
      return postMeta.comments;
    }
    return postMeta.comments.slice(0, commentPageSize);
  }, [postMeta.comments, commentPageSize]);

  const hasMoreComments = postMeta.comments.length > commentPageSize;
  const onLoadMoreComments = useCallback(() => {
    setCommentPageSize((prev) => prev + COMMENT_PAGE_SIZE);
  }, []);

  const renderCommentFooter = useMemo(() => {
    if (!hasMoreComments) return null;
    return (
      <Pressable onPress={onLoadMoreComments} style={styles.loadMoreWrap}>
        <Text style={styles.loadMoreText}>
          查看更多评论（还有 {postMeta.comments.length - commentPageSize} 条）
        </Text>
      </Pressable>
    );
  }, [hasMoreComments, onLoadMoreComments, commentPageSize, postMeta.comments.length]);
  const listEmptyComment = useMemo(() => {
    if (loading) return <View style={styles.commentEmpty}><ActivityIndicator color={COLORS.accent} /></View>;
    return (
      <View style={styles.commentEmpty}>
        <Text style={styles.commentEmptyText}>暂时没有评论，抢占第一条吧。</Text>
      </View>
    );
  }, [loading]);

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
        <FlatList
          ref={listRef}
          data={visibleComments}
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
        {!!commentError ? <Text style={styles.commentErr}>评论发送失败：{commentError}</Text> : null}
      </KeyboardAvoidingView>
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
  coverWrap: {
    marginHorizontal: 12,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
  },
  contentWrap: {
    padding: 12,
    gap: 10,
  },
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
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.06)',
    paddingVertical: 10,
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
  commentBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: COLORS.line,
    backgroundColor: COLORS.panel,
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
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 58,
    color: '#a83f3f',
    fontSize: 11.5,
    backgroundColor: 'rgba(255,240,240,0.95)',
    borderRadius: 10,
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
