import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, FlatList, StyleSheet, Pressable, Image, RefreshControl, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../api';
import { COLORS } from '../config';

export default function PostsScreen({ navigation }) {
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      const d = await api.posts();
      setPosts(d.posts || []);
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  const onRefresh = useCallback(() => { setRefreshing(true); load(); }, [load]);

  if (loading) {
    return <View style={styles.center}><ActivityIndicator size="large" color={COLORS.accent} /></View>;
  }

  const renderCard = ({ item }) => (
    <Pressable
      style={styles.card}
      onPress={() => navigation.navigate('PostDetail', { postId: item.id, title: item.title })}
    >
      <Image source={{ uri: item.cover }} style={styles.cover} />
      <View style={styles.cardBody}>
        <Text style={styles.cardTitle} numberOfLines={2}>{item.title}</Text>
        <View style={styles.metaRow}>
          <Text style={styles.author}>{item.author || '匿名'}</Text>
          {item.spotName ? <Text style={styles.spot} numberOfLines={1}>📍 {item.spotName}</Text> : null}
        </View>
        <View style={styles.gearRow}>
          {item.gear?.camera ? <Text style={styles.gear}>📷 {item.gear.camera}</Text> : null}
          {item.gear?.focal ? <Text style={styles.gear}>🔍 {item.gear.focal}</Text> : null}
          {item.angle ? <Text style={styles.gear} numberOfLines={1}>📐 {item.angle}</Text> : null}
        </View>
        <Text style={styles.likes}>❤ {item.likes || 0}</Text>
      </View>
    </Pressable>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>出片攻略</Text>
        <Pressable style={styles.newBtn} onPress={() => navigation.navigate('NewPost')}>
          <Text style={styles.newBtnText}>＋ 发攻略</Text>
        </Pressable>
      </View>
      {error && <Text style={styles.error}>加载失败：{error}</Text>}
      <FlatList
        data={posts}
        keyExtractor={(p) => p.id}
        numColumns={2}
        columnWrapperStyle={styles.colWrap}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.accent} />}
        contentContainerStyle={styles.list}
        renderItem={renderCard}
        ListEmptyComponent={<Text style={styles.empty}>还没有攻略，点「发攻略」分享第一张作品</Text>}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.bg },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 16, paddingTop: 8, paddingBottom: 8,
  },
  title: { fontSize: 24, fontWeight: '700', color: COLORS.ink, letterSpacing: -0.5 },
  newBtn: { backgroundColor: COLORS.accent, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
  newBtnText: { color: COLORS.onAccent, fontWeight: '600', fontSize: 13.5 },
  error: { color: '#a34a2a', paddingHorizontal: 16, paddingBottom: 6 },
  list: { padding: 12, paddingBottom: 30 },
  colWrap: { gap: 12 },
  card: {
    flex: 1, backgroundColor: COLORS.panel, borderRadius: 16, overflow: 'hidden',
    borderWidth: 1, borderColor: COLORS.line, marginBottom: 12,
  },
  cover: { width: '100%', height: 180, backgroundColor: COLORS.bgDeep },
  cardBody: { padding: 10 },
  cardTitle: { fontSize: 14, fontWeight: '600', color: COLORS.ink, lineHeight: 19 },
  metaRow: { flexDirection: 'row', gap: 8, marginTop: 6, alignItems: 'center' },
  author: { fontSize: 12, color: COLORS.ink, fontWeight: '600', flexShrink: 1 },
  spot: { fontSize: 11.5, color: COLORS.accent, flexShrink: 1 },
  gearRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  gear: { fontSize: 11, color: COLORS.muted },
  likes: { fontSize: 12, color: COLORS.accent, marginTop: 6, fontWeight: '600' },
  empty: { textAlign: 'center', color: COLORS.muted, marginTop: 60, fontSize: 14 },
});
