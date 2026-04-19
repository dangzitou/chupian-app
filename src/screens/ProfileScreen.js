import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../api';
import { COLORS } from '../config';
import { APP_ROUTES } from '../constants/routes';
import PostCard from '../components/PostCard';
import FeedSkeleton from '../components/FeedSkeleton';
import { useFeedList } from '../hooks/useFeedList';
import { usePostListActions } from '../hooks/usePostListActions';
import { sharePost, shareText } from '../utils/share';
import { getActorName } from '../lib/actor';

const PAGE_SIZE = 8;

const PROFILE_TABS = [
  { key: 'mePosts', label: '我的发布' },
  { key: 'meLikes', label: '我赞过' },
  { key: 'meFavorites', label: '我的收藏' },
  { key: 'meFollowing', label: '关注动态' },
];

function ProfileStats({ spotCount, posts, liked, saved }) {
  return (
    <View style={styles.statsRow}>
      <View style={styles.statCard}>
        <Text style={styles.statNum}>{posts}</Text>
        <Text style={styles.statLabel}>发布</Text>
      </View>
      <View style={styles.statCard}>
        <Text style={styles.statNum}>{spotCount}</Text>
        <Text style={styles.statLabel}>点位</Text>
      </View>
      <View style={styles.statCard}>
        <Text style={styles.statNum}>{liked}</Text>
        <Text style={styles.statLabel}>赞过</Text>
      </View>
      <View style={styles.statCard}>
        <Text style={styles.statNum}>{saved}</Text>
        <Text style={styles.statLabel}>收藏</Text>
      </View>
    </View>
  );
}

