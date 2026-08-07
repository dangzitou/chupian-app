import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Image, ActivityIndicator, Pressable, Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../api';
import { API_BASE, COLORS } from '../config';

export default function ProfileScreen() {
  const [weather, setWeather] = useState(null);
  const [stats, setStats] = useState({ posts: 0, authors: 0, totalLikes: 0 });
  const [spotCount, setSpotCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [w, p, s] = await Promise.all([api.weather(), api.posts(), api.spots()]);
        setWeather(w);
        setStats({ posts: p.total || 0, authors: p.stats?.authors || 0, totalLikes: p.stats?.totalLikes || 0 });
        setSpotCount((s.spots || []).length);
      } catch (e) { /* ignore */ } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.profileCard}>
          <Image
            source={{ uri: 'https://picsum.photos/seed/chupian-avatar/200/200' }}
            style={styles.avatar}
          />
          <Text style={styles.name}>出片地图</Text>
          <Text style={styles.bio}>广州拍照机位 · 博主攻略 · 社区正循环</Text>
        </View>

        <View style={styles.statsRow}>
          <View style={styles.statBox}><Text style={styles.statNum}>{spotCount}</Text><Text style={styles.statLabel}>点位</Text></View>
          <View style={styles.statBox}><Text style={styles.statNum}>{stats.posts}</Text><Text style={styles.statLabel}>攻略</Text></View>
          <View style={styles.statBox}><Text style={styles.statNum}>{stats.authors}</Text><Text style={styles.statLabel}>博主</Text></View>
          <View style={styles.statBox}><Text style={styles.statNum}>{stats.totalLikes}</Text><Text style={styles.statLabel}>点赞</Text></View>
        </View>

        {weather?.ok && (
          <View style={styles.weatherCard}>
            <Text style={styles.weatherTitle}>☀️ 广州天气</Text>
            <Text style={styles.weatherMain}>
              {weather.label} {Math.round(weather.temp)}°C（体感 {Math.round(weather.feelsLike)}°）
            </Text>
            <Text style={styles.weatherHint}>湿度 {weather.humidity}% · 风速 {weather.wind} km/h</Text>
          </View>
        )}

        <View style={styles.menuCard}>
          <Pressable
            style={styles.menuItem}
            onPress={() => {
              const target = `${API_BASE.replace(/\/?$/, '')}/`;
              Linking.openURL(target);
            }}
          >
            <Text style={styles.menuText}>🌐 网页版（完整功能）</Text>
          </Pressable>
          <Pressable style={styles.menuItem} onPress={() => Linking.openURL('https://www.openstreetmap.org/copyright')}>
            <Text style={styles.menuText}>🗺️ 地图数据 © OpenStreetMap</Text>
          </Pressable>
        </View>

        <Text style={styles.version}>出片地图 App v0.1 · React Native / Expo</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  body: { padding: 16, paddingBottom: 50 },
  profileCard: { alignItems: 'center', paddingVertical: 20 },
  avatar: { width: 84, height: 84, borderRadius: 42, backgroundColor: COLORS.bgDeep },
  name: { fontSize: 20, fontWeight: '700', color: COLORS.ink, marginTop: 10 },
  bio: { fontSize: 13, color: COLORS.muted, marginTop: 4 },
  statsRow: { flexDirection: 'row', gap: 10, marginTop: 8 },
  statBox: {
    flex: 1, backgroundColor: COLORS.panel, borderRadius: 14, paddingVertical: 14,
    alignItems: 'center', borderWidth: 1, borderColor: COLORS.line,
  },
  statNum: { fontSize: 20, fontWeight: '700', color: COLORS.accent },
  statLabel: { fontSize: 12, color: COLORS.muted, marginTop: 2 },
  weatherCard: {
    backgroundColor: COLORS.accentSoft, borderRadius: 14, padding: 14, marginTop: 14,
  },
  weatherTitle: { fontSize: 13, fontWeight: '600', color: '#6d3112' },
  weatherMain: { fontSize: 15, fontWeight: '700', color: '#6d3112', marginTop: 4 },
  weatherHint: { fontSize: 12, color: '#8a5a3a', marginTop: 3 },
  menuCard: {
    backgroundColor: COLORS.panel, borderRadius: 14, marginTop: 14,
    borderWidth: 1, borderColor: COLORS.line, overflow: 'hidden',
  },
  menuItem: { padding: 14, borderBottomWidth: 1, borderBottomColor: COLORS.line },
  menuText: { fontSize: 14, color: COLORS.ink },
  version: { textAlign: 'center', color: COLORS.muted, fontSize: 11.5, marginTop: 24 },
});
