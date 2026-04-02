import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
import { Video } from 'expo-av';
import { api } from '../api';
import { COLORS } from '../config';
import ActionBar from '../components/ActionBar';
import MediaGallery from '../components/MediaGallery';

function formatTime(value) {
  const text = String(value || '').replace('T', ' ');
  return text.length > 16 ? text.slice(0, 16) : text;
}

export default function PostDetailScreen({ route }) {
  const { postId } = route.params;
  const [post, setPost] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [comment, setComment] = useState('');
  const [sending, setSending] = useState(false);
  const [author, setAuthor] = useState('匿名拍友');

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

  const postActions = useMemo(() => {
    if (!post) return null;
    return {
      onLike: async () => {
        try {
          const next = !post.liked;
          setPost((prev) => ({
            ...prev,
            liked: next,
            likes: Math.max(0, Number(prev.likes || 0) + (next ? 1 : -1)),
          }));
          await api.toggleLike(post.id, author, next ? 'like' : 'unlike');
          const fresh = await api.getPost(post.id);
          setPost((prev) => ({
            ...prev,
            likes: fresh.likes,
            liked: Boolean(fresh.liked),
          }));
        } catch (e) {
          setPost((prev) => ({
            ...prev,
            likes: Math.max(0, (prev.likes || 0) + (prev.liked ? -1 : 1)),
            liked: !prev.liked,
          }));
        }
      },
      onFavorite: async () => {
        try {
          const next = !post.favorited;
          setPost((prev) => ({
            ...prev,
            favorited: next,
            favorites: Math.max(0, Number(prev.favorites || 0) + (next ? 1 : -1)),
          }));
          await api.toggleFavorite(post.id, author, next ? 'favorite' : 'unfavorite');
          const fresh = await api.getPost(post.id);
          setPost((prev) => ({
            ...prev,
            favorites: fresh.favorites,
            favorited: Boolean(fresh.favorited),
          }));
        } catch (e) {
          setPost((prev) => ({
            ...prev,
            favorites: Math.max(0, (prev.favorites || 0) + (prev.favorited ? -1 : 1)),
            favorited: !prev.favorited,
          }));
        }
      },
    };
  }, [author, post]);

  const onSendComment = useCallback(async () => {
    if (!comment.trim() || !post) return;
    setSending(true);
    try {
      await api.comment(post.id, author || '匿名拍友', comment.trim());
      setComment('');
      await load();
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

  const gear = post.gear || {};
  const shootRows = [
    ['机位', post.angle || post.direction || '未填写'],
    ['地点', post.spotName || post.spotId || '未填写'],
    ['时间窗口', post.timeWindow || '未填写'],
    ['时段', post.bestTime || '未填写'],
    ['相机', gear.camera || '未填写'],
    ['镜头', gear.lens || '未填写'],
    ['焦距', gear.focal || '未填写'],
    ['光圈', gear.aperture || '未填写'],
    ['快门', gear.shutter || '未填写'],
    ['ISO', gear.iso || '未填写'],
    ['白平衡', gear.whiteBalance || '未填写'],
  ].filter(([, value]) => value);

  const renderVideo = (item, idx) => {
    if (!item.url) return null;
    if (item.kind !== 'video') return null;
    return (
      <View key={`${item.url}-${idx}`} style={styles.videoCard}>
        <Video
          style={styles.video}
          source={{ uri: item.url }}
          useNativeControls
          shouldPlay={false}
          resizeMode="contain"
        />
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView contentContainerStyle={styles.body}>
        <MediaGallery media={post.media || []} showAll columns={1} />
        <View style={styles.contentCard}>
          <Text style={styles.title}>{post.title}</Text>
          <Text style={styles.authorLine}>
            {post.author || '匿名拍友'} · {post.authorBio ? `${post.authorBio} · ` : ''}{formatTime(post.createdAt)}
          </Text>

          <View style={styles.tags}>
            {(post.styles || []).map((item) => <Text key={item} style={styles.tag}>#{item}</Text>)}
            {(post.tags || []).map((item) => <Text key={item} style={styles.tag}>{item}</Text>)}
          </View>

          <Text style={styles.contentText}>{post.content || '内容暂无说明'}</Text>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>参数卡片</Text>
            {(shootRows.length === 0) ? (
              <Text style={styles.note}>博主未填写拍摄参数。</Text>
            ) : (
              shootRows.map(([k, v]) => (
                <View key={k} style={styles.rowItem}>
                  <Text style={styles.rowKey}>{k}</Text>
                  <Text style={styles.rowVal}>{v}</Text>
                </View>
              ))
            )}
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
            onLike={postActions.onLike}
            onFavorite={postActions.onFavorite}
            onComment={() => {}}
          />

          <Text style={styles.sectionTitle}>评论 ({(post.comments || []).length})</Text>
          {(post.comments || []).length === 0 ? <Text style={styles.note}>还没有评论，快点下第一个吧</Text> : null}
          {(post.comments || []).map((item) => (
            <View key={item.id} style={styles.commentCard}>
              <Text style={styles.commentAuthor}>{item.author}</Text>
              <Text style={styles.commentText}>{item.text}</Text>
              <Text style={styles.commentTime}>{formatTime(item.createdAt)}</Text>
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
  title: { fontSize: 22, color: COLORS.ink, fontWeight: '700', lineHeight: 30 },
  authorLine: { fontSize: 12.5, color: COLORS.muted, marginTop: 6 },
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
  rowItem: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 },
  rowKey: { color: COLORS.muted, fontSize: 13 },
  rowVal: { color: COLORS.ink, fontSize: 13, maxWidth: '65%', textAlign: 'right' },
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
