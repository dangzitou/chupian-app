import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
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
import { APP_ROUTES } from '../constants/routes';
import { sharePost } from '../utils/share';

const PAGE_SIZE = 12;

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

function SearchBar({ value, onSubmit, onChange }) {
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
  const [locationLabel, setLocationLabel] = useState('');
  const [locationLoading, setLocationLoading] = useState(true);
  const [searchInput, setSearchInput] = useState('');
  const [activeTag, setActiveTag] = useState('');
  const [signals, setSignals] = useState([]);
  const [signalsLoading, setSignalsLoading] = useState(false);
  const [signalsError, setSignalsError] = useState(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [actionError, setActionError] = useState('');
  const bootstrappedRef = useRef(false);
  const feedModeRef = useRef('');
  const firstFocusRef = useRef(true);
  const refreshOnFocusRef = useRef(null);
  const feedListRef = useRef(null);

  useScrollToTop(feedListRef);

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

  const switchFeedMode = useCallback((nextMode) => {
    if (nextMode === feedMode) return;
    clearFeed();
    setFeedMode(nextMode);
    setActiveTag('');
    setSearchInput('');
    setQ('');
    setTag('');
    setSort('latest');
  }, [clearFeed, feedMode, setQ, setSort, setTag]);

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
    navigation.navigate('PostDetail', { postId: String(postId) });
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
  const useWebMasonry = Platform.OS === 'web' && isMasonry;
  const masonryColumns = useMemo(
    () => (useWebMasonry ? splitMasonryColumns(posts) : [[], []]),
    [posts, useWebMasonry],
  );
  const showStaleBanner = Boolean(error && posts.length);
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

  const renderMasonryBlock = useCallback(() => (
    <View style={styles.webMasonryRow}>
      {masonryColumns.map((column, columnIndex) => (
        <View style={styles.webMasonryColumn} key={`masonry-column-${columnIndex}`}>
          {column.map((item) => (
            <View key={String(item.id)}>
              {renderCard({ item })}
            </View>
          ))}
        </View>
      ))}
    </View>
  ), [masonryColumns, renderCard]);

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
        <Text style={styles.staleBanner}>网络暂时不可用，当前显示上次内容 · 下拉重试</Text>
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
      <FeedTabs value={feedMode} onChange={switchFeedMode} />
      <SearchBar value={searchInput} onChange={setSearchInput} onSubmit={applySearch} />
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
  ), [actionError, activeTag, applySearch, applySort, applyTagFilter, feedMode, feedLayout, filtersOpen, hasActiveFilters, isMasonry, locationContext, openTab, resetFilters, searchInput, showStaleBanner, signals, signalsError, signalsLoading, sort, switchFeedMode]);

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
        data={useWebMasonry ? (posts.length ? [{ id: '__web-masonry__' }] : []) : posts}
        keyExtractor={(post) => String(post.id)}
        numColumns={isMasonry && !useWebMasonry ? 2 : 1}
        columnWrapperStyle={isMasonry && !useWebMasonry ? styles.columnWrapper : undefined}
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
        renderItem={useWebMasonry ? renderMasonryBlock : renderCard}
        ListEmptyComponent={
          showSkeleton ? <FeedSkeleton count={5} /> : (
            <View style={styles.emptyWrap}>
              {!!error ? <Text style={styles.error}>加载失败：{error}</Text> : null}
              {showEmpty ? <Text style={styles.empty}>还没有匹配作品，调整关键词或标签试试</Text> : null}
              {showEmpty && !error ? (
                <Text style={styles.emptyHint}>先发一张照片，位置和参数之后再补也可以</Text>
              ) : null}
              {showEmpty && !error ? (
                <View style={styles.emptyActions}>
                  <Pressable style={styles.publishBtn} onPress={() => openTab(APP_ROUTES.CREATE)}>
                    <Text style={styles.publishBtnText}>发布一张</Text>
                  </Pressable>
                  <Pressable style={styles.retryBtn} onPress={() => load({ append: false })}>
                    <Text style={styles.retryText}>刷新</Text>
                  </Pressable>
                </View>
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
  listList: { paddingHorizontal: 8 },
  listMasonry: { paddingHorizontal: 4 },
  headerWrap: {
    paddingBottom: 8,
    backgroundColor: COLORS.bg,
    zIndex: 2,
    elevation: 2,
  },
  webMasonryRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    columnGap: 4,
    paddingHorizontal: 2,
  },
  webMasonryColumn: {
    flex: 1,
    minWidth: 0,
  },
  headerSection: {
    paddingTop: 4,
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
  titleStack: { gap: 1 },
  locationContext: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 18,
    paddingVertical: 2,
    paddingRight: 6,
    borderRadius: 999,
  },
  locationDot: {
    width: 6,
    height: 6,
    marginRight: 5,
    borderRadius: 3,
    backgroundColor: COLORS.accent,
  },
  titleEyebrow: {
    color: COLORS.muted,
    fontSize: 10.5,
    letterSpacing: 0.6,
    fontWeight: '700',
  },
  title: { fontSize: 25, color: COLORS.ink, fontWeight: '800', letterSpacing: -0.6 },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  layoutBtn: {
    borderWidth: 0,
    borderRadius: 999,
    backgroundColor: 'transparent',
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
    minHeight: 44,
    backgroundColor: '#efedeb',
    borderRadius: 12,
    paddingHorizontal: 10,
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

  feedTabs: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 20,
    marginHorizontal: 8,
    marginTop: 8,
    marginBottom: 1,
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
    height: 2,
    borderRadius: 2,
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
    color: '#9a5a2b',
    backgroundColor: '#fff3e8',
    fontSize: 11,
    lineHeight: 15,
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
    marginBottom: 16,
    marginHorizontal: 2,
  },
  listCard: {
    marginBottom: 16,
    marginHorizontal: 6,
  },
});
