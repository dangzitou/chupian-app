import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  FlatList,
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../api';
import { COLORS } from '../config';
import { APP_ROUTES } from '../constants/routes';
import Avatar from '../components/Avatar';
import { usePostListActions } from '../hooks/usePostListActions';
import ActionBar from '../components/ActionBar';
import MediaGallery from '../components/MediaGallery';
import VideoSurface from '../components/VideoSurface';
import ShotMetaBoard from '../components/ShotMetaBoard';
import { formatRelativeTime } from '../utils/time';
import { sharePost } from '../utils/share';
import { buildSessionIdempotencyKey } from '../lib/idempotency';
import { getActorId, getActorName, getCurrentUser } from '../lib/actor';

const COMMENT_PAGE_SIZE = 12;

function CommentBubble({ comment }) {
  const author = comment.author || '匿名拍友';
  return (
    <View style={styles.commentItem}>
      <Avatar name={author} uri={comment.avatar} size={28} />
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
    avatar: source.avatar || source.authorAvatar || source.avatarUrl || '',
    text: source.text || source.content || '',
    createdAt: source.createdAt || source.created_at || new Date().toISOString(),
  };
}

function isPlayableMedia(item) {
  return item?.kind === 'video'
    || (item?.kind === 'live' && item.cover && item.url && item.url !== item.cover);
}

function getTouchDistance(touches = []) {
  const first = touches[0];
  const second = touches[1];
  if (!first || !second) return 0;
  const dx = Number(first.pageX || 0) - Number(second.pageX || 0);
  const dy = Number(first.pageY || 0) - Number(second.pageY || 0);
  return Math.sqrt((dx * dx) + (dy * dy));
}

function clampZoom(value) {
  return Math.min(3.5, Math.max(1, Number(value) || 1));
}