export default function ProfileScreen({ navigation }) {
  const actorName = useMemo(() => getActorName(), []);
  const [weather, setWeather] = useState(null);
  const [loadingMeta, setLoadingMeta] = useState(true);
  const [statsError, setStatsError] = useState(null);
  const [spotCount, setSpotCount] = useState(0);
  const [section, setSection] = useState('mePosts');
  const [weatherOpen, setWeatherOpen] = useState(false);

  const loadSectionPayload = useCallback((params) => {
    if (section === 'meLikes') return api.meLikes(params);
    if (section === 'meFavorites') return api.meFavorites(params);
    if (section === 'meFollowing') return api.meFollowing(params);
    return api.mePosts(params);
  }, [section]);

  const {
    posts,
    loading,
    refreshing,
    loadingMore,
    error,
    hasMore,
    load,
    onRefresh,
    onEndReached,
    patchById,
    setBusyForPost,
    isPostBusy,
  } = useFeedList(loadSectionPayload, { limit: PAGE_SIZE, sort: 'latest' });

  const getPostById = useCallback(
    (postId) => posts.find((item) => String(item.id) === String(postId)),
    [posts],
  );
  const {
    isBusy: isActionBusy,
    toggleAction,
  } = usePostListActions({
    getPostById,
    patchById,
    setBusyForPost,
    isBusyExternal: isPostBusy,
  });

  const [totalPosts, setTotalPosts] = useState(0);
  const [meSectionStats, setMeSectionStats] = useState({
    mePosts: 0,
    meLikes: 0,
    meFavorites: 0,
    meFollowing: 0,
  });

  const loadSectionMetrics = useCallback(async () => {
    try {
      const [w, userPostsFeed, userLikesFeed, userFavoritesFeed, userFollowingFeed, s] = await Promise.all([
        api.weather(),
        api.mePosts({ limit: 1, sort: 'latest' }),
        api.meLikes({ limit: 1, sort: 'latest' }),
        api.meFavorites({ limit: 1, sort: 'latest' }),
        api.meFollowing({ limit: 1, sort: 'latest' }),
        api.spots(),
      ]);

      setWeather(w);
      setTotalPosts(Number(userPostsFeed?.total || 0));
      setSpotCount((s.spots || []).length);
      setMeSectionStats((prev) => ({
        ...prev,
        mePosts: Number(userPostsFeed?.total || userPostsFeed.posts?.length || 0),
        meLikes: Number(userLikesFeed?.total || userLikesFeed.posts?.length || 0),
        meFavorites: Number(userFavoritesFeed?.total || userFavoritesFeed.posts?.length || 0),
        meFollowing: Number(userFollowingFeed?.total || userFollowingFeed.posts?.length || 0),
      }));
      setStatsError(null);
    } catch (err) {
      setStatsError(err?.message || '个人数据加载失败');
    } finally {
      setLoadingMeta(false);
    }
  }, []);

  const ensureSectionMetric = useCallback(async (targetSection) => {
    if (meSectionStats[targetSection] > 0) return;
    try {
      const payload = await (targetSection === 'meLikes'
        ? api.meLikes({ limit: 1, sort: 'latest' })
        : targetSection === 'meFavorites'
          ? api.meFavorites({ limit: 1, sort: 'latest' })
          : targetSection === 'meFollowing'
            ? api.meFollowing({ limit: 1, sort: 'latest' })
            : api.mePosts({ limit: 1, sort: 'latest' }));
      setMeSectionStats((prev) => ({
        ...prev,
        [targetSection]: Number(payload.total || payload.posts?.length || 0),
      }));
    } catch (_err) {
      // keep stale count on error; section-specific metric is best-effort.
    }
  }, [meSectionStats]);

  useEffect(() => {
    loadSectionMetrics();
  }, [loadSectionMetrics]);

  useEffect(() => {
    load({ append: false });
    ensureSectionMetric(section);
  }, [load, section, ensureSectionMetric]);

  const onSwitchSection = useCallback((key) => {
    if (key === section) return;
    setSection(key);
  }, [section]);

  const onLike = useCallback((postId) => toggleAction({
    postId,
    metricField: 'likes',
    stateField: 'liked',
    actionResolver: async ({ post, next }) => api.toggleLike(post.id, undefined, next ? 'like' : 'unlike'),
  }), [api, toggleAction]);

  const onFavorite = useCallback((postId) => toggleAction({
    postId,
    metricField: 'favorites',
    stateField: 'favorited',
    actionResolver: async ({ post, next }) => api.toggleFavorite(post.id, undefined, next ? 'favorite' : 'unfavorite'),
  }), [api, toggleAction]);

  const onFollow = useCallback((postId) => toggleAction({
    postId,
    metricField: 'followers',
    stateField: 'followed',
    actionResolver: async ({ post, next }) => {
      const target = post.authorId || post.author;
      return api.toggleFollow(target, next ? 'follow' : 'unfollow');
    },
  }), [api, toggleAction]);

  const onShare = useCallback(async (item) => {
    if (!item) return;
    try {
      await sharePost(item);
    } catch (_err) {
      // share unsupported in current runtime, fail silently for list usage
    }
  }, []);

  const renderCard = useCallback(({ item }) => (
      <PostCard
        post={item}
      compact
      onPress={() => navigation.navigate(APP_ROUTES.DISCOVERY, { screen: 'PostDetail', params: { postId: item.id, title: item.title } })}
      onLike={() => onLike(item.id)}
      onFavorite={() => onFavorite(item.id)}
      onFollow={() => onFollow(item.id)}
      onComment={() => navigation.navigate(APP_ROUTES.DISCOVERY, { screen: 'PostDetail', params: { postId: item.id } })}
      onShare={() => onShare(item)}
      likeBusy={isActionBusy(item.id, 'liked', 'liked')}
      favoriteBusy={isActionBusy(item.id, 'favorited', 'favorited')}
      followBusy={isActionBusy(item.id, 'followed', 'followed')}
      style={styles.profileCard}
    />
  ), [isActionBusy, onFavorite, onFollow, onLike, onShare]);

  const ListHeader = useMemo(() => (
    <View>
      <View style={styles.heroCard}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{actorName.slice(-2)}</Text>
        </View>
        <View style={styles.heroMeta}>
          <Text style={styles.name}>{actorName}</Text>
          <Text style={styles.bio}>我的拍摄档案 · 机位收藏 · 出片记录</Text>
        </View>
        <Pressable style={styles.profileAction} onPress={() => shareText(`来看看${actorName}的出片档案`, actorName)}>
          <Text style={styles.profileActionText}>分享</Text>
        </Pressable>
      </View>

      <ProfileStats
        spotCount={spotCount}
        posts={totalPosts}
        liked={meSectionStats.meLikes}
        saved={meSectionStats.meFavorites}
      />

      {weather?.ok && (
        <Pressable style={styles.weatherCard} onPress={() => setWeatherOpen((value) => !value)}>
          <View style={styles.weatherSummary}>
            <View>
              <Text style={styles.weatherTitle}>今日拍摄条件 · 广州</Text>
              <Text style={styles.weatherMain}>
                {weather.label} {Math.round(weather.temp)}°C
              </Text>
            </View>
            <Text style={styles.weatherChevron}>{weatherOpen ? '−' : '+'}</Text>
          </View>
          {weatherOpen ? (
            <Text style={styles.weatherHint}>
              体感 {Math.round(weather.feelsLike)}° · 湿度 {weather.humidity}% · 风速 {weather.wind} km/h
            </Text>
          ) : null}
        </Pressable>
      )}

      <ScrollView
        style={styles.menuCard}
        contentContainerStyle={styles.menuRow}
        horizontal
        showsHorizontalScrollIndicator={false}
      >
        {PROFILE_TABS.map((tab) => (
          <Pressable
            key={tab.key}
            style={[styles.tabItem, section === tab.key && styles.tabItemActive]}
            onPress={() => onSwitchSection(tab.key)}
          >
            <Text style={[styles.tabLabel, section === tab.key && styles.tabLabelActive]}>
              {tab.label}
              <Text style={styles.tabCount}>
                {`  (${meSectionStats[tab.key] || 0})`}
              </Text>
            </Text>
            {section === tab.key ? <View style={styles.tabUnderline} /> : null}
          </Pressable>
        ))}
      </ScrollView>
    </View>
  ), [actorName, meSectionStats, onSwitchSection, section, spotCount, totalPosts, weather, weatherOpen]);

  const ListFooter = useMemo(() => {
    if (!hasMore || !loadingMore) return null;
    return <View style={styles.footer}><ActivityIndicator size="small" color={COLORS.accent} /></View>;
  }, [hasMore, loadingMore]);

  const empty = !loading && !posts.length ? (
    <View style={styles.emptyWrap}>
      {!!error ? <Text style={styles.error}>加载失败：{error}</Text> : null}
      <Text style={styles.emptyText}>
        该区域还没有内容
      </Text>
      <Pressable style={styles.retryBtn} onPress={() => load({ append: false, cursor: null })}>
        <Text style={styles.retryText}>去刷新</Text>
      </Pressable>
    </View>
  ) : null;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <FlatList
        data={posts}
        keyExtractor={(post) => String(post.id)}
        numColumns={2}
        columnWrapperStyle={styles.columnWrapper}
        onRefresh={onRefresh}
        refreshing={refreshing}
        onEndReached={onEndReached}
        onEndReachedThreshold={0.2}
        ListHeaderComponent={ListHeader}
        contentContainerStyle={styles.list}
        renderItem={renderCard}
        ListEmptyComponent={loading ? <FeedSkeleton count={4} /> : empty}
        ListFooterComponent={ListFooter}
      />
      {statsError ? <Text style={styles.warn}>{statsError}</Text> : null}
      {loadingMeta ? (
        <View style={styles.metaLoadingMask}>
          <ActivityIndicator color={COLORS.accent} />
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  list: { paddingBottom: 40, paddingHorizontal: 6 },
  heroCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.panel,
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: COLORS.line,
    gap: 12,
    marginBottom: 8,
    marginTop: 6,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: COLORS.bgDeep,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: COLORS.accent, fontSize: 18, fontWeight: '800' },
  heroMeta: { flex: 1 },
  profileAction: {
    borderWidth: 1,
    borderColor: COLORS.line,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  profileActionText: { color: COLORS.muted, fontSize: 11.5, fontWeight: '700' },
  name: { fontSize: 20, color: COLORS.ink, fontWeight: '700' },
  bio: { color: COLORS.muted, marginTop: 3, fontSize: 12.8 },
  statsRow: { flexDirection: 'row', gap: 8 },
  statCard: {
    flex: 1,
    backgroundColor: COLORS.panel,
    borderRadius: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: COLORS.line,
    alignItems: 'center',
  },
  statNum: { color: COLORS.accent, fontSize: 20, fontWeight: '700' },
  statLabel: { color: COLORS.muted, marginTop: 3, fontSize: 11.8 },
  weatherCard: {
    backgroundColor: COLORS.accentSoft,
    borderRadius: 14,
    marginTop: 10,
    padding: 14,
  },
  weatherSummary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  weatherTitle: { color: '#6d3112', fontWeight: '600', fontSize: 13 },
  weatherMain: { color: '#6d3112', marginTop: 4, fontWeight: '700', fontSize: 15 },
  weatherHint: { color: '#a16b44', marginTop: 4, fontSize: 11.5 },
  weatherChevron: { color: '#6d3112', fontSize: 24, fontWeight: '300', paddingHorizontal: 4 },

  menuCard: { marginTop: 12 },
  menuRow: { gap: 8, paddingBottom: 4 },
  tabItem: {
    paddingHorizontal: 10,
    paddingTop: 8,
    paddingBottom: 10,
    position: 'relative',
  },
  tabItemActive: { },
  tabLabel: { color: COLORS.muted, fontWeight: '600', fontSize: 12.6 },
  tabLabelActive: { color: COLORS.accent },
  tabCount: { color: COLORS.mutedText || COLORS.muted, fontSize: 11 },
  tabUnderline: {
    position: 'absolute',
    left: 10,
    right: 10,
    bottom: 3,
    height: 2,
    borderRadius: 2,
    backgroundColor: COLORS.accent,
  },
  columnWrapper: { gap: 8 },
  profileCard: {
    flex: 1,
    marginBottom: 8,
  },
  error: { color: '#a34a2a', fontSize: 12.5, textAlign: 'center', marginTop: 10 },
  emptyWrap: { alignItems: 'center', marginTop: 24 },
  emptyText: { color: COLORS.muted, marginTop: 8, fontSize: 13 },
  retryBtn: {
    marginTop: 12,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: COLORS.panel,
  },
  retryText: { color: COLORS.accent, fontWeight: '700', fontSize: 12.5 },
  footer: { alignItems: 'center', paddingVertical: 12 },
  warn: { color: '#b97c2a', textAlign: 'center', marginTop: 8, marginBottom: 2, fontSize: 11 },
  metaLoadingMask: {
    position: 'absolute',
    right: 12,
    top: 12,
  },
});
