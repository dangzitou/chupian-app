import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useScrollToTop } from '@react-navigation/native';
import { api } from '../api';
import { COLORS } from '../config';
import PostCard from '../components/PostCard';
import FeedSkeleton from '../components/FeedSkeleton';
import { useFeedList } from '../hooks/useFeedList';
import { usePostListActions } from '../hooks/usePostListActions';
import { createDraftStorage } from '../hooks/useDraftStorage';
import { APP_ROUTES } from '../constants/routes';
import { sharePost } from '../utils/share';
import { isAuthenticated } from '../lib/actor';

const PAGE_SIZE = 12;
const SEARCH_HISTORY_STORAGE_KEY = 'chupian-search-history';
const searchHistoryStorage = createDraftStorage(SEARCH_HISTORY_STORAGE_KEY);

function estimateMasonryHeight(post) {
  const media = Array.isArray(post?.media) ? post.media[0] : null;
  const width = Number(media?.width);
  const height = Number(media?.height);
  const ratio = Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0
    ? Math.min(Math.max(width / height, 0.75), 1.78)
    : 1.6;
  const contentLength = String(post?.content || '').trim().length;
  const titleLength = String(post?.title || '').trim().length;
  return 190 / ratio + 92 + Math.min(70, contentLength / 3.5) + Math.min(28, titleLength / 2);
}

function splitMasonryColumns(posts) {
  const columns = [[], []];
  const heights = [0, 0];
  for (const item of posts) {
    const columnIndex = heights[0] <= heights[1] ? 0 : 1;
    columns[columnIndex].push(item);
    heights[columnIndex] += estimateMasonryHeight(item);
  }
  return columns;
}
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

function SearchGlyph() {
  return (
    <View style={styles.searchGlyph} accessible accessibilityLabel="搜索">
      <View style={styles.searchLens} />
      <View style={styles.searchHandle} />
    </View>
  );
}

function SearchBar({ value, onSubmit, onChange, onFocus, onBlur }) {
  return (
    <View style={styles.searchWrap}>
      <View style={styles.searchInner}>
        <SearchGlyph />
        <TextInput
          style={styles.searchInput}
          placeholder="搜索标题 / 地点 / 标签"
          placeholderTextColor={COLORS.muted}
          value={value}
          onChangeText={onChange}
          returnKeyType="search"
          blurOnSubmit={false}
          onSubmitEditing={() => onSubmit?.()}
          onFocus={onFocus}
          onBlur={onBlur}
          clearButtonMode="while-editing"
        />
      </View>
    </View>
  );
}