function MediaViewer({ item, index, count, onClose, onStep }) {
  const [loadError, setLoadError] = useState(false);
  const zoom = useRef(new Animated.Value(1)).current;
  const panX = useRef(new Animated.Value(0)).current;
  const panY = useRef(new Animated.Value(0)).current;
  const currentScaleRef = useRef(1);
  const gestureRef = useRef({ mode: 'idle', distance: 0, baseScale: 1 });
  useEffect(() => {
    setLoadError(false);
    currentScaleRef.current = 1;
    gestureRef.current = { mode: 'idle', distance: 0, baseScale: 1 };
    zoom.setValue(1);
    panX.setValue(0);
    panY.setValue(0);
  }, [item?.kind, item?.url, item?.cover, panX, panY, zoom]);

  const playable = isPlayableMedia(item);
  const imageUri = item?.kind === 'live' ? (item.cover || item.url) : item?.url;
  const imageZoomable = !playable && Boolean(imageUri);
  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: (event) => (
      imageZoomable && event.nativeEvent.touches.length >= 2
    ),
    onMoveShouldSetPanResponder: (event, gestureState) => {
      if (imageZoomable && event.nativeEvent.touches.length >= 2) return true;
      if (imageZoomable && currentScaleRef.current > 1) return true;
      return Math.abs(gestureState.dx) > 14
        && Math.abs(gestureState.dx) > Math.abs(gestureState.dy);
    },
    onPanResponderGrant: (event) => {
      const touches = event.nativeEvent.touches || [];
      const distance = getTouchDistance(touches);
      gestureRef.current = {
        mode: imageZoomable && touches.length >= 2 ? 'pinch' : (currentScaleRef.current > 1 ? 'pan' : 'swipe'),
        distance,
        baseScale: currentScaleRef.current,
      };
    },
    onPanResponderMove: (event, gestureState) => {
      const touches = event.nativeEvent.touches || [];
      if (imageZoomable && touches.length >= 2) {
        const startDistance = gestureRef.current.distance;
        const distance = getTouchDistance(touches);
        if (startDistance > 0 && distance > 0) {
          const nextScale = clampZoom(gestureRef.current.baseScale * (distance / startDistance));
          currentScaleRef.current = nextScale;
          zoom.setValue(nextScale);
          if (nextScale <= 1.01) {
            panX.setValue(0);
            panY.setValue(0);
          }
          gestureRef.current.mode = 'pinch';
        }
        return;
      }
      if (imageZoomable && currentScaleRef.current > 1) {
        gestureRef.current.mode = 'pan';
        panX.setValue(gestureState.dx);
        panY.setValue(gestureState.dy);
      }
    },
    onPanResponderRelease: (_event, gestureState) => {
      if (imageZoomable && currentScaleRef.current > 1) return;
      if (Math.abs(gestureState.dx) < 42) return;
      onStep(gestureState.dx < 0 ? 1 : -1);
    },
  }), [imageZoomable, onStep, panX, panY, zoom]);

  if (!item) return null;

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
        <View style={styles.viewerStage} {...panResponder.panHandlers}>
          {loadError ? (
            <View style={styles.viewerErrorWrap}>
              <Text style={styles.viewerError}>素材加载失败</Text>
              <Pressable
                style={styles.viewerRetry}
                onPress={() => setLoadError(false)}
                accessibilityRole="button"
                accessibilityLabel="重试加载素材"
              >
                <Text style={styles.viewerRetryText}>重试</Text>
              </Pressable>
            </View>
          ) : playable ? (
            <VideoSurface
              uri={item.url}
              style={styles.viewerVideo}
              shouldPlay
              controls
              loop={item.kind === 'live'}
              poster={item.cover}
              onError={() => setLoadError(true)}
            />
          ) : (
            imageUri ? (
              <Animated.Image
                source={{ uri: imageUri }}
                style={[styles.viewerImage, {
                  transform: [
                    { translateX: panX },
                    { translateY: panY },
                    { scale: zoom },
                  ],
                }]}
                resizeMode="contain"
                onError={() => setLoadError(true)}
              />
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

function buildEditDraft(post = {}) {
  const gear = post.gear || {};
  return {
    title: post.title || '',
    content: post.content || '',
    spotId: post.spotId || '',
    spotName: post.spotName || '',
    district: post.district || '',
    latitude: post.latitude ?? '',
    longitude: post.longitude ?? '',
    angle: post.angle || '',
    direction: post.direction || '',
    timeWindow: post.timeWindow || '',
    bestTime: post.bestTime || '',
    shotAt: post.shotAt || '',
    camera: gear.camera || '',
    lens: gear.lens || '',
    focalLength: gear.focal || '',
    aperture: gear.aperture || '',
    shutter: gear.shutter || '',
    iso: gear.iso || '',
    whiteBalance: gear.whiteBalance || '',
  };
}

function EditField({ label, value, onChange, placeholder, multiline = false }) {
  return (
    <View style={styles.editField}>
      <Text style={styles.editLabel}>{label}</Text>
      <TextInput
        style={[styles.editInput, multiline && styles.editInputMultiline]}
        value={String(value ?? '')}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={COLORS.mutedText}
        multiline={multiline}
        textAlignVertical={multiline ? 'top' : 'center'}
        maxLength={multiline ? 3000 : 200}
      />
    </View>
  );
}

const EDIT_BEST_TIME_OPTIONS = [
  { value: 'day', label: '日间' },
  { value: 'golden', label: '黄金时刻' },
  { value: 'night', label: '夜景' },
];

const EDIT_CHOICE_ROW_STYLE = { flexDirection: 'row', gap: 8 };
const EDIT_CHOICE_STYLE = {
  flex: 1,
  minHeight: 40,
  paddingHorizontal: 8,
  borderWidth: 1,
  borderColor: '#D9D0C6',
  borderRadius: 10,
  alignItems: 'center',
  justifyContent: 'center',
  backgroundColor: '#FFFDF9',
};
const EDIT_CHOICE_ACTIVE_STYLE = { borderColor: '#B7663B', backgroundColor: '#F7E9DF' };
const EDIT_CHOICE_TEXT_STYLE = { color: '#6C6259', fontSize: 13, fontWeight: '600' };
const EDIT_CHOICE_TEXT_ACTIVE_STYLE = { color: '#7D3F22' };

function EditChoiceField({ label, value, onChange, options }) {
  return (
    <View style={styles.editField}>
      <Text style={styles.editLabel}>{label}</Text>
      <View style={EDIT_CHOICE_ROW_STYLE}>
        {options.map((option) => {
          const active = value === option.value;
          return (
            <Pressable
              key={option.value}
              style={[EDIT_CHOICE_STYLE, active && EDIT_CHOICE_ACTIVE_STYLE]}
              onPress={() => onChange(active ? '' : option.value)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
            >
              <Text style={[EDIT_CHOICE_TEXT_STYLE, active && EDIT_CHOICE_TEXT_ACTIVE_STYLE]}>
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export default function PostDetailScreen({ route, navigation }) {
  const { postId } = route?.params || {};
  const insets = useSafeAreaInsets();
  const [post, setPost] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [commentInput, setCommentInput] = useState('');
  const [commentSending, setCommentSending] = useState(false);
  const [commentError, setCommentError] = useState(null);
  const [actionError, setActionError] = useState('');
  const [comments, setComments] = useState([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentsCursor, setCommentsCursor] = useState(null);
  const [commentsHasMore, setCommentsHasMore] = useState(false);
  const [commentsLoadError, setCommentsLoadError] = useState(null);
  const [viewerIndex, setViewerIndex] = useState(-1);
  const [metaOpen, setMetaOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState('');
  const [editDraft, setEditDraft] = useState({});

  const listRef = useRef(null);
  const commentInputRef = useRef(null);
  const commentIdempotencyRef = useRef('');
  const commentSeedRef = useRef('');
  const commentsLoadingRef = useRef(false);
  const commentsCursorRef = useRef(null);
  const postRequestSeqRef = useRef(0);
  const commentsRequestSeqRef = useRef(0);

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
    onError: () => setActionError('网络不稳定，操作未完成，请重试'),
  });

  const loadComments = useCallback(async ({ append = false } = {}) => {
    if (!postId) return;
    if (commentsLoadingRef.current) return;
    const requestSeq = commentsRequestSeqRef.current + 1;
    commentsRequestSeqRef.current = requestSeq;
    const cursor = append ? commentsCursorRef.current : null;
    commentsLoadingRef.current = true;
    setCommentsLoading(true);
    if (!append) {
      setComments([]);
      setCommentsCursor(null);
      commentsCursorRef.current = null;
      setCommentsHasMore(false);
    }
    setCommentsLoadError(null);

    try {
      const payload = await api.getPostComments(postId, {
        limit: COMMENT_PAGE_SIZE,
        cursor,
      });
      if (requestSeq !== commentsRequestSeqRef.current) return;
      setComments((prev) => {
        const merged = append ? [...prev, ...payload.comments] : payload.comments;
        const seen = new Set();
        return merged.filter((item) => {
          const key = String(item?.id || `${item?.author || ''}:${item?.createdAt || ''}:${item?.text || ''}`);
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      });
      const nextCursor = payload.nextCursor || null;
      setCommentsCursor(nextCursor);
      commentsCursorRef.current = nextCursor;
      setCommentsHasMore(Boolean(payload.hasMore));
    } catch (err) {
      if (requestSeq !== commentsRequestSeqRef.current) return;
      setCommentsLoadError(err?.message || '评论加载失败');
      if (!append) {
        setComments([]);
        setCommentsCursor(null);
        setCommentsHasMore(false);
      }
    } finally {
      if (requestSeq !== commentsRequestSeqRef.current) return;
      commentsLoadingRef.current = false;
      setCommentsLoading(false);
    }
  }, [api, postId]);

  const loadPost = useCallback(async () => {
    if (!postId) return;
    const requestSeq = postRequestSeqRef.current + 1;
    postRequestSeqRef.current = requestSeq;
    commentsRequestSeqRef.current += 1;
    commentsLoadingRef.current = false;
    setCommentsLoading(false);
    setLoading(true);
    setError(null);
    setCommentError(null);
    setCommentsLoadError(null);

    try {
      const payload = await api.getPost(postId, { withComments: false });
      if (requestSeq !== postRequestSeqRef.current) return;
      setPost(payload);
      commentIdempotencyRef.current = '';
      commentSeedRef.current = '';
      await loadComments();
    } catch (err) {
      if (requestSeq !== postRequestSeqRef.current) return;
      setError(err?.message || '加载失败');
      setPost(null);
    } finally {
      if (requestSeq !== postRequestSeqRef.current) return;
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
      avatar: post.avatar || '',
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

  const isOwnPost = Boolean(post?.authorId && String(post.authorId) === String(getActorId()));
  const setEditField = useCallback((key, value) => {
    setEditDraft((current) => ({ ...current, [key]: value }));
  }, []);

  const onOpenEdit = useCallback(() => {
    if (!post || !isOwnPost) {
      onReport();
      return;
    }
    setEditDraft(buildEditDraft(post));
    setEditError('');
    setEditOpen(true);
  }, [isOwnPost, onReport, post]);

  const onSaveEdit = useCallback(async () => {
    if (!post || editSaving) return;
    setEditSaving(true);
    setEditError('');
    try {
      const result = await api.updatePost(post.id, editDraft);
      if (result?.post) applyPost(result.post);
      setEditOpen(false);
      const earnedPoints = Number(result?.reward?.earnedPoints || 0);
      Alert.alert(
        '已更新',
        earnedPoints > 0
          ? `攻略已补充，获得 +${earnedPoints} 贡献值；原有媒体保持不变。`
          : '攻略和拍摄信息已补充，原有媒体保持不变。',
      );
    } catch (err) {
      setEditError(err?.cause || err?.message || '保存失败，请稍后重试');
    } finally {
      setEditSaving(false);
    }
  }, [api, applyPost, editDraft, editSaving, post]);

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
    scrollToTop();

    setComments((prev) => [
      {
        id: tempId,
        author: getActorName(),
        avatar: String(getCurrentUser()?.avatar || '').trim(),
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
      scrollToTop();
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
  }, [commentInput, commentSending, post, applyPost, scrollToTop]);

  const postMeta = useMemo(() => {
    const media = Array.isArray(post?.media) ? post.media : [];
    const tags = [...(post?.styles || []), ...(post?.tags || [])].filter(Boolean);
    const title = post?.title || '出片记录';
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
              <Avatar name={post.author || '匿名拍友'} uri={post.avatar} size={38} />
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
                onPress={onOpenEdit}
                accessibilityRole="button"
                accessibilityLabel={isOwnPost ? '编辑这条出片' : '举报这条出片'}
              >
                <Text style={styles.moreText}>•••</Text>
              </Pressable>
            </View>
          </View>
          <Text style={styles.title}>{postMeta.title}</Text>
          <Pressable style={styles.locationLink} onPress={onOpenMap}>
            <View style={styles.locationCopy}>
              <View style={styles.locationDot} />
              <Text style={styles.subtitle} numberOfLines={1}>{postMeta.subtitle}</Text>
            </View>
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
  }, [isOwnPost, isPostBusy, metaOpen, onBlock, onFollow, onOpenAuthor, onOpenEdit, onOpenMap, onOpenMedia, onReport, post, postMeta, loading, scrollToTop]);

  const renderComment = useCallback(({ item }) => <CommentBubble comment={item} />, []);

  const remainingCommentCount = Math.max(0, postMeta.commentsCount - comments.length);
  const hasMoreComments = commentsHasMore;
  const onLoadMoreComments = useCallback(() => {
    if (!postId || commentsLoading || !commentsHasMore) return;
    return loadComments({ append: true });
  }, [commentsHasMore, commentsLoading, loadComments, postId]);

  const retryComments = useCallback(() => {
    if (!postId || commentsLoading) return;
    return loadComments({
      append: comments.length > 0 && commentsHasMore,
    });
  }, [comments.length, commentsHasMore, commentsLoading, loadComments, postId]);

  const renderCommentFooter = useMemo(() => {
    if (commentsLoading) {
      return <ActivityIndicator color={COLORS.accent} />;
    }
    if (commentsLoadError) {
      return (
        <Pressable onPress={retryComments} style={styles.loadMoreWrap} accessibilityRole="button">
          <Text style={styles.loadMoreText}>{commentsLoadError} · 点击重试</Text>
        </Pressable>
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
  }, [commentsLoadError, commentsLoading, hasMoreComments, onLoadMoreComments, remainingCommentCount, retryComments]);
  const listEmptyComment = useMemo(() => {
    if (loading || commentsLoading) return <View style={styles.commentEmpty}><ActivityIndicator color={COLORS.accent} /></View>;
    if (commentsLoadError) {
      return (
        <Pressable onPress={retryComments} style={styles.loadMoreWrap} accessibilityRole="button">
          <Text style={styles.loadMoreText}>{commentsLoadError} · 点击重试</Text>
        </Pressable>
      );
    }
    return (
      <View style={styles.commentEmpty}>
        <Text style={styles.commentEmptyText}>暂时没有评论，抢占第一条吧。</Text>
      </View>
    );
  }, [commentsLoading, commentsLoadError, loading, retryComments]);

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

        <View style={[styles.bottomDock, { paddingBottom: Math.max(8, insets.bottom || 0) }]}> 
          {!!actionError ? (
            <Pressable
              style={styles.actionError}
              onPress={() => setActionError('')}
              accessibilityRole="button"
              accessibilityLabel="关闭操作失败提示"
            >
              <Text style={styles.actionErrorText}>{actionError} · 点击关闭</Text>
            </Pressable>
          ) : null}
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
              editable={!commentSending}
              accessibilityLabel="评论内容"
              accessibilityHint="输入建议、复盘或打卡心得，最多 500 字"
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
      <Modal
        visible={editOpen}
        transparent
        animationType="slide"
        onRequestClose={() => {
          if (!editSaving) setEditOpen(false);
        }}
      >
        <View style={styles.editBackdrop}>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            style={styles.editSheet}
          >
            <View style={styles.editHeader}>
              <View>
                <Text style={styles.editTitle}>补充出片</Text>
                <Text style={styles.editSubtitle}>媒体不变，只补充正文、地点和拍摄参数</Text>
              </View>
              <Pressable
                style={styles.editClose}
                onPress={() => setEditOpen(false)}
                disabled={editSaving}
                accessibilityRole="button"
                accessibilityLabel="关闭编辑"
              >
                <Text style={styles.editCloseText}>×</Text>
              </Pressable>
            </View>
            <ScrollView
              style={styles.editScroll}
              contentContainerStyle={styles.editScrollContent}
              keyboardShouldPersistTaps="handled"
            >
              {!!editError ? <Text style={styles.editError}>{editError}</Text> : null}
              <EditField
                label="标题"
                value={editDraft.title}
                onChange={(value) => setEditField('title', value)}
                placeholder="出片记录"
              />
              <EditField
                label="正文 / 攻略"
                value={editDraft.content}
                onChange={(value) => setEditField('content', value)}
                placeholder="分享你的拍摄思路、避坑或最佳时间"
                multiline
              />
              <Text style={styles.editSectionLabel}>位置</Text>
              <View style={styles.editTwoCol}>
                <View style={styles.editCol}><EditField label="地点" value={editDraft.spotName} onChange={(value) => setEditField('spotName', value)} placeholder="出片位置" /></View>
                <View style={styles.editCol}><EditField label="区域" value={editDraft.district} onChange={(value) => setEditField('district', value)} placeholder="可选" /></View>
              </View>
              <Text style={styles.editSectionLabel}>拍摄信息</Text>
              <View style={styles.editTwoCol}>
                <View style={styles.editCol}><EditField label="机位" value={editDraft.angle} onChange={(value) => setEditField('angle', value)} placeholder="平拍 / 低机位" /></View>
                <View style={styles.editCol}><EditField label="光线" value={editDraft.direction} onChange={(value) => setEditField('direction', value)} placeholder="逆光 / 侧光" /></View>
                <View style={styles.editCol}><EditField label="时间窗口" value={editDraft.timeWindow} onChange={(value) => setEditField('timeWindow', value)} placeholder="18:00-19:00" /></View>
                <View style={styles.editCol}><EditField label="拍摄时间" value={editDraft.shotAt} onChange={(value) => setEditField('shotAt', value)} placeholder="2026-08-09 18:30" /></View>
              </View>
              <View style={styles.editTwoCol}>
                <View style={styles.editCol}><EditField label="机身" value={editDraft.camera} onChange={(value) => setEditField('camera', value)} placeholder="相机型号" /></View>
                <View style={styles.editCol}><EditField label="镜头" value={editDraft.lens} onChange={(value) => setEditField('lens', value)} placeholder="镜头型号" /></View>
                <View style={styles.editCol}><EditField label="焦段" value={editDraft.focalLength} onChange={(value) => setEditField('focalLength', value)} placeholder="35mm" /></View>
                <View style={styles.editCol}><EditField label="光圈" value={editDraft.aperture} onChange={(value) => setEditField('aperture', value)} placeholder="f/2.8" /></View>
                <View style={styles.editCol}><EditField label="快门" value={editDraft.shutter} onChange={(value) => setEditField('shutter', value)} placeholder="1/125s" /></View>
                <View style={styles.editCol}><EditField label="ISO" value={editDraft.iso} onChange={(value) => setEditField('iso', value)} placeholder="100" /></View>
                <View style={styles.editCol}><EditField label="白平衡" value={editDraft.whiteBalance} onChange={(value) => setEditField('whiteBalance', value)} placeholder="自动 / 5200K" /></View>
              </View>
              <EditChoiceField
                label="最佳时段"
                value={editDraft.bestTime}
                onChange={(value) => setEditField('bestTime', value)}
                options={EDIT_BEST_TIME_OPTIONS}
              />
            </ScrollView>
            <View style={styles.editFooter}>
              <Pressable style={styles.editCancel} onPress={() => setEditOpen(false)} disabled={editSaving}>
                <Text style={styles.editCancelText}>取消</Text>
              </Pressable>
              <Pressable style={[styles.editSave, editSaving && styles.editSaveDisabled]} onPress={onSaveEdit} disabled={editSaving}>
                <Text style={styles.editSaveText}>{editSaving ? '保存中...' : '保存补充'}</Text>
              </Pressable>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
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
  viewerErrorWrap: {
    alignItems: 'center',
    gap: 12,
  },
  viewerRetry: {
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 7,
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.28)',
  },
  viewerRetryText: { color: '#fff', fontSize: 12, fontWeight: '700' },
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
  editBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(15,15,15,0.42)',
  },
  editSheet: {
    maxHeight: '92%',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    overflow: 'hidden',
    backgroundColor: COLORS.bg,
  },
  editHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 12,
    backgroundColor: COLORS.white,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.line,
  },
  editTitle: { color: COLORS.ink, fontSize: 17, fontWeight: '800' },
  editSubtitle: { color: COLORS.muted, fontSize: 11, marginTop: 3 },
  editClose: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 17 },
  editCloseText: { color: COLORS.ink, fontSize: 27, lineHeight: 29, fontWeight: '300' },
  editScroll: { flexGrow: 0 },
  editScrollContent: { paddingHorizontal: 16, paddingVertical: 14, paddingBottom: 24 },
  editError: { color: '#a34a2a', fontSize: 12, marginBottom: 10 },
  editField: { flex: 1, minWidth: 0, marginBottom: 10 },
  editLabel: { color: COLORS.muted, fontSize: 11, fontWeight: '700', marginBottom: 5 },
  editInput: {
    minHeight: 40,
    paddingHorizontal: 11,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: COLORS.line,
    borderRadius: 10,
    backgroundColor: COLORS.white,
    color: COLORS.ink,
    fontSize: 13,
  },
  editInputMultiline: { minHeight: 92, lineHeight: 19 },
  editSectionLabel: { marginTop: 4, marginBottom: 8, color: COLORS.ink, fontSize: 13, fontWeight: '800' },
  editTwoCol: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 9 },
  editCol: { width: '48.5%' },
  editFooter: {
    flexDirection: 'row',
    gap: 9,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 14,
    backgroundColor: COLORS.white,
    borderTopWidth: 1,
    borderTopColor: COLORS.line,
  },
  editCancel: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: '#f0eeee' },
  editCancelText: { color: COLORS.muted, fontSize: 13, fontWeight: '700' },
  editSave: { flex: 1.45, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: COLORS.accent },
  editSaveDisabled: { opacity: 0.6 },
  editSaveText: { color: COLORS.white, fontSize: 13, fontWeight: '800' },
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
  locationCopy: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  locationDot: {
    width: 6,
    height: 6,
    flexShrink: 0,
    borderRadius: 3,
    backgroundColor: COLORS.accent,
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
  actionError: {
    marginBottom: 6,
    borderRadius: 8,
    backgroundColor: '#fff0f0',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  actionErrorText: {
    color: '#a83f3f',
    fontSize: 11.5,
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
