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

const PAGE_SIZE = 12;
const GRID_COLUMNS = 2;
const SORT_OPTIONS = [
  { key: 'latest', label: '最新' },
  { key: 'hot', label: '热门' },
];

function SearchBar({ value, onSubmit, onChange }) {
  return (
    <View style={styles.searchWrap}>
      <TextInput
        style={styles.searchInput}
        placeholder="搜索标题/地点/标签"
        placeholderTextColor={COLORS.muted}
        value={value}
        onChangeText={onChange}
        returnKeyType="search"
        blurOnSubmit={false}
        onSubmitEditing={onSubmit}
        clearButtonMode="while-editing"
      />
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
          >
            <Text style={[styles.tabText, active && styles.tabTextActive]}>{item.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function SignalStrip({ items, activeTag, onSelect, loading }) {
  if (!items.length) {
    if (loading) {
      return <View style={styles.signalWrap}><ActivityIndicator size="small" color={COLORS.accent} /></View>;
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
        {items.slice(0, 14).map((signal) => {
          const key = `${signal.type}-${signal.name}`;
          const active = activeTag === signal.name;
          return (
            <Pressable
              key={key}
              style={[styles.signalPill, active && styles.signalPillActive]}
              onPress={() => onSelect(signal.name)}
            >
              <Text style={[styles.signalText, active && styles.signalTextActive]}>
                #{signal.name} ({signal.count})
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

export default function PostsScreen({ navigation }) {
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [nextCursor, setNextCursor] = useState(null);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [sort, setSort] = useState('latest');
  const [searchInput, setSearchInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTag, setActiveTag] = useState('');
  const [signals, setSignals] = useState([]);
  const [signalsLoading, setSignalsLoading] = useState(false);
  const [signalsError, setSignalsError] = useState(null);
  const busyActionIdsRef = useRef(new Set());

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

  const load = useCallback(async (targetCursor = null, append = false, nextSort = sort, nextQuery = searchQuery, nextTag = activeTag) => {
    if (append && loadingMore) return;
    if (!append) {
      setLoading(true);
    }
    try {
      const d = await api.feed({
        cursor: targetCursor || '',
        limit: PAGE_SIZE,
        sort: nextSort,
        q: nextQuery,
        tag: nextTag,
      });
      const next = Array.isArray(d.posts) ? d.posts : [];
      setPosts((prev) => (targetCursor ? [...prev, ...next] : next));
      setNextCursor(d.nextCursor || null);
      setHasMore(Boolean(d.hasMore));
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
      setLoadingMore(false);
    }
  }, [loadingMore, sort, searchQuery, activeTag]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    load(null, false);
  }, [load]);

  const onEndReached = useCallback(() => {
    if (!hasMore || loadingMore || !nextCursor || loading) return;
    setLoadingMore(true);
    load(nextCursor, true);
  }, [hasMore, loadingMore, loading, nextCursor, load]);

  const onSearchSubmit = useCallback(() => {
    const nextSearch = searchInput.trim();
    if (nextSearch !== searchQuery) {
      setSearchQuery(nextSearch);
      setPosts([]);
      setNextCursor(null);
      setHasMore(true);
      setError(null);
    }
  }, [searchInput, searchQuery]);

  const onTagSelect = useCallback((tag) => {
    const nextTag = tag || '';
    const next = nextTag === activeTag ? '' : nextTag;
    if (next === activeTag) return;
    setActiveTag(next);
    setPosts([]);
    setNextCursor(null);
    setHasMore(true);
    load(null, false, sort, searchQuery, next);
  }, [activeTag, load, searchQuery, sort]);

  const safeLoadSort = useCallback((nextSort) => {
    if (nextSort === sort) return;
    setSort(nextSort);
    setPosts([]);
    setNextCursor(null);
    setHasMore(true);
    load(null, false, nextSort);
  }, [load, sort]);

  useEffect(() => {
    load(null, false);
  }, [load]);

  useEffect(() => {
    loadDiscovery();
  }, [loadDiscovery]);

  const setBusyForPost = useCallback((id, active) => {
    const key = String(id);
    const next = new Set(busyActionIdsRef.current);
    if (active) {
      next.add(key);
    } else {
      next.delete(key);
    }
    busyActionIdsRef.current = next;
  }, []);

  const patchPostById = useCallback((id, patch) => {
    let current = null;
    setPosts((prev) => prev.map((item) => {
      if (String(item.id) !== String(id)) return item;
      current = item;
      const nextPatch = typeof patch === 'function' ? patch(item) : patch;
      return { ...item, ...nextPatch };
    }));
    return current;
  }, []);

  const onLike = useCallback(async (postId) => {
    const id = String(postId);
    if (busyActionIdsRef.current.has(id)) return;
    const base = patchPostById(id, (post) => {
      const nextLiked = !post.liked;
      return {
        liked: nextLiked,
        likes: Math.max(0, Number(post.likes || 0) + (nextLiked ? 1 : -1)),
      };
    });
    if (!base) return;

    setBusyForPost(id, true);
    try {
      const nextLiked = !base.liked;
      await api.toggleLike(id, base.author, nextLiked ? 'like' : 'unlike');
      const fresh = await api.getPost(id);
      patchPostById(id, {
        likes: Number(fresh.likes || 0),
        liked: Boolean(fresh.liked),
      });
    } catch (_err) {
      patchPostById(id, {
        liked: base.liked,
        likes: base.likes,
      });
    } finally {
      setBusyForPost(id, false);
    }
  }, [patchPostById, setBusyForPost]);

  const onFavorite = useCallback(async (postId) => {
    const id = String(postId);
    if (busyActionIdsRef.current.has(id)) return;

    const base = patchPostById(id, (post) => {
      const nextFavorited = !post.favorited;
      return {
        favorited: nextFavorited,
        favorites: Math.max(0, Number(post.favorites || 0) + (nextFavorited ? 1 : -1)),
      };
    });
    if (!base) return;

    setBusyForPost(id, true);
    try {
      const nextFavorited = !base.favorited;
      await api.toggleFavorite(id, base.author, nextFavorited ? 'favorite' : 'unfavorite');
      const fresh = await api.getPost(id);
      patchPostById(id, {
        favorites: Number(fresh.favorites || 0),
        favorited: Boolean(fresh.favorited),
      });
    } catch (_err) {
      patchPostById(id, {
        favorited: base.favorited,
        favorites: base.favorites,
      });
    } finally {
      setBusyForPost(id, false);
    }
  }, [patchPostById, setBusyForPost]);

  const renderCard = useCallback(({ item }) => (
    <PostCard
      compact
      post={item}
      onPress={() => navigation.navigate('PostDetail', { postId: item.id, title: item.title })}
      onLike={() => onLike(item.id)}
      onFavorite={() => onFavorite(item.id)}
      likeBusy={busyActionIdsRef.current.has(String(item.id))}
      favoriteBusy={busyActionIdsRef.current.has(String(item.id))}
      onComment={() => navigation.navigate('PostDetail', { postId: item.id })}
      style={styles.gridCard}
    />
  ), [navigation, onFavorite, onLike]);

  const ListHeader = useMemo(() => (
    <View>
      <View style={styles.headerBar}>
        <View>
          <Text style={styles.title}>出片广场</Text>
          <Text style={styles.subtitle}>关注拍照参数、机位灵感、同城灵感</Text>
        </View>
        <Pressable style={styles.newBtn} onPress={() => navigation.navigate('NewPost')}>
          <Text style={styles.newBtnText}>＋ 发帖</Text>
        </Pressable>
      </View>
      <SearchBar
        value={searchInput}
        onChange={setSearchInput}
        onSubmit={onSearchSubmit}
      />
      <SortTabs value={sort} onChange={safeLoadSort} />
      <SignalStrip
        items={signals}
        activeTag={activeTag}
        onSelect={onTagSelect}
        loading={signalsLoading}
      />
      {!!signalsError ? <Text style={styles.signalError}>发现推荐加载失败：{signalsError}</Text> : null}
    </View>
  ), [activeTag, navigation, onSearchSubmit, onTagSelect, safeLoadSort, searchInput, signals, signalsError, signalsLoading, sort]);

  const ListFooter = useMemo(() => {
    if (!hasMore) return null;
    if (!loadingMore) return null;
    return <View style={styles.footer}><ActivityIndicator color={COLORS.accent} /></View>;
  }, [hasMore, loadingMore]);

  const showSkeleton = loading && !refreshing && !posts.length;
  const showEmpty = !loading && !loadingMore && !posts.length;

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <FlatList
        data={posts}
        keyExtractor={(post) => String(post.id)}
        numColumns={GRID_COLUMNS}
        columnWrapperStyle={styles.columnWrap}
        refreshing={refreshing}
        onRefresh={onRefresh}
        onEndReached={onEndReached}
        onEndReachedThreshold={0.2}
        ListHeaderComponent={ListHeader}
        contentContainerStyle={styles.list}
        renderItem={renderCard}
        key={GRID_COLUMNS}
        ListEmptyComponent={
          showSkeleton ? <FeedSkeleton count={6} /> : (
            <View style={styles.emptyWrap}>
              {!!error ? <Text style={styles.error}>加载失败：{error}</Text> : null}
              {showEmpty ? <Text style={styles.empty}>还没有匹配作品，试试调整关键词或标签</Text> : null}
              {showEmpty && !error ? (
                <Pressable style={styles.retryBtn} onPress={() => load()}>
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
  list: { paddingHorizontal: 8, paddingBottom: 40 },
  headerWrap: { paddingBottom: 6 },
  headerBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingTop: 10,
    paddingBottom: 12,
  },
  title: { fontSize: 24, color: COLORS.ink, fontWeight: '700' },
  subtitle: { color: COLORS.muted, marginTop: 2, fontSize: 12 },
  newBtn: {
    backgroundColor: COLORS.accent,
    borderRadius: 999,
    paddingHorizontal: 11,
    paddingVertical: 7,
  },
  newBtnText: { color: COLORS.onAccent, fontWeight: '700', fontSize: 12.5 },
  searchWrap: {
    marginHorizontal: 8,
    marginBottom: 8,
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    borderRadius: 12,
    paddingHorizontal: 10,
  },
  searchInput: {
    height: 38,
    color: COLORS.ink,
  },
  tabs: {
    flexDirection: 'row',
    gap: 8,
    marginHorizontal: 8,
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
  signalOuterWrap: {
    marginBottom: 6,
  },
  signalWrap: {
    gap: 8,
    paddingHorizontal: 8,
    paddingRight: 12,
    paddingBottom: 6,
  },
  signalPill: {
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: COLORS.card,
  },
  signalPillActive: {
    backgroundColor: COLORS.accentBg,
    borderColor: COLORS.accent,
  },
  signalText: {
    color: COLORS.muted,
    fontSize: 11.5,
    fontWeight: '600',
  },
  signalTextActive: {
    color: COLORS.accent,
  },
  signalError: {
    color: '#b15e2b',
    marginHorizontal: 12,
    fontSize: 11.5,
    marginBottom: 4,
  },
  error: { color: '#a34a2a', marginBottom: 6 },
  emptyWrap: {
    paddingTop: 80,
    alignItems: 'center',
    paddingBottom: 80,
  },
  empty: {
    textAlign: 'center',
    color: COLORS.muted,
    fontSize: 14,
  },
  footer: {
    alignItems: 'center',
    paddingBottom: 12,
    paddingTop: 8,
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
  columnWrap: {
    justifyContent: 'space-between',
  },
  gridCard: {
    width: '48.5%',
    marginBottom: 10,
  },
});
