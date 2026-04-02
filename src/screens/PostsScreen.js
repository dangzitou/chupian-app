import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../api';
import { COLORS } from '../config';
import PostCard from '../components/PostCard';

const PAGE_SIZE = 10;

export default function PostsScreen({ navigation }) {
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [nextCursor, setNextCursor] = useState(null);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(async (targetCursor = null, append = false) => {
    if (append && loadingMore) return;
    if (!append) {
      setLoading(true);
    }
    try {
      const d = await api.feed({
        cursor: targetCursor || '',
        limit: PAGE_SIZE,
        sort: 'latest',
      });
      const next = Array.isArray(d.posts) ? d.posts : [];
      setPosts((prev) => (append ? [...prev, ...next] : next));
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
  }, [loadingMore]);

  useEffect(() => {
    load(null, false);
  }, [load]);

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

  const optimisticPatch = useCallback((id, patch) => {
    setPosts((prev) => prev.map((post) => (post.id === id ? { ...post, ...patch } : post)));
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
      } catch (err) {
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
      } catch (err) {
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

  const ListFooter = useMemo(() => {
    if (!hasMore) return null;
    if (!loadingMore) return null;
    return <View style={styles.footer}><ActivityIndicator color={COLORS.accent} /></View>;
  }, [hasMore, loadingMore]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={COLORS.accent} />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>出片广场</Text>
        <Pressable style={styles.newBtn} onPress={() => navigation.navigate('NewPost')}>
          <Text style={styles.newBtnText}>＋ 发布出片</Text>
        </Pressable>
      </View>

      {error ? <Text style={styles.error}>加载失败：{error}</Text> : null}

      <FlatList
        data={posts}
        keyExtractor={(post) => String(post.id)}
        refreshing={refreshing}
        onRefresh={onRefresh}
        onEndReached={onEndReached}
        onEndReachedThreshold={0.3}
        contentContainerStyle={styles.list}
        renderItem={renderCard}
        ListEmptyComponent={<Text style={styles.empty}>还没有攻略，先发布一条出片内容吧</Text>}
        ListFooterComponent={ListFooter}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.bg },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.cardBorder,
    backgroundColor: COLORS.card,
  },
  title: { fontSize: 22, fontWeight: '700', color: COLORS.ink, letterSpacing: -0.5 },
  newBtn: {
    backgroundColor: COLORS.accentBg,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  newBtnText: { color: COLORS.accent, fontWeight: '600', fontSize: 12.5 },
  error: { color: '#a34a2a', paddingHorizontal: 16, paddingBottom: 6 },
  list: { paddingTop: 10, paddingBottom: 40 },
  empty: { textAlign: 'center', color: COLORS.muted, marginTop: 60, fontSize: 14 },
  footer: { alignItems: 'center', paddingBottom: 12, paddingTop: 8 },
});
