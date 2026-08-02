import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../api';
import { COLORS } from '../config';
import ActionBar from '../components/ActionBar';
import MediaGallery from '../components/MediaGallery';
import VideoSurface from '../components/VideoSurface';
import ShotMetaPanel from '../components/ShotMetaPanel';
import { formatCompactDate } from '../utils/time';

export default function PostDetailScreen({ route }) {
  const { postId } = route.params;
  const [post, setPost] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [comment, setComment] = useState('');
  const [sending, setSending] = useState(false);
  const [author, setAuthor] = useState('匿名拍友');
  const [actionBusy, setActionBusy] = useState({
    like: false,
    favorite: false,
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getPost(postId);
      setPost(data);
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [postId]);

  useEffect(() => { load(); }, [load]);

  const setBusy = useCallback((key, value) => {
    setActionBusy((prev) => ({ ...prev, [key]: value }));
  }, []);

  const onLike = useCallback(async () => {
    if (!post || actionBusy.like) return;
    let base = null;

    setPost((prev) => {
      if (!prev) return prev;
      base = prev;
      const nextLiked = !prev.liked;
      return {
        ...prev,
        liked: nextLiked,
        likes: Math.max(0, Number(prev.likes || 0) + (nextLiked ? 1 : -1)),
      };
    });
    if (!base) return;

    setBusy('like', true);
    try {
      const next = !base.liked;
      await api.toggleLike(base.id, author, next ? 'like' : 'unlike');
      const fresh = await api.getPost(base.id);
      setPost((prev) => ({
        ...prev,
        likes: fresh.likes,
        liked: Boolean(fresh.liked),
      }));
    } catch (_e) {
      setPost((prev) => ({
        ...prev,
        likes: base.likes,
        liked: base.liked,
      }));
    } finally {
      setBusy('like', false);
    }
  }, [author, actionBusy.like, post, setBusy]);

  const onFavorite = useCallback(async () => {
    if (!post || actionBusy.favorite) return;
    let base = null;

    setPost((prev) => {
      if (!prev) return prev;
      base = prev;
      const nextFavorited = !prev.favorited;
      return {
        ...prev,
        favorited: nextFavorited,
        favorites: Math.max(0, Number(prev.favorites || 0) + (nextFavorited ? 1 : -1)),
      };
    });
    if (!base) return;

    setBusy('favorite', true);
    try {
      const next = !base.favorited;
      await api.toggleFavorite(base.id, author, next ? 'favorite' : 'unfavorite');
      const fresh = await api.getPost(base.id);
      setPost((prev) => ({
        ...prev,
        favorites: fresh.favorites,
        favorited: Boolean(fresh.favorited),
      }));
    } catch (_e) {
      setPost((prev) => ({
        ...prev,
        favorites: base.favorites,
        favorited: base.favorited,
      }));
    } finally {
      setBusy('favorite', false);
    }
  }, [author, actionBusy.favorite, post, setBusy]);

  const onSendComment = useCallback(async () => {
    if (!comment.trim() || !post) return;
    setSending(true);
    try {
      await api.comment(post.id, author || '匿名拍友', comment.trim());
      setComment('');
      await load();
    } catch (_e) {
      // 失败时保留输入，允许用户重试
    } finally {
      setSending(false);
    }
  }, [author, comment, load, post]);

  if (loading) {
    return <SafeAreaView style={styles.center}><ActivityIndicator size="large" color={COLORS.accent} /></SafeAreaView>;
  }

  if (error || !post) {
    return <SafeAreaView style={styles.center}><Text style={styles.err}>{error || '内容不存在'}</Text></SafeAreaView>;
  }

  const renderVideo = (item, idx) => {
    if (!item.url) return null;
    if (item.kind !== 'video') return null;
    return (
      <View key={`${item.url}-${idx}`} style={styles.videoCard}>
        <VideoSurface uri={item.url} style={styles.video} />
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView contentContainerStyle={styles.body}>
        <MediaGallery media={post.media || []} showAll columns={1} />
        <View style={styles.contentCard}>
          <View style={styles.authorRow}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{(post.author || '匿名拍友').slice(0, 2)}</Text>
            </View>
            <View style={styles.authorMeta}>
              <Text style={styles.authorLine}>
                {post.author || '匿名拍友'}
              </Text>
              <Text style={styles.postMeta}>
                {(post.authorBio ? `${post.authorBio} · ` : '') + formatCompactDate(post.createdAt)}
              </Text>
            </View>
            <Pressable style={styles.followBtn}><Text style={styles.followText}>关注</Text></Pressable>
          </View>

          <Text style={styles.title}>{post.title}</Text>

          <View style={styles.tags}>
            {(post.styles || []).map((item) => <Text key={item} style={styles.tag}>#{item}</Text>)}
            {(post.tags || []).map((item) => <Text key={item} style={styles.tag}>{item}</Text>)}
          </View>

          <Text style={styles.contentText}>{post.content || '内容暂无说明'}</Text>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>参数卡片</Text>
            <ShotMetaPanel post={post} fallback="博主未填写拍摄参数。" />
          </View>

          {post.media?.some((m) => m.kind === 'video') ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>视频</Text>
              {post.media.map(renderVideo)}
            </View>
          ) : null}

          <ActionBar
            likes={post.likes || 0}
            favorites={post.favorites || 0}
            comments={post.comments?.length || 0}
            liked={post.liked}
            favorited={post.favorited}
            likeBusy={actionBusy.like}
            favoriteBusy={actionBusy.favorite}
            onLike={onLike}
            onFavorite={onFavorite}
            onComment={() => {}}
          />

          <Text style={styles.sectionTitle}>评论 ({(post.comments || []).length})</Text>
          {(post.comments || []).length === 0 ? <Text style={styles.note}>还没有评论，快点下第一个吧</Text> : null}
          {(post.comments || []).map((item) => (
            <View key={item.id} style={styles.commentCard}>
              <Text style={styles.commentAuthor}>{item.author}</Text>
              <Text style={styles.commentText}>{item.text}</Text>
            <Text style={styles.commentTime}>{formatCompactDate(item.createdAt)}</Text>
            </View>
          ))}

          <View style={styles.commentBar}>
            <TextInput
              value={comment}
              onChangeText={setComment}
              style={styles.input}
              placeholder="写下你的拍摄反馈"
              placeholderTextColor={COLORS.muted}
              multiline
            />
            <Pressable
              style={[styles.sendBtn, sending && styles.sendBtnDisabled]}
              onPress={onSendComment}
              disabled={sending}
            >
              <Text style={styles.sendBtnText}>{sending ? '发送中' : '发送'}</Text>
            </Pressable>
          </View>

          <TextInput
            value={author}
            onChangeText={setAuthor}
            style={[styles.input, styles.authorInput]}
            placeholder="昵称（默认匿名拍友）"
            placeholderTextColor={COLORS.muted}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.bg },
  err: { color: '#a34a2a' },
  body: { paddingBottom: 40 },
  contentCard: { padding: 14 },
  authorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 12,
  },
  avatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.accentBg,
  },
  avatarText: {
    color: COLORS.accent,
    fontSize: 13,
    fontWeight: '700',
  },
  authorMeta: { flex: 1 },
  title: { fontSize: 24, color: COLORS.ink, fontWeight: '700', lineHeight: 32 },
  authorLine: { fontSize: 13.5, color: COLORS.ink, fontWeight: '700' },
  postMeta: { color: COLORS.muted, marginTop: 2, fontSize: 12 },
  followBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: COLORS.accentBg,
  },
  followText: { color: COLORS.accent, fontSize: 11.5, fontWeight: '700' },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  tag: {
    fontSize: 11.5,
    color: COLORS.accent,
    backgroundColor: COLORS.accentBg,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  contentText: { fontSize: 14.5, color: COLORS.ink, marginTop: 12, lineHeight: 22 },
  section: { marginTop: 14 },
  sectionTitle: { fontSize: 16, color: COLORS.ink, fontWeight: '700' },
  note: { marginTop: 8, color: COLORS.muted, fontSize: 13 },
  videoCard: { marginTop: 8, borderRadius: 10, overflow: 'hidden' },
  video: { width: '100%', height: 240, backgroundColor: '#000' },
  commentCard: { marginTop: 8, backgroundColor: COLORS.card, borderRadius: 10, borderWidth: 1, borderColor: COLORS.cardBorder, padding: 10 },
  commentAuthor: { color: COLORS.ink, fontWeight: '700', fontSize: 13 },
  commentText: { color: COLORS.ink, marginTop: 4, lineHeight: 20, fontSize: 13.5 },
  commentTime: { color: COLORS.muted, marginTop: 4, fontSize: 11 },
  commentBar: { flexDirection: 'row', gap: 8, marginTop: 12, alignItems: 'flex-end' },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    borderRadius: 12,
    backgroundColor: COLORS.card,
    color: COLORS.ink,
    minHeight: 42,
    maxHeight: 100,
    padding: 10,
    fontSize: 13.5,
  },
  sendBtn: {
    backgroundColor: COLORS.accent,
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 11,
  },
  sendBtnDisabled: { opacity: 0.6 },
  sendBtnText: { color: COLORS.onAccent, fontWeight: '700', fontSize: 13.5 },
  authorInput: { marginTop: 8 },
});
