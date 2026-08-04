import React, { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, Image, ActivityIndicator, Pressable, TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../api';
import { COLORS } from '../config';

export default function PostDetailScreen({ route }) {
  const { postId } = route.params;
  const [post, setPost] = useState(null);
  const [error, setError] = useState(null);
  const [comment, setComment] = useState('');
  const [sending, setSending] = useState(false);
  const [author, setAuthor] = useState('');

  const load = async () => {
    try {
      const d = await api.posts();
      const p = (d.posts || []).find((x) => x.id === postId);
      setPost(p || null);
    } catch (e) {
      setError(e.message);
    }
  };

  useEffect(() => { load(); }, [postId]);

  const doLike = async () => {
    const a = author.trim() || '匿名拍友';
    try {
      const d = await api.likePost(postId, a);
      setPost({ ...post, likes: d.likes });
    } catch (e) { /* ignore */ }
  };

  const doComment = async () => {
    if (!comment.trim()) return;
    setSending(true);
    try {
      await api.commentPost(postId, author.trim() || '匿名拍友', comment.trim());
      setComment('');
      await load();
    } catch (e) { /* ignore */ } finally {
      setSending(false);
    }
  };

  if (error) return <SafeAreaView style={styles.center}><Text style={styles.err}>{error}</Text></SafeAreaView>;
  if (!post) return <SafeAreaView style={styles.center}><ActivityIndicator size="large" color={COLORS.accent} /></SafeAreaView>;

  const gear = post.gear || {};
  const gearRows = [
    ['机身', gear.camera], ['镜头', gear.lens], ['焦距', gear.focal],
    ['光圈', gear.aperture], ['快门', gear.shutter], ['ISO', gear.iso],
  ].filter(([, v]) => v);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView contentContainerStyle={styles.body}>
        <Image source={{ uri: post.cover }} style={styles.cover} />
        <View style={styles.content}>
          <Text style={styles.title}>{post.title}</Text>
          <Text style={styles.authorLine}>
            {post.author || '匿名拍友'}{post.authorBio ? ` · ${post.authorBio}` : ''} · {String(post.createdAt || '').slice(0, 10)}
          </Text>

          <View style={styles.tagsRow}>
            {(post.tags || []).map((t) => <Text key={t} style={styles.tag}>#{t}</Text>)}
            {(post.styles || []).map((t) => <Text key={t} style={[styles.tag, styles.tagStyle]}>{t}</Text>)}
          </View>

          <Text style={styles.contentText}>{post.content || '（博主没有写正文）'}</Text>

          <Text style={styles.sectionTitle}>设备与参数</Text>
          {gearRows.length ? (
            <View style={styles.gearCard}>
              {gearRows.map(([k, v]) => (
                <View key={k} style={styles.gearRow}>
                  <Text style={styles.gearLabel}>{k}</Text>
                  <Text style={styles.gearVal}>{v}</Text>
                </View>
              ))}
            </View>
          ) : (
            <Text style={styles.mutedText}>未填设备参数</Text>
          )}

          {post.angle ? <Text style={styles.extra}>📐 角度：{post.angle}</Text> : null}
          {post.timeWindow ? <Text style={styles.extra}>🕐 时间：{post.timeWindow}</Text> : null}

          <View style={styles.actions}>
            <Pressable style={styles.likeBtn} onPress={doLike}>
              <Text style={styles.likeBtnText}>❤ {post.likes || 0}</Text>
            </Pressable>
            <Text style={styles.commentCount}>💬 {post.comments?.length || 0} 条评论</Text>
          </View>

          <Text style={styles.sectionTitle}>评论</Text>
          {(post.comments || []).length === 0 && <Text style={styles.mutedText}>还没有评论，来抢沙发</Text>}
          {(post.comments || []).map((c) => (
            <View key={c.id} style={styles.commentCard}>
              <Text style={styles.commentAuthor}>{c.author}</Text>
              <Text style={styles.commentText}>{c.text}</Text>
              <Text style={styles.commentTime}>{String(c.createdAt || '').slice(0, 16).replace('T', ' ')}</Text>
            </View>
          ))}

          <View style={styles.commentBox}>
            <TextInput
              style={styles.input}
              placeholder="说点什么…"
              value={comment}
              onChangeText={setComment}
              multiline
            />
            <Pressable style={[styles.sendBtn, sending && styles.sendBtnDisabled]} onPress={doComment} disabled={sending}>
              <Text style={styles.sendBtnText}>发送</Text>
            </Pressable>
          </View>

          <TextInput
            style={[styles.input, styles.authorInput]}
            placeholder="昵称（默认 匿名拍友）"
            value={author}
            onChangeText={setAuthor}
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
  body: { paddingBottom: 50 },
  cover: { width: '100%', height: 220, backgroundColor: COLORS.bgDeep },
  content: { padding: 16 },
  title: { fontSize: 21, fontWeight: '700', color: COLORS.ink, lineHeight: 28 },
  authorLine: { fontSize: 12.5, color: COLORS.muted, marginTop: 6 },
  tagsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  tag: {
    fontSize: 11.5, color: COLORS.muted, backgroundColor: COLORS.bgDeep,
    borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3, overflow: 'hidden',
  },
  tagStyle: { color: '#6d3112', backgroundColor: COLORS.accentSoft },
  contentText: { fontSize: 14.5, lineHeight: 22, color: COLORS.ink, marginTop: 12 },
  sectionTitle: { fontSize: 17, fontWeight: '700', color: COLORS.ink, marginTop: 18, marginBottom: 8 },
  gearCard: {
    backgroundColor: COLORS.panel, borderRadius: 14, padding: 14,
    borderWidth: 1, borderColor: COLORS.line, gap: 8,
  },
  gearRow: { flexDirection: 'row', gap: 10 },
  gearLabel: { fontSize: 13, color: COLORS.muted, width: 44 },
  gearVal: { fontSize: 13, color: COLORS.ink, flex: 1 },
  mutedText: { fontSize: 13, color: COLORS.muted },
  extra: { fontSize: 13, color: COLORS.ink, marginTop: 6 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 16 },
  likeBtn: {
    backgroundColor: COLORS.accent, borderRadius: 999, paddingHorizontal: 18, paddingVertical: 10,
  },
  likeBtnText: { color: COLORS.onAccent, fontWeight: '600', fontSize: 14 },
  commentCount: { fontSize: 13, color: COLORS.muted },
  commentCard: {
    backgroundColor: COLORS.panel, borderRadius: 12, padding: 12,
    borderWidth: 1, borderColor: COLORS.line, marginBottom: 8,
  },
  commentAuthor: { fontSize: 13, fontWeight: '600', color: COLORS.ink },
  commentText: { fontSize: 13.5, color: COLORS.ink, marginTop: 3, lineHeight: 19 },
  commentTime: { fontSize: 11, color: COLORS.muted, marginTop: 4 },
  commentBox: { flexDirection: 'row', gap: 8, marginTop: 10, alignItems: 'flex-end' },
  input: {
    flex: 1, borderWidth: 1, borderColor: COLORS.line, borderRadius: 12,
    padding: 10, backgroundColor: COLORS.panel, fontSize: 13.5, color: COLORS.ink,
    minHeight: 40, maxHeight: 100,
  },
  sendBtn: { backgroundColor: COLORS.accent, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 10 },
  sendBtnDisabled: { opacity: 0.5 },
  sendBtnText: { color: COLORS.onAccent, fontWeight: '600' },
  authorInput: { marginTop: 8 },
});
