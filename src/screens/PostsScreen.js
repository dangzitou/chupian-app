import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../api';
import { COLORS } from '../config';
import PostCard from '../components/PostCard';

const PAGE_SIZE = 12;
const SORT_OPTIONS = [
  { key: 'latest', label: '最新' },
  { key: 'hot', label: '热门' },
];

function SearchBar({ value, onChange }) {
  return (
    <View style={styles.searchWrap}>
      <TextInput
        style={styles.searchInput}
        placeholder="搜索标题/地点/标签"
        placeholderTextColor={COLORS.muted}
        value={value}
        onChangeText={onChange}
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

export default function PostsScreen({ navigation }) {
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [nextCursor, setNextCursor] = useState(null);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [sort, setSort] = useState('latest');
  const [keyword, setKeyword] = useState('');

  const load = useCallback(async (targetCursor = null, append = false, nextSort = sort) => {
    if (append && loadingMore) return;
    if (!append) {
      setLoading(true);
    }
    try {
      const d = await api.feed({
        cursor: targetCursor || '',
        limit: PAGE_SIZE,
        sort: nextSort,
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
  }, [loadingMore, sort]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    setNextCursor(null);
    setHasMore(true);
    load(null, false);
  }, [load]);

  const onEndReached = useCallback(() => {
    if (!hasMore || loadingMore || !nextCursor || loading) return;
    setLoadingMore(true);
    load(nextCursor, true);
  }, [hasMore, loadingMore, loading, nextCursor, load]);

  const filteredPosts = useMemo(() => {
    const q = keyword.trim().toLowerCase();
    if (!q) return posts;
    return posts.filter((post) => {
      const hitString = [
        post.title,
        post.content,
        post.author,
        post.spotName,
        ...(post.tags || []),
        ...(post.styles || []),
      ].join(' ').toLowerCase();
      return hitString.includes(q);
    });
  }, [posts, keyword]);

  const safeLoad = useCallback((nextSort) => {
    if (nextSort === sort) return;
    setSort(nextSort);
    setNextCursor(null);
    setHasMore(true);
    setPosts([]);
    load(null, false, nextSort);
  }, [load, sort]);

  useEffect(() => {
    load(null, false);
  }, [load]);

  const optimisticPatch = useCallback((id, patch) => {
    setPosts((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }, []);

  const onCardAction = useMemo(() => ({
    onLike: async (item) => {
      const nextLiked = !item.liked;
      optimisticPatch(item.id, {
        liked: nextLiked,
        likes: Math.max(0, Number(item.likes || 0) + (nextLiked ? 1 : -1)),
      });
      try {
        await api.toggleLike(item.id, item.author, nextLiked ? 'like' : 'unlike');
        const fresh = await api.getPost(item.id);
        optimisticPatch(item.id, {
          likes: Number(fresh.likes || 0),
          liked: Boolean(fresh.liked),
        });
      } catch (_err) {
        optimisticPatch(item.id, {
          liked: item.liked,
          likes: item.likes,
        });
      }
    },
    onFavorite: async (item) => {
      const next = !item.favorited;
      optimisticPatch(item.id, {
        favorited: next,
        favorites: Math.max(0, Number(item.favorites || 0) + (next ? 1 : -1)),
      });
      try {
        await api.toggleFavorite(item.id, item.author, next ? 'favorite' : 'unfavorite');
        const fresh = await api.getPost(item.id);
        optimisticPatch(item.id, {
          favorites: Number(fresh.favorites || 0),
          favorited: Boolean(fresh.favorited),
        });
      } catch (_err) {
        optimisticPatch(item.id, {
          favorited: item.favorited,
          favorites: item.favorites,
        });
      }
    },
    onComment: (item) => navigation.navigate('PostDetail', { postId: item.id }),
  }), [navigation, optimisticPatch]);

  const renderCard = useCallback(({ item }) => (
    <PostCard
      post={item}
      onPress={() => navigation.navigate('PostDetail', { postId: item.id, title: item.title })}
      onLike={() => onCardAction.onLike(item)}
      onFavorite={() => onCardAction.onFavorite(item)}
      onComment={() => onCardAction.onComment(item)}
    />
  ), [navigation, onCardAction]);

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
      <SearchBar value={keyword} onChange={setKeyword} />
      <SortTabs value={sort} onChange={safeLoad} />
    </View>
  ), [keyword, navigation, onCardAction, sort, safeLoad]);

  const ListFooter = useMemo(() => {
    if (!hasMore) return null;
    if (!loadingMore) return null;
    return <View style={styles.footer}><ActivityIndicator color={COLORS.accent} /></View>;
  }, [hasMore, loadingMore]);

  if (loading && !refreshing) {
    return (
      <SafeAreaView style={styles.center} edges={["top"]}>
        <ActivityIndicator size="large" color={COLORS.accent} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <FlatList
        data={filteredPosts}
        keyExtractor={(post) => String(post.id)}
        refreshing={refreshing}
        onRefresh={onRefresh}
        onEndReached={onEndReached}
        onEndReachedThreshold={0.2}
        ListHeaderComponent={ListHeader}
        contentContainerStyle={styles.list}
        renderItem={renderCard}
        ListEmptyComponent={
          <View style={styles.emptyWrap}>
            {error ? <Text style={styles.error}>加载失败：{error}</Text> : null}
            <Text style={styles.empty}>{loading ? '加载中…' : '还没有攻略，先发布一条出片内容吧'}</Text>
          </View>
        }
        ListFooterComponent={ListFooter}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.bg },
  list: { paddingHorizontal: 0, paddingBottom: 40 },
  headerBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
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
    marginHorizontal: 16,
    marginBottom: 10,
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
    marginHorizontal: 16,
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
});