function SearchHistoryStrip({ items, onSelect, onClear }) {
  if (!items.length) return null;
  return (
    <View style={styles.searchHistory}>
      <View style={styles.searchHistoryHeader}>
        <Text style={styles.searchHistoryTitle}>最近搜索</Text>
        <Pressable onPress={onClear} accessibilityRole="button" accessibilityLabel="清空搜索记录">
          <Text style={styles.searchHistoryClear}>清空</Text>
        </Pressable>
      </View>
      <View style={styles.searchHistoryItems}>
        {items.map((item) => (
          <Pressable
            key={item}
            style={styles.searchHistoryChip}
            onPress={() => onSelect(item)}
            accessibilityRole="button"
            accessibilityLabel={`搜索 ${item}`}
          >
            <Text style={styles.searchHistoryChipText} numberOfLines={1}>{item}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function normalizeSearchHistory(value) {
  const source = Array.isArray(value) ? value : value?.queries;
  if (!Array.isArray(source)) return [];
  return [...new Set(source
    .map((item) => String(item || '').trim())
    .filter(Boolean))].slice(0, 8);
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
  const [locationLabel, setLocationLabel] = useState('');
  const [locationLoading, setLocationLoading] = useState(true);
  const [searchInput, setSearchInput] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const [searchHistory, setSearchHistory] = useState([]);
  const [activeTag, setActiveTag] = useState('');
  const [signals, setSignals] = useState([]);
  const [signalsLoading, setSignalsLoading] = useState(false);
  const [signalsError, setSignalsError] = useState(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [actionError, setActionError] = useState('');
  const [actionNotice, setActionNotice] = useState('');
  const bootstrappedRef = useRef(false);
  const feedModeRef = useRef('');
  const firstFocusRef = useRef(true);
  const refreshOnFocusRef = useRef(null);
  const feedListRef = useRef(null);

  useScrollToTop(feedListRef);

  const feedFetcher = useCallback(
    (params) => {
      if (feedMode === 'following') return api.meFollowing(params);
      return api.feed(
        feedMode === 'recommend' && params.sort === 'latest'
          ? { ...params, sort: 'recommend' }
          : params,
      );
    },
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
    clearFeed,
    setSort,
    setQ,
    setTag,
    setBusyForPost,
    isPostBusy,
  } = useFeedList(feedFetcher, {
    limit: PAGE_SIZE,
    sort: 'latest',
    cacheKey: `discovery:${feedMode}`,
  });

  refreshOnFocusRef.current = () => {
    load({
      append: false,
      cursor: null,
      nextSort: sort,
      nextQ: q,
      nextTag: activeTag,
    });
  };

  useFocusEffect(useCallback(() => {
    if (!firstFocusRef.current) refreshOnFocusRef.current?.();
    firstFocusRef.current = false;
  }, []));

  const openAuth = useCallback(() => {
    const parent = navigation?.getParent?.();
    if (parent?.navigate) {
      parent.navigate(APP_ROUTES.PROFILE, { screen: 'Auth' });
      return;
    }
    navigation?.navigate?.(APP_ROUTES.PROFILE, { screen: 'Auth' });
  }, [navigation]);

  const switchFeedMode = useCallback((nextMode) => {
    if (nextMode === feedMode) return;
    if (nextMode === 'following' && !isAuthenticated()) {
      Alert.alert(
        '登录后查看关注动态',
        '登录后可以持续看到已关注拍友的最新出片，也能跨设备保留你的互动记录。',
        [
          { text: '先看看推荐', style: 'cancel' },
          { text: '去登录', onPress: openAuth },
        ],
      );
      return;
    }
    clearFeed();
    setFeedMode(nextMode);
    setActiveTag('');
    setSearchInput('');
    setQ('');
    setTag('');
    setSort('latest');
  }, [clearFeed, feedMode, openAuth, setQ, setSort, setTag]);

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
    onError: () => setActionError('网络不稳定，操作未完成，请重试'),
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
    let alive = true;
    setLocationLoading(true);
    api.resolveLocation()
      .then((payload) => {
        if (!alive) return;
        const label = String(payload?.location?.label || '').trim();
        setLocationLabel(label);
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

  useEffect(() => {
    let alive = true;
    searchHistoryStorage.read()
      .then((payload) => {
        if (alive) setSearchHistory(normalizeSearchHistory(payload));
      })
      .catch(() => {
        // Search history is optional and must never block feed loading.
      });
    return () => {
      alive = false;
    };
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

  const applySearch = useCallback((input = searchInput) => {
    const next = String(input || '').trim();
    setSearchFocused(false);
    if (next) {
      const nextHistory = [next, ...searchHistory.filter((item) => item !== next)].slice(0, 8);
      setSearchHistory(nextHistory);
      void searchHistoryStorage.write({ version: 1, queries: nextHistory });
    }
    if (next === q) return;

    setQ(next);
    load({
      append: false,
      cursor: null,
      nextSort: sort,
      nextQ: next,
      nextTag: activeTag,
    });
  }, [activeTag, load, q, searchHistory, searchInput, setQ, sort]);

  const clearSearchHistory = useCallback(() => {
    setSearchHistory([]);
    void searchHistoryStorage.remove();
  }, []);

  const selectSearchHistory = useCallback((value) => {
    setSearchInput(value);
    applySearch(value);
  }, [applySearch]);

  const openSearchHistory = useCallback(() => setSearchFocused(true), []);
  const closeSearchHistory = useCallback(() => {
    setTimeout(() => setSearchFocused(false), 120);
  }, []);

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

  const hasActiveFilters = sort !== 'latest' || Boolean(activeTag) || feedLayout !== 'masonry';
  const resetFilters = useCallback(() => {
    const nextSort = 'latest';
    const nextTag = '';
    const dataChanged = sort !== nextSort || activeTag !== nextTag;

    setFeedLayout('masonry');
    setActiveTag(nextTag);
    setTag(nextTag);
    setSort(nextSort);
    setFiltersOpen(false);

    if (dataChanged) {
      load({
        append: false,
        cursor: null,
        nextSort,
        nextQ: q,
        nextTag,
      });
    }
  }, [activeTag, load, q, setSort, setTag, sort]);

  const clearDiscoveryFilters = useCallback(() => {
    const dataChanged = Boolean(q) || Boolean(activeTag) || sort !== 'latest';
    setSearchInput('');
    setActiveTag('');
    setTag('');
    setSort('latest');
    setFeedLayout('masonry');
    setFiltersOpen(false);
    if (dataChanged) {
      load({
        append: false,
        cursor: null,
        nextSort: 'latest',
        nextQ: '',
        nextTag: '',
      });
    }
  }, [activeTag, load, q, setSort, setTag, sort]);

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
      const result = await sharePost(item);
      setActionError('');
      if (result === 'copied') {
        setActionNotice('链接已复制，可粘贴到聊天或社交平台');
      }
    } catch (err) {
      if (err?.name === 'AbortError') return;
      setActionNotice('');
      setActionError(err?.message || '分享失败，请稍后重试');
    }
  }, []);

  const handlePostPress = useCallback((item) => {
    if (!item?.id) return;
    navigation.navigate('PostDetail', { postId: item.id, title: item.title });
  }, [navigation]);

  const handleAuthorPress = useCallback((item) => {
    if (!item?.authorId) return;
    navigation.navigate('AuthorProfile', { authorId: item.authorId, authorName: item.author, avatar: item.avatar });
  }, [navigation]);

  const handleComment = useCallback((postId) => {
    if (!postId) return;
    navigation.navigate('PostDetail', { postId: String(postId), focusComment: true });
  }, [navigation]);

  const openTab = useCallback((routeName) => {
    const parent = navigation?.getParent?.();
    if (parent?.navigate) {
      parent.navigate(routeName);
      return;
    }
    navigation?.navigate?.(routeName);
  }, [navigation]);

  const locationContext = locationLoading
    ? '正在定位'
    : `${locationLabel || '附近'} · 出片记录`;

  const isMasonry = feedLayout === 'masonry';
  const masonryBlocks = useMemo(() => {
    if (!isMasonry) return [];
    const blocks = [];
    for (let start = 0; start < posts.length; start += PAGE_SIZE) {
      const items = posts.slice(start, start + PAGE_SIZE);
      if (items.length) blocks.push({ id: `masonry-${items[0].id}`, items });
    }
    return blocks;
  }, [isMasonry, posts]);
  const showStaleBanner = Boolean(error && posts.length);
  const retryStaleFeed = useCallback(
    () => load({ append: false, cursor: null }),
    [load],
  );
  const renderCard = useCallback(({ item }) => (
    <PostCard
      post={item}
      compact={isMasonry}
      showFollow={!isMasonry}
      onPress={handlePostPress}
      onAuthorPress={handleAuthorPress}
      onLike={onLike}
      onFavorite={onFavorite}
      onFollow={onFollow}
      onTagPress={applyTagFilter}
      onComment={handleComment}
      onShare={onShare}
      likeBusy={isActionBusy(item.id, 'liked', 'liked')}
      favoriteBusy={isActionBusy(item.id, 'favorited', 'favorited')}
      followBusy={isActionBusy(item.id, 'followed', 'followed')}
      style={isMasonry ? styles.gridCard : styles.listCard}
    />
  ), [applyTagFilter, handleAuthorPress, handleComment, handlePostPress, isActionBusy, isMasonry, onFollow, onFavorite, onLike, onShare]);

  const renderMasonryBlock = useCallback(({ item: block }) => {
    const columns = splitMasonryColumns(block.items);
    return (
      <View style={styles.masonryRow}>
        {columns.map((column, columnIndex) => (
          <View style={styles.masonryColumn} key={`masonry-column-${block.id}-${columnIndex}`}>
            {column.map((item) => (
              <View key={String(item.id)}>
                {renderCard({ item })}
              </View>
            ))}
          </View>
        ))}
      </View>
    );
  }, [renderCard]);

  const ListHeader = useMemo(() => (
    <View style={styles.headerSection}>
      <View style={styles.headerTop}>
        <View style={styles.titleStack}>
          <Pressable
            style={styles.locationContext}
            onPress={() => openTab(APP_ROUTES.MAP)}
            accessibilityRole="button"
            accessibilityLabel="查看当前位置地图"
          >
            <View style={styles.locationDot} />
            <Text style={styles.titleEyebrow}>{locationContext}</Text>
          </Pressable>
          <Text style={styles.title}>发现</Text>
        </View>
        <Pressable
          style={[styles.layoutBtn, (filtersOpen || hasActiveFilters) && styles.layoutBtnActive]}
          onPress={() => setFiltersOpen((value) => !value)}
          accessibilityRole="button"
          accessibilityState={{ expanded: filtersOpen }}
          accessibilityLabel={hasActiveFilters ? '打开已生效的筛选' : '打开筛选'}
        >
          <Text style={[styles.layoutBtnText, (filtersOpen || hasActiveFilters) && styles.layoutBtnTextActive]}>
            {filtersOpen ? '收起' : hasActiveFilters ? '已筛选' : '筛选'}
          </Text>
        </Pressable>
      </View>
      {showStaleBanner ? (
        <Pressable
          style={styles.staleBanner}
          onPress={retryStaleFeed}
          accessibilityRole="button"
          accessibilityLabel="重新加载发现内容"
        >
          <View style={styles.staleBannerRow}>
            <Text style={styles.staleBannerText}>网络暂时不可用，当前显示上次内容</Text>
            <Text style={styles.staleBannerAction}>点击重试</Text>
          </View>
        </Pressable>
      ) : null}
      {actionError ? (
        <Pressable
          style={styles.actionError}
          onPress={() => setActionError('')}
          accessibilityRole="button"
          accessibilityLabel="关闭操作失败提示"
        >
          <Text style={styles.actionErrorText}>{actionError} · 点击关闭</Text>
        </Pressable>
      ) : null}
      {actionNotice ? (
        <Pressable
          style={styles.actionNotice}
          onPress={() => setActionNotice('')}
          accessibilityRole="button"
          accessibilityLabel="关闭分享成功提示"
        >
          <Text style={styles.actionNoticeText}>{actionNotice} · 点击关闭</Text>
        </Pressable>
      ) : null}
      <FeedTabs value={feedMode} onChange={switchFeedMode} />
      <SearchBar
        value={searchInput}
        onChange={setSearchInput}
        onSubmit={applySearch}
        onFocus={openSearchHistory}
        onBlur={closeSearchHistory}
      />
      {searchFocused && !searchInput.trim() ? (
        <SearchHistoryStrip
          items={searchHistory}
          onSelect={selectSearchHistory}
          onClear={clearSearchHistory}
        />
      ) : null}
      {filtersOpen ? (
        <Modal
          transparent
          visible
          animationType="slide"
          onRequestClose={() => setFiltersOpen(false)}
        >
          <View style={styles.filterModal}>
            <Pressable
              style={styles.filterBackdrop}
              onPress={() => setFiltersOpen(false)}
              accessibilityRole="button"
              accessibilityLabel="关闭筛选面板"
            />
            <View style={styles.filterSheet}>
              <View style={styles.filterHandle} />
              <View style={styles.filterSheetHeader}>
                <Text style={styles.filterSheetTitle}>筛选发现</Text>
                <View style={styles.filterSheetActions}>
                  <Pressable
                    style={[styles.filterReset, !hasActiveFilters && styles.filterResetDisabled]}
                    onPress={resetFilters}
                    disabled={!hasActiveFilters}
                    accessibilityRole="button"
                    accessibilityLabel="重置筛选"
                  >
                    <Text style={styles.filterResetText}>重置</Text>
                  </Pressable>
                  <Pressable
                    style={styles.filterDone}
                    onPress={() => setFiltersOpen(false)}
                    accessibilityRole="button"
                    accessibilityLabel="完成筛选"
                  >
                    <Text style={styles.filterDoneText}>完成</Text>
                  </Pressable>
                </View>
              </View>
              <View style={styles.filterPanel}>
                <View style={styles.filterTools}>
                  <View style={styles.sortSlot}>
                    <Text style={styles.filterHint}>排序</Text>
                    <SortTabs value={sort} onChange={applySort} />
                  </View>
                  <Pressable
                    style={styles.layoutBtn}
                    onPress={() => setFeedLayout((prev) => (prev === 'masonry' ? 'list' : 'masonry'))}
                    accessibilityRole="button"
                    accessibilityLabel="切换作品布局"
                  >
                    <Text style={styles.layoutBtnText}>
                      {feedLayout === 'masonry' ? '列表' : '网格'}
                    </Text>
                  </Pressable>
                </View>
                <SignalStrip
                  items={signals}
                  activeTag={activeTag}
                  onSelect={applyTagFilter}
                  loading={signalsLoading}
                />
                {!!signalsError ? <Text style={styles.signalError}>发现推荐加载失败：{signalsError}</Text> : null}
              </View>
            </View>
          </View>
        </Modal>
      ) : null}
    </View>
  ), [actionError, actionNotice, activeTag, applySearch, applySort, applyTagFilter, clearSearchHistory, closeSearchHistory, feedMode, feedLayout, filtersOpen, hasActiveFilters, isMasonry, locationContext, openSearchHistory, openTab, resetFilters, retryStaleFeed, searchFocused, searchHistory, searchInput, selectSearchHistory, showStaleBanner, signals, signalsError, signalsLoading, sort, switchFeedMode]);

  const ListFooter = useMemo(() => {
    if (!hasMore || !loadingMore) return null;
    return <View style={styles.footer}><ActivityIndicator color={COLORS.accent} /></View>;
  }, [hasMore, loadingMore]);

  const showSkeleton = loading && !refreshing && posts.length === 0;
  const showEmpty = !loading && !loadingMore && !posts.length;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <FlatList
        ref={feedListRef}
        key={isMasonry ? 'feed-masonry' : 'feed-list'}
        data={isMasonry ? masonryBlocks : posts}
        keyExtractor={(item) => String(item.id)}
        numColumns={1}
        refreshing={refreshing}
        onRefresh={onRefresh}
        onEndReached={onEndReached}
        onEndReachedThreshold={0.2}
        stickyHeaderIndices={[0]}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={ListHeader}
        contentContainerStyle={[styles.list, isMasonry ? styles.listMasonry : styles.listList]}
        renderItem={isMasonry ? renderMasonryBlock : renderCard}
        ListEmptyComponent={
          showSkeleton ? <FeedSkeleton count={5} /> : (
            <View style={styles.emptyWrap}>
              {!!error ? <Text style={styles.error}>加载失败：{error}</Text> : null}
              {showEmpty ? (
                <Text style={styles.empty}>
                  {feedMode === 'following' && !q && !activeTag
                    ? '关注喜欢的拍友后，这里会出现他们的出片'
                    : '还没有匹配作品，调整关键词或标签试试'}
                </Text>
              ) : null}
              {showEmpty && !error ? (
                <Text style={styles.emptyHint}>
                  {feedMode === 'following' && !q && !activeTag
                    ? '先去推荐里看看城市光影和创作者'
                    : '先发一张照片，位置和参数之后再补也可以'}
                </Text>
              ) : null}
              {showEmpty && !error ? (
                <View style={styles.emptyActions}>
                  <Pressable
                    style={styles.publishBtn}
                    onPress={() => (feedMode === 'following' && !q && !activeTag
                      ? switchFeedMode('recommend')
                      : openTab(APP_ROUTES.CREATE))}
                  >
                    <Text style={styles.publishBtnText}>
                      {feedMode === 'following' && !q && !activeTag ? '看看推荐' : '发布一张'}
                    </Text>
                  </Pressable>
                  <Pressable style={styles.retryBtn} onPress={() => load({ append: false })}>
                    <Text style={styles.retryText}>刷新</Text>
                  </Pressable>
                </View>
              ) : null}
              {showEmpty && !error && (q || activeTag || sort !== 'latest') ? (
                <Pressable
                  style={styles.clearEmptyBtn}
                  onPress={clearDiscoveryFilters}
                  accessibilityRole="button"
                  accessibilityLabel="清除搜索和筛选条件"
                >
                  <Text style={styles.clearEmptyText}>清除搜索和筛选</Text>
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
  filterPanel: {
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: COLORS.line,
  },
  filterModal: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  filterBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(28, 24, 21, 0.42)',
  },
  filterSheet: {
    maxHeight: '72%',
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 24,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    backgroundColor: COLORS.bg,
    shadowColor: '#1c1c1c',
    shadowOpacity: 0.18,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: -4 },
    elevation: 8,
  },
  filterHandle: {
    alignSelf: 'center',
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: COLORS.line,
    marginBottom: 10,
  },
  filterSheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  filterSheetTitle: { color: COLORS.ink, fontSize: 16, fontWeight: '800' },
  filterSheetActions: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  filterReset: { paddingHorizontal: 8, paddingVertical: 6 },
  filterResetDisabled: { opacity: 0.35 },
  filterResetText: { color: COLORS.muted, fontSize: 13, fontWeight: '700' },
  filterDone: { paddingHorizontal: 8, paddingVertical: 6 },
  filterDoneText: { color: COLORS.accent, fontSize: 13, fontWeight: '800' },
  filterTools: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  sortSlot: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  filterHint: {
    color: COLORS.muted,
    fontSize: 11,
    fontWeight: '600',
  },
  list: { paddingBottom: 34 },
  listList: { paddingHorizontal: 10 },
  listMasonry: { paddingHorizontal: 8 },
  headerWrap: {
    paddingBottom: 10,
    backgroundColor: COLORS.bg,
    zIndex: 2,
    elevation: 2,
  },
  masonryRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    columnGap: 8,
    paddingHorizontal: 0,
  },
  masonryColumn: {
    flex: 1,
    minWidth: 0,
  },
  headerSection: {
    paddingTop: 8,
    paddingHorizontal: 8,
    marginBottom: 6,
    backgroundColor: COLORS.bg,
    paddingBottom: 8,
  },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 4,
    paddingVertical: 10,
  },
  titleStack: { gap: 3 },
  locationContext: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 16,
    paddingVertical: 1,
    paddingRight: 6,
    borderRadius: 999,
  },
  locationDot: {
    width: 5,
    height: 5,
    marginRight: 5,
    borderRadius: 3,
    backgroundColor: COLORS.accent,
  },
  titleEyebrow: {
    color: COLORS.muted,
    fontSize: 9.5,
    letterSpacing: 1.15,
    fontWeight: '700',
  },
  title: {
    fontSize: 30,
    color: COLORS.ink,
    fontWeight: '800',
    letterSpacing: -1.1,
    fontFamily: Platform.select({ ios: 'Georgia', android: 'serif', web: 'Georgia' }),
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  layoutBtn: {
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    borderRadius: 9,
    backgroundColor: COLORS.card,
    paddingHorizontal: 11,
    paddingVertical: 7,
  },
  layoutBtnText: {
    color: COLORS.muted,
    fontSize: 11.5,
    fontWeight: '700',
  },
  layoutBtnActive: {
    borderColor: COLORS.accent,
    backgroundColor: COLORS.accentBg,
  },
  layoutBtnTextActive: {
    color: COLORS.accent,
    fontWeight: '800',
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
    marginTop: 6,
    minHeight: 46,
    backgroundColor: '#eee7dd',
    borderRadius: 11,
    borderWidth: 1,
    borderColor: 'rgba(52,45,37,0.05)',
    paddingHorizontal: 11,
    paddingVertical: 6,
  },
  searchInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  searchGlyph: {
    width: 17,
    height: 17,
    position: 'relative',
    marginLeft: 2,
  },
  searchLens: {
    position: 'absolute',
    left: 1,
    top: 1,
    width: 11,
    height: 11,
    borderWidth: 1.7,
    borderColor: COLORS.muted,
    borderRadius: 7,
  },
  searchHandle: {
    position: 'absolute',
    left: 11,
    top: 12,
    width: 6,
    height: 1.7,
    backgroundColor: COLORS.muted,
    transform: [{ rotate: '45deg' }],
    borderRadius: 2,
  },
  searchInput: {
    flex: 1,
    height: 36,
    color: COLORS.ink,
    fontSize: 13.5,
  },
  searchHistory: {
    marginHorizontal: 4,
    marginTop: 4,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: COLORS.panel,
    borderWidth: 1,
    borderColor: COLORS.line,
  },
  searchHistoryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  searchHistoryTitle: { color: COLORS.ink, fontSize: 12.5, fontWeight: '700' },
  searchHistoryClear: { color: COLORS.muted, fontSize: 11.5 },
  searchHistoryItems: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  searchHistoryChip: {
    maxWidth: '100%',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: COLORS.bgDeep,
  },
  searchHistoryChipText: { color: COLORS.mutedText, fontSize: 11.5 },

  feedTabs: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 24,
    marginHorizontal: 8,
    marginTop: 12,
    marginBottom: 3,
  },
  feedTab: {
    minWidth: 42,
    alignItems: 'center',
    paddingVertical: 6,
    position: 'relative',
  },
  feedTabText: {
    color: COLORS.muted,
    fontSize: 16,
    fontWeight: '600',
  },
  feedTabTextActive: {
    color: COLORS.ink,
    fontWeight: '800',
  },
  feedTabUnderline: {
    position: 'absolute',
    bottom: 0,
    width: 24,
    height: 3,
    borderRadius: 1,
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
  staleBanner: {
    marginHorizontal: 12,
    marginBottom: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 8,
    backgroundColor: '#fff3e8',
  },
  staleBannerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  staleBannerText: {
    flex: 1,
    color: '#9a5a2b',
    fontSize: 11,
    lineHeight: 15,
  },
  staleBannerAction: {
    color: '#9a5a2b',
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '800',
  },
  actionError: {
    marginHorizontal: 12,
    marginBottom: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 8,
    backgroundColor: '#fff0f0',
  },
  actionErrorText: {
    color: '#a83f3f',
    fontSize: 11,
    lineHeight: 15,
  },
  actionNotice: {
    marginHorizontal: 12,
    marginBottom: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 8,
    backgroundColor: '#eef8f0',
  },
  actionNoticeText: {
    color: COLORS.ok,
    fontSize: 11,
    lineHeight: 15,
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
  emptyHint: {
    marginTop: 8,
    textAlign: 'center',
    color: COLORS.mutedText,
    fontSize: 12,
  },
  emptyActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 14,
  },
  publishBtn: {
    borderRadius: 999,
    paddingVertical: 9,
    paddingHorizontal: 16,
    backgroundColor: COLORS.accent,
  },
  publishBtnText: {
    color: COLORS.white,
    fontSize: 12.5,
    fontWeight: '700',
  },
  retryBtn: {
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
    flex: 0.49,
    marginBottom: 18,
    marginHorizontal: 0,
  },
  listCard: {
    marginBottom: 18,
    marginHorizontal: 0,
  },
});
