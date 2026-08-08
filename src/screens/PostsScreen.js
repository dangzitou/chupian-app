import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
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
import PostCard from '../components/PostCard';
import FeedSkeleton from '../components/FeedSkeleton';
import { useFeedList } from '../hooks/useFeedList';
import { usePostListActions } from '../hooks/usePostListActions';
import { APP_ROUTES } from '../constants/routes';
import { sharePost } from '../utils/share';

const PAGE_SIZE = 12;
const SORT_OPTIONS = [
  { key: 'latest', label: '最新' },
  { key: 'hot', label: '热门' },
];
const FEED_OPTIONS = [
  { key: 'recommend', label: '推荐' },
  { key: 'following', label: '关注' },
];
const LAYOUT_OPTIONS = [
  { key: 'masonry', label: '网格' },
  { key: 'list', label: '列表' },
];

function SearchBar({ value, onSubmit, onChange }) {
  return (
    <View style={styles.searchWrap}>
      <View style={styles.searchInner}>
        <Text style={styles.searchIcon}>🔍</Text>
        <TextInput
          style={styles.searchInput}
          placeholder="搜索标题 / 地点 / 标签"
          placeholderTextColor={COLORS.muted}
          value={value}
          onChangeText={onChange}
          returnKeyType="search"
          blurOnSubmit={false}
          onSubmitEditing={onSubmit}
          clearButtonMode="while-editing"
        />
      </View>
    </View>
  );
}

