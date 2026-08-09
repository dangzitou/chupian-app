import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { api } from '../api';
import { COLORS } from '../config';
import { APP_ROUTES } from '../constants/routes';
import PostCard from '../components/PostCard';
import FeedSkeleton from '../components/FeedSkeleton';
import { useFeedList } from '../hooks/useFeedList';
import { usePostListActions } from '../hooks/usePostListActions';
import { sharePost } from '../utils/share';
import { getActorName, isAuthenticated } from '../lib/actor';

const PAGE_SIZE = 8;

const PROFILE_TABS = [
  { key: 'mePosts', label: '我的发布' },
  { key: 'meLikes', label: '我赞过' },
  { key: 'meFavorites', label: '我的收藏' },
  { key: 'meFollowing', label: '关注动态' },
];

function ProfileStats({ spotCount, posts, liked, saved, onSelectSection, onOpenMap }) {
  const items = [
    { key: 'mePosts', value: posts, label: '发布', onPress: () => onSelectSection?.('mePosts') },
    { key: 'spots', value: spotCount, label: '点位', onPress: onOpenMap },
    { key: 'meLikes', value: liked, label: '赞过', onPress: () => onSelectSection?.('meLikes') },
    { key: 'meFavorites', value: saved, label: '收藏', onPress: () => onSelectSection?.('meFavorites') },
  ];

  return (
    <View style={styles.statsRow}>
      {items.map((item) => (
        <Pressable
          key={item.key}
          style={styles.statCard}
          onPress={item.onPress}
          disabled={!item.onPress}
          accessibilityRole="button"
          accessibilityLabel={`${item.label}${item.value}个`}
        >
          <Text style={styles.statNum}>
            {typeof item.value === 'number' ? item.value : '—'}
          </Text>
          <Text style={styles.statLabel}>{item.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function CreatorRewardCard({ reward, onOpenCreate }) {
  const points = Number(reward?.points || 0);
  const publishedCount = Number(reward?.publishedCount || 0);
  const guideCount = Number(reward?.guideCount || 0);
  const nextGuidePoints = Number(reward?.nextGuidePoints || 15);
  const guideRewardText = guideCount > 0
    ? `已完成 ${guideCount} 篇攻略 · 下一篇完整攻略再得 +${nextGuidePoints}`
    : `发布第一篇即可得 +5 · 完整攻略再得 +${nextGuidePoints}`;
  return (
    <View style={styles.rewardCard}>
      <View style={styles.rewardCopy}>
        <Text style={styles.rewardTitle}>贡献值 {points}</Text>
        <Text style={styles.rewardMeta}>已发布 {publishedCount} 条 · 完整攻略 {guideCount} 条</Text>
        <Text style={styles.rewardNext}>{guideRewardText}</Text>
      </View>
      <Pressable style={styles.rewardAction} onPress={onOpenCreate} accessibilityRole="button">
        <Text style={styles.rewardActionText}>继续发布</Text>
      </Pressable>
    </View>
  );
}

export default function ProfileScreen({ navigation }) {
  const [actorName, setActorName] = useState(() => getActorName());
  const [authenticated, setAuthenticated] = useState(() => isAuthenticated());
  const [weather, setWeather] = useState(null);
  const [loadingMeta, setLoadingMeta] = useState(true);
  const [statsError, setStatsError] = useState(null);
  const [spotCount, setSpotCount] = useState(0);
  const [section, setSection] = useState('mePosts');
  const [weatherOpen, setWeatherOpen] = useState(false);
  const [deletingPostId, setDeletingPostId] = useState('');
  const [notificationUnread, setNotificationUnread] = useState(0);
  const [creatorReward, setCreatorReward] = useState({ points: 0, publishedCount: 0, guideCount: 0, nextGuidePoints: 15 });

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
    meLikes: null,
    meFavorites: null,
    meFollowing: null,
  });

  const loadSectionMetrics = useCallback(async () => {
    try {
      const [w, userPostsFeed, s, notificationPayload, rewardPayload] = await Promise.all([
        api.weather(),
        api.mePosts({ limit: 1, sort: 'latest' }),
        api.spots(),
        api.notifications({ limit: 1 }),
        api.rewards().catch(() => ({
          points: 0,
          publishedCount: 0,
          guideCount: 0,
          nextGuidePoints: 15,
        })),
      ]);

      setWeather(w);
      setTotalPosts(Number(userPostsFeed?.total || 0));
      setSpotCount((s.spots || []).length);
      setNotificationUnread(Number(notificationPayload?.unread || 0));
      setCreatorReward(rewardPayload);
      setMeSectionStats((prev) => ({
        ...prev,
        mePosts: Number(userPostsFeed?.total || userPostsFeed.posts?.length || 0),
      }));
      setStatsError(null);
    } catch (err) {
      setStatsError(err?.message || '个人数据加载失败');
    } finally {
      setLoadingMeta(false);
    }
  }, []);

  const ensureSectionMetric = useCallback(async (targetSection) => {
    if (typeof meSectionStats[targetSection] === 'number') return;
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
  }, [load, section]);

  useEffect(() => {
    ensureSectionMetric(section);
  }, [ensureSectionMetric, section]);

  const onSwitchSection = useCallback((key) => {
    if (key === section) return;
    setSection(key);
  }, [section]);

  const onOpenMap = useCallback(() => {
    const parent = navigation?.getParent?.();
    if (parent) {
      parent.navigate(APP_ROUTES.MAP);
      return;
    }
    navigation?.navigate?.(APP_ROUTES.MAP);
  }, [navigation]);

  const onOpenCreate = useCallback(() => {
    const parent = navigation?.getParent?.();
    if (parent) {
      parent.navigate(APP_ROUTES.CREATE);
      return;
    }
    navigation?.navigate?.(APP_ROUTES.CREATE);
  }, [navigation]);

  const onOpenNotifications = useCallback(() => {
    navigation.navigate('Notifications');
  }, [navigation]);

  const onOpenBlockedAuthors = useCallback(() => {
    navigation.navigate('BlockedAuthors');
  }, [navigation]);

  const onOpenEditProfile = useCallback(() => {
    navigation.navigate('EditProfile');
  }, [navigation]);

  useFocusEffect(useCallback(() => {
    setActorName(getActorName());
    setAuthenticated(isAuthenticated());
    api.notifications({ limit: 1 })
      .then((payload) => setNotificationUnread(Number(payload?.unread || 0)))
      .catch(() => {
        // Keep the last unread count when the message center is unavailable.
      });
  }, []));

  const onAuthAction = useCallback(() => {
    if (!authenticated) {
      navigation.navigate('Auth');
      return;
    }
    Alert.alert('退出登录？', '退出后仍可匿名浏览，账号作品不会被删除。', [
      { text: '取消', style: 'cancel' },
      {
        text: '退出',
        style: 'destructive',
        onPress: async () => {
          try {
            await api.logout();
            setActorName(getActorName());
            setAuthenticated(false);
            await load({ append: false, cursor: null });
            await loadSectionMetrics();
          } catch (err) {
            Alert.alert('退出失败', err?.message || '网络异常，请稍后重试');
          }
        },
      },
    ]);
  }, [authenticated, load, loadSectionMetrics, navigation]);

  const onDeletePost = useCallback((postId) => {
    const target = String(postId || '').trim();
    if (!target || deletingPostId) return;
    Alert.alert(
      '删除这条出片？',
      '作品会从公开内容和你的发布列表中移除，已上传素材不会被物理删除。',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '删除',
          style: 'destructive',
          onPress: async () => {
            setDeletingPostId(target);
            try {
              await api.archivePost(target);
              await load({ append: false, cursor: null });
            } catch (err) {
              Alert.alert('删除失败', err?.message || '网络异常，请稍后重试');
            } finally {
              setDeletingPostId('');
            }
          },
        },
      ],
    );
  }, [deletingPostId, load]);

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
      onAuthorPress={item.authorId
        ? () => navigation.navigate(APP_ROUTES.DISCOVERY, { screen: 'AuthorProfile', params: { authorId: item.authorId, authorName: item.author } })
        : undefined}
      onLike={() => onLike(item.id)}
      onFavorite={() => onFavorite(item.id)}
      onFollow={() => onFollow(item.id)}
      onComment={() => navigation.navigate(APP_ROUTES.DISCOVERY, { screen: 'PostDetail', params: { postId: item.id } })}
      onShare={() => onShare(item)}
      onManage={section === 'mePosts' ? () => onDeletePost(item.id) : undefined}
      likeBusy={isActionBusy(item.id, 'liked', 'liked')}
      favoriteBusy={isActionBusy(item.id, 'favorited', 'favorited')}
      followBusy={isActionBusy(item.id, 'followed', 'followed')}
      manageBusy={deletingPostId === String(item.id)}
      style={styles.profileCard}
    />
  ), [deletingPostId, isActionBusy, navigation, onDeletePost, onFavorite, onFollow, onLike, onShare, section]);

  const ListHeader = useMemo(() => (
    <View>
      <View style={styles.heroCard}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{actorName.slice(-2)}</Text>
        </View>
        <View style={styles.heroMeta}>
          <Text style={styles.name}>{actorName}</Text>
          <Text style={styles.bio}>记录机位、光线和器材</Text>
        </View>
        <View style={styles.heroActions}>
          <Pressable style={styles.notifyAction} onPress={onOpenNotifications} accessibilityRole="button">
            <Text style={styles.notifyText}>消息</Text>
            {notificationUnread > 0 ? (
              <View style={styles.notifyBadge}>
                <Text style={styles.notifyBadgeText}>{notificationUnread > 99 ? '99+' : notificationUnread}</Text>
              </View>
            ) : null}
          </Pressable>
          {authenticated ? (
            <Pressable style={styles.profileAction} onPress={onOpenEditProfile}>
              <Text style={styles.profileActionText}>编辑资料</Text>
            </Pressable>
          ) : null}
          <Pressable style={styles.profileAction} onPress={onAuthAction}>
            <Text style={styles.profileActionText}>{authenticated ? '退出' : '登录 / 注册'}</Text>
          </Pressable>
        </View>
      </View>

      <ProfileStats
        spotCount={spotCount}
        posts={totalPosts}
        liked={meSectionStats.meLikes}
        saved={meSectionStats.meFavorites}
        onSelectSection={onSwitchSection}
        onOpenMap={onOpenMap}
      />

      <CreatorRewardCard reward={creatorReward} onOpenCreate={onOpenCreate} />

      {weather?.ok && (
        <Pressable style={styles.weatherCard} onPress={() => setWeatherOpen((value) => !value)}>
          <View style={styles.weatherSummary}>
            <View>
              <Text style={styles.weatherTitle}>
                今日拍摄条件 · {weather.location || weather.city || '当前位置'}
              </Text>
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
                {`  (${typeof meSectionStats[tab.key] === 'number' ? meSectionStats[tab.key] : '—'})`}
              </Text>
            </Text>
            {section === tab.key ? <View style={styles.tabUnderline} /> : null}
          </Pressable>
        ))}
      </ScrollView>
      <Pressable style={styles.blockedManage} onPress={onOpenBlockedAuthors} accessibilityRole="button">
        <Text style={styles.blockedManageText}>屏蔽管理</Text>
        <Text style={styles.blockedManageHint}>管理不想再看到的创作者</Text>
      </Pressable>
    </View>
  ), [actorName, authenticated, creatorReward, meSectionStats, notificationUnread, onAuthAction, onOpenBlockedAuthors, onOpenCreate, onOpenEditProfile, onOpenMap, onOpenNotifications, onSwitchSection, section, spotCount, totalPosts, weather, weatherOpen]);

  const ListFooter = useMemo(() => {
    if (!hasMore || !loadingMore) return null;
    return <View style={styles.footer}><ActivityIndicator size="small" color={COLORS.accent} /></View>;
  }, [hasMore, loadingMore]);

  const empty = !loading && !posts.length ? (
    <View style={styles.emptyWrap}>
      {!!error ? <Text style={styles.error}>加载失败：{error}</Text> : null}
      <Text style={styles.emptyText}>
        {section === 'mePosts' ? '还没有可展示的出片' : '这里还没有内容'}
      </Text>
      <Pressable
        style={styles.retryBtn}
        onPress={section === 'mePosts' ? onOpenCreate : () => load({ append: false, cursor: null })}
      >
        <Text style={styles.retryText}>{section === 'mePosts' ? '去发布第一张' : '重新加载'}</Text>
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
  blockedManage: {
    marginHorizontal: 6,
    marginTop: 4,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  blockedManageText: { color: COLORS.text, fontSize: 14, fontWeight: '700' },
  blockedManageHint: { color: COLORS.muted, fontSize: 12 },
  list: { paddingBottom: 40, paddingHorizontal: 6 },
  heroCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'transparent',
    borderRadius: 16,
    paddingHorizontal: 8,
    paddingVertical: 12,
    borderWidth: 0,
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
  heroActions: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  notifyAction: { position: 'relative', paddingHorizontal: 8, paddingVertical: 5 },
  notifyText: { color: COLORS.ink, fontSize: 11.5, fontWeight: '700' },
  notifyBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 3,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.accent,
  },
  notifyBadgeText: { color: COLORS.white, fontSize: 9, fontWeight: '800' },
  profileAction: {
    borderWidth: 0,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  profileActionText: { color: COLORS.muted, fontSize: 11.5, fontWeight: '700' },
  name: { fontSize: 20, color: COLORS.ink, fontWeight: '700' },
  bio: { color: COLORS.muted, marginTop: 3, fontSize: 12.8 },
  statsRow: {
    flexDirection: 'row',
    marginTop: 2,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: COLORS.line,
  },
  rewardCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
    borderRadius: 12,
    backgroundColor: COLORS.accentBg,
  },
  rewardCopy: { flex: 1 },
  rewardTitle: { color: COLORS.accent, fontSize: 14, fontWeight: '800' },
  rewardMeta: { color: COLORS.ink, fontSize: 11.5, marginTop: 3 },
  rewardNext: { color: COLORS.muted, fontSize: 11, marginTop: 3, lineHeight: 16 },
  rewardAction: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 7,
    backgroundColor: COLORS.accent,
  },
  rewardActionText: { color: COLORS.onAccent, fontSize: 11.5, fontWeight: '700' },
  statCard: {
    flex: 1,
    alignItems: 'center',
  },
  statNum: { color: COLORS.ink, fontSize: 18, fontWeight: '700' },
  statLabel: { color: COLORS.muted, marginTop: 3, fontSize: 11.8 },
  weatherCard: {
    backgroundColor: COLORS.accentSoft,
    borderRadius: 10,
    marginTop: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
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

  menuCard: { marginTop: 8, maxHeight: 46 },
  menuRow: { gap: 6, paddingBottom: 3 },
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
