import React, { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, Image, ActivityIndicator, Pressable, Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../api';
import { COLORS, TIME_LABELS } from '../config';
import { APP_ROUTES } from '../constants/routes';
import PostCard from '../components/PostCard';

export default function SpotDetailScreen({ navigation, route }) {
  const { spotId, name } = route.params;
  const [spot, setSpot] = useState(null);
  const [posts, setPosts] = useState([]);
  const [postsLoading, setPostsLoading] = useState(true);
  const [postsError, setPostsError] = useState('');
  const [error, setError] = useState(null);
  const [loadAttempt, setLoadAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    (async () => {
      const [spotsResult, postsResult] = await Promise.allSettled([
        api.spots(),
        api.feed({ spotId: String(spotId), limit: 12, sort: 'latest' }),
      ]);
      if (!alive) return;
      if (spotsResult.status === 'fulfilled') {
        const s = (spotsResult.value.spots || []).find((x) => String(x.id) === String(spotId));
        if (s) {
          setSpot(s);
        } else {
          setError('点位不存在或已下线');
        }
      } else {
        setError(spotsResult.reason?.message || '点位加载失败');
      }
      if (postsResult.status === 'fulfilled') {
        setPosts(postsResult.value.posts || []);
        setPostsError('');
      } else {
        setPosts([]);
        setPostsError(postsResult.reason?.message || '作品加载失败');
      }
      setPostsLoading(false);
    })();
    return () => { alive = false; };
  }, [loadAttempt, spotId]);

  if (error) {
    return (
      <SafeAreaView style={styles.center}>
        <Text style={styles.err}>{error}</Text>
        <Pressable
          style={styles.retryBtn}
          onPress={() => {
            setError(null);
            setSpot(null);
            setPostsLoading(true);
            setLoadAttempt((value) => value + 1);
          }}
          accessibilityRole="button"
          accessibilityLabel="重新加载点位"
        >
          <Text style={styles.retryText}>重新加载</Text>
        </Pressable>
      </SafeAreaView>
    );
  }
  if (!spot) return <SafeAreaView style={styles.center}><ActivityIndicator size="large" color={COLORS.accent} /></SafeAreaView>;

  const vps = spot.vantagePoints || [];

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView contentContainerStyle={styles.body}>
        <Image source={{ uri: spot.cover }} style={styles.cover} />
        <View style={styles.content}>
          <Text style={styles.title}>{spot.name}</Text>
          <Text style={styles.sub}>
            {spot.district} · {TIME_LABELS[spot.bestTime] || spot.bestTime} · ⭐ {spot.rating} · {spot.difficulty}
          </Text>
          <Text style={styles.summary}>{spot.summary}</Text>

          <View style={styles.tagsRow}>
            {(spot.styles || []).map((t) => <Text key={t} style={styles.tag}>{t}</Text>)}
          </View>

          <View style={styles.infoCard}>
            <Text style={styles.infoLine}>🕐 最佳时段：{spot.timeWindow || '—'}</Text>
            <Text style={styles.infoLine}>📷 推荐镜头：{spot.gear || '—'}</Text>
            <Text style={styles.infoLine}>📍 地址：{spot.address || '—'}</Text>
            <Text style={styles.infoLine}>💡 提示：{spot.tips || '—'}</Text>
          </View>

          <Text style={styles.sectionTitle}>机位 · 角度 · 时间</Text>
          {vps.length === 0 && <Text style={styles.emptyInline}>暂无机位明细</Text>}
          {vps.map((v, i) => (
            <View key={v.id} style={styles.vpCard}>
              <View style={styles.vpHead}>
                <Text style={styles.vpIndex}>机位 {String(i + 1).padStart(2, '0')}</Text>
                <Text style={styles.vpName}>{v.name}</Text>
              </View>
              <View style={styles.vpRow}><Text style={styles.vpLabel}>角度</Text><Text style={styles.vpVal}>{v.angle || '—'}</Text></View>
              <View style={styles.vpRow}><Text style={styles.vpLabel}>朝向</Text><Text style={styles.vpVal}>{v.direction || '—'}</Text></View>
              <View style={styles.vpRow}><Text style={styles.vpLabel}>时间</Text><Text style={styles.vpVal}>{v.timeWindow || TIME_LABELS[v.bestTime] || '—'}</Text></View>
              <View style={styles.vpRow}><Text style={styles.vpLabel}>构图</Text><Text style={styles.vpVal}>{v.composition || '—'}</Text></View>
              <View style={styles.vpRow}><Text style={styles.vpLabel}>提示</Text><Text style={styles.vpVal}>{v.tips || '—'}</Text></View>
            </View>
          ))}

          <Text style={styles.sectionTitle}>这个点位的出片</Text>
          {postsLoading ? <ActivityIndicator color={COLORS.accent} /> : null}
          {!postsLoading && postsError ? <Text style={styles.postsError}>{postsError}</Text> : null}
          {!postsLoading && !postsError && posts.length ? (
            <View style={styles.postsGrid}>
              {posts.map((post) => (
                <PostCard
                  key={post.id}
                  post={post}
                  compact
                  hideCompactAuthor
                  showFollow={false}
                  style={styles.postCard}
                  onPress={() => navigation.navigate('PostDetail', { postId: post.id, title: post.title })}
                />
              ))}
            </View>
          ) : null}
          {!postsLoading && !postsError && !posts.length ? (
            <Text style={styles.emptyInline}>还没有人在这里发布出片</Text>
          ) : null}

          <Pressable
            style={styles.navBtn}
            onPress={() => Linking.openURL(`https://www.openstreetmap.org/?mlat=${spot.lat}&mlon=${spot.lng}#map=17/${spot.lat}/${spot.lng}`)}
          >
            <Text style={styles.navBtnText}>🧭 打开导航</Text>
          </Pressable>
          <Pressable
            style={styles.navBtn}
            onPress={() => {
              const parent = navigation.getParent && navigation.getParent();
              const prefillSpot = {
                id: String(spot.id || ''),
                name: spot.name || '',
                district: spot.district || '',
                latitude: spot.latitude ?? spot.lat ?? '',
                longitude: spot.longitude ?? spot.lng ?? '',
              };
              if (parent) {
                parent.navigate(APP_ROUTES.CREATE, {
                  screen: 'NewPost',
                  params: { prefillSpot },
                });
                return;
              }
              navigation.navigate(APP_ROUTES.CREATE, {
                screen: 'NewPost',
                params: { prefillSpot },
              });
            }}
          >
            <Text style={styles.navBtnText}>＋ 去发布这个点</Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.bg },
  err: { color: '#a34a2a' },
  retryBtn: {
    marginTop: 14,
    minHeight: 40,
    paddingHorizontal: 18,
    borderRadius: 999,
    justifyContent: 'center',
    backgroundColor: COLORS.accent,
  },
  retryText: { color: COLORS.onAccent, fontSize: 13, fontWeight: '700' },
  body: { paddingBottom: 40 },
  cover: { width: '100%', height: 200, backgroundColor: COLORS.bgDeep },
  content: { padding: 16 },
  title: { fontSize: 22, fontWeight: '700', color: COLORS.ink },
  sub: { fontSize: 13, color: COLORS.muted, marginTop: 4 },
  summary: { fontSize: 14, lineHeight: 21, color: COLORS.ink, marginTop: 10, opacity: 0.92 },
  tagsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  tag: {
    fontSize: 12, color: '#6d3112', backgroundColor: COLORS.accentSoft,
    borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3, overflow: 'hidden',
  },
  infoCard: {
    backgroundColor: COLORS.panel, borderRadius: 14, padding: 14,
    borderWidth: 1, borderColor: COLORS.line, marginTop: 14, gap: 6,
  },
  infoLine: { fontSize: 13, color: COLORS.ink, lineHeight: 20 },
  sectionTitle: { fontSize: 17, fontWeight: '700', color: COLORS.ink, marginTop: 20, marginBottom: 10 },
  emptyInline: { color: COLORS.muted, fontSize: 13 },
  vpCard: {
    backgroundColor: COLORS.panel, borderRadius: 14, padding: 14,
    borderWidth: 1, borderColor: COLORS.line, marginBottom: 10,
  },
  vpHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  vpIndex: {
    fontSize: 11, fontWeight: '700', color: COLORS.accent,
    backgroundColor: COLORS.accentSoft, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, overflow: 'hidden',
  },
  vpName: { fontSize: 15, fontWeight: '600', color: COLORS.ink, flex: 1 },
  vpRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
  vpLabel: { fontSize: 12.5, color: COLORS.muted, width: 40 },
  vpVal: { fontSize: 12.5, color: COLORS.ink, flex: 1, lineHeight: 18 },
  postsError: { color: '#a34a2a', fontSize: 12.5, lineHeight: 18 },
  postsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  postCard: { width: '48%' },
  navBtn: {
    marginTop: 16, backgroundColor: COLORS.accent, borderRadius: 999,
    paddingVertical: 13, alignItems: 'center',
  },
  navBtnText: { color: COLORS.onAccent, fontSize: 15, fontWeight: '600' },
});