function SortTabs({ value, onChange }) {
  return (
    <View style={styles.tabs}>
      {SORT_OPTIONS.map((item) => {
        const active = value === item.key;
        return (
          <Pressable
            key={item.key}
            style={[styles.tab, active && styles.tabActive]}
            onPress={() => onChange(item.key)}
            android_ripple={{ color: '#f5d7de' }}
          >
            <Text style={[styles.tabText, active && styles.tabTextActive]}>{item.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function FeedTabs({ value, onChange }) {
  return (
    <View style={styles.feedTabs}>
      {FEED_OPTIONS.map((item) => {
        const active = value === item.key;
        return (
          <Pressable key={item.key} style={styles.feedTab} onPress={() => onChange(item.key)}>
            <Text style={[styles.feedTabText, active && styles.feedTabTextActive]}>{item.label}</Text>
            {active ? <View style={styles.feedTabUnderline} /> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

function SignalStrip({ items, activeTag, onSelect, loading }) {
  if (!items.length) {
    if (loading) {
      return (
        <View style={styles.signalWrap}>
          <ActivityIndicator size="small" color={COLORS.accent} />
        </View>
      );
    }
    return null;
  }

  return (
    <View style={styles.signalOuterWrap}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.signalWrap}
      >
        <Pressable
          style={[styles.signalPill, !activeTag && styles.signalPillActive]}
          onPress={() => onSelect('')}
        >
          <Text style={[styles.signalText, !activeTag && styles.signalTextActive]}>全部</Text>
        </Pressable>
        {items.slice(0, 16).map((signal) => {
          const key = `${signal.type}-${signal.name}`;
          const active = activeTag === signal.name;
          return (
            <Pressable
              key={key}
              style={[styles.signalPill, active && styles.signalPillActive]}
              onPress={() => onSelect(signal.name)}
            >
              <Text style={[styles.signalText, active && styles.signalTextActive]}>
                #{signal.name} {signal.count ? `· ${signal.count}` : ''}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

export default function PostsScreen({ navigation }) {
  const [feedLayout, setFeedLayout] = useState('masonry');
  const [feedMode, setFeedMode] = useState('recommend');
  const [searchInput, setSearchInput] = useState('');
  const [activeTag, setActiveTag] = useState('');
  const [signals, setSignals] = useState([]);
  const [signalsLoading, setSignalsLoading] = useState(false);
  const [signalsError, setSignalsError] = useState(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const bootstrappedRef = useRef(false);
  const feedModeRef = useRef('');

  const feedFetcher = useCallback(
    (params) => (feedMode === 'following' ? api.meFollowing(params) : api.feed(params)),
    [feedMode],
  );

  const {
    posts,
    loading,
    refreshing,
    loadingMore,
    error,
    nextCursor,
    hasMore,
    q,
    sort,
    load,
    onRefresh,
    onEndReached,
    patchById,
    setSort,
    setQ,
    setTag,
    setBusyForPost,
    isPostBusy,
  } = useFeedList(feedFetcher, { limit: PAGE_SIZE, sort: 'latest' });

  const switchFeedMode = useCallback((nextMode) => {
    if (nextMode === feedMode) return;
    setFeedMode(nextMode);
    setActiveTag('');
    setSearchInput('');
    setQ('');
    setTag('');
    setSort('latest');
  }, [feedMode, setQ, setSort, setTag]);

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

  const loadDiscovery = useCallback(async () => {
    setSignalsLoading(true);
    setSignalsError(null);
    try {
      const payload = await api.discovery({ type: 'all', limit: 24 });
      setSignals(Array.isArray(payload.signals) ? payload.signals : []);
    } catch (err) {
      setSignalsError(err.message);
      setSignals([]);
    } finally {
      setSignalsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (feedModeRef.current === feedMode) return;
    feedModeRef.current = feedMode;
    if (!bootstrappedRef.current) {
      bootstrappedRef.current = true;
      loadDiscovery();
    }
    load({ append: false, cursor: null, nextSort: 'latest', nextQ: '', nextTag: '' });
  }, [feedMode]);

  const applyTagFilter = useCallback((nextTag) => {
    const tag = nextTag || '';
    const next = tag === activeTag ? '' : tag;
    if (next === activeTag) return;

    setActiveTag(next);
    setTag(next);
    load({
      append: false,
      cursor: null,
      nextSort: sort,
      nextQ: q,
      nextTag: next,
    });
  }, [activeTag, load, q, setTag, sort]);

  const applySearch = useCallback(() => {
    const next = searchInput.trim();
    if (next === q) return;

    setQ(next);
    load({
      append: false,
      cursor: null,
      nextSort: sort,
      nextQ: next,
      nextTag: activeTag,
    });
  }, [activeTag, load, q, searchInput, setQ, sort]);

  const applySort = useCallback((nextSort) => {
    if (nextSort === sort) return;
    setSort(nextSort);
    load({
      append: false,
      cursor: null,
      nextSort,
      nextQ: q,
      nextTag: activeTag,
    });
  }, [activeTag, load, q, sort, setSort]);

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

  const isMasonry = feedLayout === 'masonry';
  const renderCard = useCallback(({ item }) => (
    <PostCard
      post={item}
      compact={isMasonry}
      showFollow={!isMasonry}
      onPress={() => navigation.navigate('PostDetail', { postId: item.id, title: item.title })}
      onAuthorPress={item.authorId
        ? () => navigation.navigate('AuthorProfile', { authorId: item.authorId, authorName: item.author })
        : undefined}
      onLike={() => onLike(item.id)}
      onFavorite={() => onFavorite(item.id)}
      onFollow={() => onFollow(item.id)}
      onComment={() => navigation.navigate('PostDetail', { postId: item.id })}
      onShare={() => onShare(item)}
      likeBusy={isActionBusy(item.id, 'liked', 'liked')}
      favoriteBusy={isActionBusy(item.id, 'favorited', 'favorited')}
      followBusy={isActionBusy(item.id, 'followed', 'followed')}
      style={isMasonry ? styles.gridCard : styles.listCard}
    />
  ), [isActionBusy, isMasonry, navigation, onFollow, onFavorite, onLike, onShare]);

  const ListHeader = useMemo(() => (
    <View style={styles.headerSection}>
      <View style={styles.headerTop}>
        <View>
          <Text style={styles.title}>发现</Text>
        </View>
        <View style={styles.headerActions}>
          <Pressable
            style={styles.layoutBtn}
            onPress={() => setFeedLayout((prev) => (prev === 'masonry' ? 'list' : 'masonry'))}
          >
            <Text style={styles.layoutBtnText}>
              {feedLayout === 'masonry' ? '☷ 列表' : '▦ 网格'}
            </Text>
          </Pressable>
          <Pressable
            style={[styles.layoutBtn, filtersOpen && styles.layoutBtnActive]}
            onPress={() => setFiltersOpen((value) => !value)}
            accessibilityRole="button"
            accessibilityState={{ expanded: filtersOpen }}
          >
            <Text style={[styles.layoutBtnText, filtersOpen && styles.layoutBtnTextActive]}>
              {filtersOpen ? '收起筛选' : '筛选'}
            </Text>
          </Pressable>
        </View>
      </View>
      <FeedTabs value={feedMode} onChange={switchFeedMode} />
      <SearchBar value={searchInput} onChange={setSearchInput} onSubmit={applySearch} />
      {filtersOpen ? (
        <>
          <SortTabs value={sort} onChange={applySort} />
          <SignalStrip
            items={signals}
            activeTag={activeTag}
            onSelect={applyTagFilter}
            loading={signalsLoading}
          />
          {!!signalsError ? <Text style={styles.signalError}>发现推荐加载失败：{signalsError}</Text> : null}
        </>
      ) : null}
    </View>
  ), [activeTag, applySearch, applySort, applyTagFilter, feedMode, feedLayout, filtersOpen, isMasonry, searchInput, signals, signalsError, signalsLoading, sort, switchFeedMode]);

  const ListFooter = useMemo(() => {
    if (!hasMore || !loadingMore) return null;
    return <View style={styles.footer}><ActivityIndicator color={COLORS.accent} /></View>;
  }, [hasMore, loadingMore]);

  const showSkeleton = loading && !refreshing && posts.length === 0;
  const showEmpty = !loading && !loadingMore && !posts.length;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <FlatList
        key={isMasonry ? 'feed-masonry' : 'feed-list'}
        data={posts}
        keyExtractor={(post) => String(post.id)}
        numColumns={isMasonry ? 2 : 1}
        columnWrapperStyle={isMasonry ? styles.columnWrapper : undefined}
        refreshing={refreshing}
        onRefresh={onRefresh}
        onEndReached={onEndReached}
        onEndReachedThreshold={0.2}
        ListHeaderComponent={ListHeader}
        contentContainerStyle={[styles.list, isMasonry ? styles.listMasonry : styles.listList]}
        renderItem={renderCard}
        ListEmptyComponent={
          showSkeleton ? <FeedSkeleton count={5} /> : (
            <View style={styles.emptyWrap}>
              {!!error ? <Text style={styles.error}>加载失败：{error}</Text> : null}
              {showEmpty ? <Text style={styles.empty}>还没有匹配作品，调整关键词或标签试试</Text> : null}
              {showEmpty && !error ? (
                <Pressable style={styles.retryBtn} onPress={() => load({ append: false })}>
                  <Text style={styles.retryText}>刷新</Text>
                </Pressable>
              ) : null}
            </View>
          )
        }
        ListFooterComponent={ListFooter}
        ListHeaderComponentStyle={styles.headerWrap}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  list: { paddingBottom: 34 },
  listList: { paddingHorizontal: 8 },
  listMasonry: { paddingHorizontal: 4 },
  headerWrap: { paddingBottom: 8 },
  headerSection: {
    paddingTop: 2,
    paddingHorizontal: 2,
    marginBottom: 4,
    backgroundColor: COLORS.bg,
    paddingBottom: 6,
  },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingVertical: 8,
  },
  title: { fontSize: 22, color: COLORS.ink, fontWeight: '700', letterSpacing: -0.3 },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  layoutBtn: {
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    borderRadius: 999,
    backgroundColor: COLORS.card,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  layoutBtnText: {
    color: COLORS.ink,
    fontSize: 11.8,
  },
  layoutBtnActive: {
    borderColor: COLORS.accent,
    backgroundColor: COLORS.accentBg,
  },
  layoutBtnTextActive: {
    color: COLORS.accent,
    fontWeight: '700',
  },
  layoutChips: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
    marginBottom: 8,
    paddingHorizontal: 6,
  },
  layoutChip: {
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: COLORS.panel,
  },
  layoutChipActive: {
    borderColor: COLORS.accent,
    backgroundColor: COLORS.accentBg,
  },
  layoutChipText: {
    color: COLORS.muted,
    fontSize: 11.5,
  },
  layoutChipTextActive: {
    color: COLORS.accent,
    fontWeight: '700',
  },
  layoutHint: {
    marginHorizontal: 12,
    marginTop: 4,
    marginBottom: 6,
    color: COLORS.muted,
    fontSize: 11.4,
  },

  searchWrap: {
    marginHorizontal: 4,
    marginTop: 4,
    backgroundColor: COLORS.panel,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  searchInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  searchIcon: { color: COLORS.muted, fontSize: 14 },
  searchInput: {
    flex: 1,
    height: 34,
    color: COLORS.ink,
    fontSize: 13.5,
  },

  feedTabs: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 20,
    marginHorizontal: 8,
    marginTop: 4,
    marginBottom: 2,
  },
  feedTab: {
    minWidth: 42,
    alignItems: 'center',
    paddingVertical: 6,
    position: 'relative',
  },
  feedTabText: {
    color: COLORS.muted,
    fontSize: 15,
    fontWeight: '600',
  },
  feedTabTextActive: {
    color: COLORS.ink,
    fontWeight: '800',
  },
  feedTabUnderline: {
    position: 'absolute',
    bottom: 0,
    width: 20,
    height: 3,
    borderRadius: 99,
    backgroundColor: COLORS.accent,
  },
  tabs: {
    flexDirection: 'row',
    gap: 8,
    marginHorizontal: 6,
    marginTop: 10,
    marginBottom: 8,
  },
  tab: {
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
    backgroundColor: COLORS.card,
  },
  tabActive: {
    borderColor: COLORS.accent,
    backgroundColor: COLORS.accentBg,
  },
  tabText: { color: COLORS.muted, fontSize: 12.5, fontWeight: '600' },
  tabTextActive: { color: COLORS.accent },

  signalOuterWrap: { marginTop: 2 },
  signalWrap: {
    gap: 8,
    paddingHorizontal: 6,
    paddingRight: 12,
    paddingBottom: 8,
  },
  signalPill: {
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: COLORS.panel,
  },
  signalPillActive: {
    backgroundColor: COLORS.accentBg,
    borderColor: COLORS.accent,
  },
  signalText: { color: COLORS.muted, fontSize: 11.5, fontWeight: '600' },
  signalTextActive: { color: COLORS.accent },
  signalError: {
    color: '#b15e2b',
    marginHorizontal: 12,
    fontSize: 11.5,
    marginBottom: 4,
  },

  error: { color: '#a34a2a', marginBottom: 6 },
  emptyWrap: {
    paddingTop: 76,
    alignItems: 'center',
    paddingBottom: 80,
  },
  empty: {
    textAlign: 'center',
    color: COLORS.muted,
    fontSize: 14,
  },
  retryBtn: {
    marginTop: 12,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 14,
    backgroundColor: COLORS.card,
  },
  retryText: { color: COLORS.accent, fontWeight: '700', fontSize: 12.5 },
  footer: {
    alignItems: 'center',
    paddingBottom: 12,
    paddingTop: 8,
  },
  columnWrapper: {
    justifyContent: 'space-between',
  },
  gridCard: {
    flex: 0.495,
    marginBottom: 12,
    marginHorizontal: 4,
  },
  listCard: {
    marginBottom: 12,
    marginHorizontal: 6,
  },
});
