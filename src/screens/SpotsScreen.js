import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, FlatList, StyleSheet, Pressable, RefreshControl, ActivityIndicator, Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../api';
import { COLORS, TIME_LABELS } from '../config';
import CATEGORIES from '../data/categories';
import { APP_ROUTES } from '../constants/routes';
import RemoteImage from '../components/RemoteImage';
import { getCurrentLocation } from '../utils/location';

function formatDistance(value) {
  const distance = Number(value);
  if (!Number.isFinite(distance)) return '';
  if (distance < 1) return '1 km内';
  return `${distance < 10 ? distance.toFixed(1) : Math.round(distance)} km`;
}

export default function SpotsScreen({ navigation }) {
  const [spots, setSpots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [cat, setCat] = useState('all');
  const [time, setTime] = useState('all');
  const [error, setError] = useState(null);
  const [locationError, setLocationError] = useState('');
  const [locationLabel, setLocationLabel] = useState('');
  const [locationLoading, setLocationLoading] = useState(true);
  const [location, setLocation] = useState(null);
  const [locationAttempt, setLocationAttempt] = useState(0);

  const load = useCallback(async () => {
    if (locationLoading) return;
    if (!location) {
      setSpots([]);
      setLocationError('暂时无法获取当前位置，请允许定位后重试。');
      setLoading(false);
      setRefreshing(false);
      return;
    }
    try {
      const d = await api.spots({
        latitude: location.lat,
        longitude: location.lng,
        radiusKm: 50,
        limit: 80,
      });
      setSpots(d.spots || []);
      setError(null);
      setLocationError('');
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [location, locationLoading]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    let alive = true;
    setLocationLoading(true);
    setLocationError('');
    getCurrentLocation()
      .catch(() => api.resolveLocation().then((payload) => payload?.location || null))
      .then((payload) => {
        if (!alive) return;
        const lat = Number(payload?.lat);
        const lng = Number(payload?.lng);
        setLocation(
          Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null,
        );
        setLocationLabel(String(payload?.label || '').trim());
      })
      .catch(() => {
        if (alive) {
          setLocation(null);
          setLocationLabel('');
          setLocationError('暂时无法获取当前位置，请允许定位后重试。');
        }
      })
      .finally(() => {
        if (alive) setLocationLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [locationAttempt]);

  const onRefresh = useCallback(() => { setRefreshing(true); load(); }, [load]);
  const retryLocation = useCallback(() => {
    setLoading(true);
    setLocation(null);
    setLocationError('');
    setLocationAttempt((value) => value + 1);
  }, []);
  const openLocationSettings = useCallback(() => {
    if (typeof Linking.openSettings !== 'function') return;
    Linking.openSettings().catch(() => {});
  }, []);
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
          {filtered.length} 个地点 · {locationLoading ? '正在定位' : (locationLabel || (location ? '附近' : '全部点位'))}
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

      {locationError ? (
        <View style={styles.locationNotice}>
          <Text style={styles.locationNoticeTitle}>需要当前位置</Text>
          <Text style={styles.locationNoticeText}>{locationError}</Text>
          <View style={styles.locationActions}>
            <Pressable style={styles.retryLocationBtn} onPress={retryLocation} accessibilityRole="button">
              <Text style={styles.retryLocationText}>重新定位</Text>
            </Pressable>
            <Pressable
              style={styles.settingsLocationBtn}
              onPress={openLocationSettings}
              accessibilityRole="button"
              accessibilityLabel="打开系统定位设置"
            >
              <Text style={styles.settingsLocationText}>打开设置</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
      {error && !locationError ? <Text style={styles.error}>加载失败：{error}</Text> : null}

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
            <RemoteImage
              uri={item.cover}
              style={styles.cover}
              fallback="暂无封面"
              accessibilityLabel={`${item.name || '出片点位'}封面`}
            />
            <View style={styles.cardBody}>
              <Text style={styles.cardTitle}>{item.name}</Text>
              <Text style={styles.cardSub}>
                {[
                  item.district,
                  TIME_LABELS[item.bestTime] || item.bestTime,
                  item.rating ? `⭐ ${item.rating}` : '',
                  formatDistance(item.distanceKm),
                ].filter(Boolean).join(' · ')}
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
        ListEmptyComponent={locationError ? null : <Text style={styles.empty}>没有匹配的出片点</Text>}
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
  locationNotice: {
    marginHorizontal: 16,
    marginTop: 8,
    padding: 14,
    borderRadius: 14,
    backgroundColor: COLORS.accentBg,
    borderWidth: 1,
    borderColor: COLORS.accentSoft,
  },
  locationNoticeTitle: { color: COLORS.ink, fontSize: 14, fontWeight: '700' },
  locationNoticeText: { color: COLORS.muted, fontSize: 12.5, lineHeight: 18, marginTop: 4 },
  locationActions: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 },
  retryLocationBtn: {
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: COLORS.accent,
  },
  retryLocationText: { color: COLORS.onAccent, fontSize: 12, fontWeight: '700' },
  settingsLocationBtn: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: COLORS.accent,
    backgroundColor: COLORS.card,
  },
  settingsLocationText: { color: COLORS.accent, fontSize: 12, fontWeight: '700' },
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
