import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, FlatList, StyleSheet, Pressable, RefreshControl, ActivityIndicator, Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../api';
import { COLORS, TIME_LABELS } from '../config';
import CATEGORIES from '../data/categories';
import { APP_ROUTES } from '../constants/routes';

export default function SpotsScreen({ navigation }) {
  const [spots, setSpots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [cat, setCat] = useState('all');
  const [time, setTime] = useState('all');
  const [error, setError] = useState(null);
  const [locationLabel, setLocationLabel] = useState('');
  const [locationLoading, setLocationLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const d = await api.spots();
      setSpots(d.spots || []);
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    let alive = true;
    api.resolveLocation()
      .then((payload) => {
        if (!alive) return;
        setLocationLabel(String(payload?.location?.label || '').trim());
      })
      .catch(() => {
        if (alive) setLocationLabel('');
      })
      .finally(() => {
        if (alive) setLocationLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const onRefresh = useCallback(() => { setRefreshing(true); load(); }, [load]);
  const openMap = useCallback(() => {
    const parent = navigation.getParent && navigation.getParent();
    if (parent) {
      parent.navigate(APP_ROUTES.MAP);
      return;
    }
    navigation.navigate(APP_ROUTES.MAP);
  }, [navigation]);
  const onCreatePost = useCallback((spot) => {
    const parent = navigation.getParent && navigation.getParent();
    const prefillSpot = {
      id: String(spot.id || ''),
      name: spot.name || '',
      district: spot.district || '',
    };
    if (parent) {
      parent.navigate(APP_ROUTES.CREATE, { prefillSpot });
      return;
    }
    navigation.navigate(APP_ROUTES.CREATE, { prefillSpot });
  }, [navigation]);

  const cats = [{ id: 'all', name: '全部' }, ...CATEGORIES];

  const filtered = spots.filter((s) => {
    if (cat !== 'all' && s.category !== cat) return false;
    if (time !== 'all' && s.bestTime !== time) return false;
    return true;
  });

  if (loading) {
    return (
      <View style={styles.center}><ActivityIndicator size="large" color={COLORS.accent} /></View>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>出片点位</Text>
        <Text style={styles.subtitle}>
          {filtered.length} 个地点 · {locationLoading ? '正在定位' : (locationLabel || '附近')}
        </Text>
        <Pressable style={styles.mapBtn} onPress={openMap}>
          <Text style={styles.mapBtnText}>🗺️ 打开地图</Text>
        </Pressable>
      </View>

      <View style={styles.filterRow}>
        {['all', 'street', 'night', 'arch', 'water', 'park', 'cafe'].map((c) => (
          <Pressable
            key={c}
            style={[styles.pill, cat === c && styles.pillActive]}
            onPress={() => setCat(c)}
          >
            <Text style={[styles.pillText, cat === c && styles.pillTextActive]}>
              {c === 'all' ? '全部' : ({ street: '街景', night: '夜景', arch: '建筑', water: '江景', park: '公园', cafe: '咖啡' }[c] || c)}
            </Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.filterRow}>
        {['all', 'day', 'golden', 'night'].map((t) => (
          <Pressable
            key={t}
            style={[styles.pill, time === t && styles.pillActive]}
            onPress={() => setTime(t)}
          >
            <Text style={[styles.pillText, time === t && styles.pillTextActive]}>
              {t === 'all' ? '全部时段' : TIME_LABELS[t]}
            </Text>
          </Pressable>
        ))}
      </View>

      {error && <Text style={styles.error}>加载失败：{error}</Text>}

      <FlatList
        data={filtered}
        keyExtractor={(s) => s.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.accent} />}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <Pressable
            style={styles.card}
            onPress={() => navigation.navigate('SpotDetail', { spotId: item.id, name: item.name })}
          >
            <Image source={{ uri: item.cover }} style={styles.cover} />
            <View style={styles.cardBody}>
              <Text style={styles.cardTitle}>{item.name}</Text>
              <Text style={styles.cardSub}>
                {item.district} · {TIME_LABELS[item.bestTime] || item.bestTime} · ⭐ {item.rating}
              </Text>
              <Text style={styles.cardSub2}>{item.timeWindow || ''} · {(item.vantagePoints || []).length} 个机位</Text>
              <View style={styles.tags}>
                {(item.styles || []).slice(0, 2).map((t) => (
                  <Text key={t} style={styles.tag}>{t}</Text>
                ))}
              </View>
              <Pressable style={styles.quickPostBtn} onPress={() => onCreatePost(item)}>
                <Text style={styles.quickPostText}>发布此点</Text>
              </Pressable>
            </View>
          </Pressable>
        )}
        ListEmptyComponent={<Text style={styles.empty}>没有匹配的出片点</Text>}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.bg },
  header: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 },
  title: { fontSize: 24, fontWeight: '700', color: COLORS.ink, letterSpacing: -0.5 },
  subtitle: { fontSize: 13, color: COLORS.muted, marginTop: 2 },
  mapBtn: {
    alignSelf: 'flex-start',
    marginTop: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    backgroundColor: COLORS.accentBg,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  mapBtnText: { fontSize: 12.5, color: COLORS.accent, fontWeight: '600' },
  filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingHorizontal: 16, paddingVertical: 5 },
  pill: {
    borderRadius: 999, borderWidth: 1, borderColor: COLORS.line,
    paddingHorizontal: 12, paddingVertical: 6, backgroundColor: 'rgba(255,255,255,0.6)',
  },
  pillActive: { backgroundColor: COLORS.accent, borderColor: COLORS.accent },
  pillText: { fontSize: 13, color: COLORS.muted },
  pillTextActive: { color: COLORS.onAccent, fontWeight: '600' },
  error: { color: '#a34a2a', paddingHorizontal: 16, paddingVertical: 8 },
  list: { padding: 16, gap: 12, paddingBottom: 30 },
  card: {
    flexDirection: 'row', gap: 12, backgroundColor: COLORS.panel,
    borderRadius: 16, padding: 12, borderWidth: 1, borderColor: COLORS.line,
  },
  cover: { width: 84, height: 84, borderRadius: 12, backgroundColor: COLORS.bgDeep },
  cardBody: { flex: 1 },
  cardTitle: { fontSize: 16, fontWeight: '600', color: COLORS.ink },
  cardSub: { fontSize: 12.5, color: COLORS.muted, marginTop: 3 },
  cardSub2: { fontSize: 11.5, color: COLORS.muted, marginTop: 2, opacity: 0.9 },
  tags: { flexDirection: 'row', gap: 6, marginTop: 6 },
  tag: {
    fontSize: 11, color: '#6d3112', backgroundColor: COLORS.accentSoft,
    borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, overflow: 'hidden',
  },
  quickPostBtn: {
    marginTop: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: COLORS.accent,
    paddingHorizontal: 10,
    paddingVertical: 6,
    alignSelf: 'flex-start',
    backgroundColor: COLORS.accentBg,
  },
  quickPostText: {
    color: COLORS.accent,
    fontSize: 11.5,
    fontWeight: '600',
  },
  empty: { textAlign: 'center', color: COLORS.muted, marginTop: 40 },
});
