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
import FeedSkeleton from '../components/FeedSkeleton';
import { useFeedList } from '../hooks/useFeedList';
import { usePostListActions } from '../hooks/usePostListActions';

export default function AuthorProfileScreen({ route, navigation }) {
  const authorId = String(route?.params?.authorId || '').trim();
  const authorName = String(route?.params?.authorName || '匿名拍友').trim();
  const [followed, setFollowed] = useState(false);
  const [followers, setFollowers] = useState(0);
  const [followBusy, setFollowBusy] = useState(false);

  const fetcher = useCallback((params) => api.authorPosts(authorId, params), [authorId]);
  const feed = useFeedList(fetcher, { limit: 12, sort: 'latest' });
  const getPostById = useCallback(
    (postId) => feed.posts.find((item) => String(item.id) === String(postId)),
    [feed.posts],
  );
  const actions = usePostListActions({
    getPostById,
    patchById: feed.patchById,
    setBusyForPost: feed.setBusyForPost,
    isBusyExternal: feed.isPostBusy,
  });

  useEffect(() => {
    if (!authorId) return undefined;
    let alive = true;
    api.getAuthorFollow(authorId).then((state) => {
      if (!alive) return;
      setFollowed(Boolean(state.followed));
      setFollowers(Number(state.followers || 0));
    }).catch(() => {});
    return () => { alive = false; };
  }, [authorId]);

  useEffect(() => {
    if (authorId) feed.load({ append: false });
  }, [authorId]);

  const toggleFollow = useCallback(async () => {
    if (!authorId || followBusy) return;
    const next = !followed;
    setFollowBusy(true);
    setFollowed(next);
    setFollowers((value) => Math.max(0, value + (next ? 1 : -1)));
    try {
      const result = await api.toggleFollow(authorId, next ? 'follow' : 'unfollow');
      setFollowed(Boolean(result.followed));
      setFollowers(Number(result.followers || 0));
    } catch (_err) {
      setFollowed(!next);
      setFollowers((value) => Math.max(0, value + (next ? -1 : 1)));
    } finally {
      setFollowBusy(false);
    }
  }, [authorId, followBusy, followed]);

  const renderCard = useCallback(({ item }) => (
    <PostCard
      post={item}
      compact
      showFollow={false}
      onPress={() => navigation.navigate('PostDetail', { postId: item.id, title: item.title })}
      onLike={() => actions.toggleAction({
        postId: item.id,
        metricField: 'likes',
        stateField: 'liked',
        actionResolver: ({ post, next }) => api.toggleLike(post.id, undefined, next ? 'like' : 'unlike'),
      })}
      onFavorite={() => actions.toggleAction({
        postId: item.id,
        metricField: 'favorites',
        stateField: 'favorited',
        actionResolver: ({ post, next }) => api.toggleFavorite(post.id, undefined, next ? 'favorite' : 'unfavorite'),
      })}
      likeBusy={actions.isBusy(item.id, 'liked', 'liked')}
      favoriteBusy={actions.isBusy(item.id, 'favorited', 'favorited')}
      style={styles.card}
    />
  ), [actions, navigation]);

  const header = useMemo(() => (
    <View>
      <View style={styles.topBar}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={12}>
          <Text style={styles.back}>‹</Text>
        </Pressable>
        <Text style={styles.topTitle}>创作者</Text>
        <View style={styles.topSpacer} />
      </View>
      <View style={styles.hero}>
        <View style={styles.avatar}><Text style={styles.avatarText}>{authorName.slice(0, 2)}</Text></View>
        <View style={styles.copy}>
          <Text style={styles.name}>{authorName}</Text>
          <Text style={styles.bio}>出片位置记录者</Text>
          <Text style={styles.stats}>{followers} 位关注者 · {feed.total || 0} 条作品</Text>
        </View>
        <Pressable style={[styles.follow, followed && styles.followed]} onPress={toggleFollow} disabled={followBusy}>
          <Text style={[styles.followText, followed && styles.followedText]}>{followBusy ? '...' : (followed ? '已关注' : '关注')}</Text>
        </Pressable>
      </View>
      <Text style={styles.sectionTitle}>作品</Text>
    </View>
  ), [authorName, feed.total, followed, followBusy, followers, navigation, toggleFollow]);

  if (!authorId) {
    return <SafeAreaView style={styles.empty}><Text style={styles.error}>创作者信息不可用</Text></SafeAreaView>;
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <FlatList
        data={feed.posts}
        numColumns={2}
        columnWrapperStyle={styles.columns}
        keyExtractor={(item) => String(item.id)}
        ListHeaderComponent={header}
        renderItem={renderCard}
        contentContainerStyle={styles.list}
        onRefresh={feed.onRefresh}
        refreshing={feed.refreshing}
        onEndReached={feed.onEndReached}
        onEndReachedThreshold={0.2}
        ListEmptyComponent={feed.loading ? <FeedSkeleton count={4} /> : <Text style={styles.emptyText}>还没有公开作品</Text>}
        ListFooterComponent={feed.loadingMore ? <ActivityIndicator color={COLORS.accent} /> : null}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  list: { paddingHorizontal: 6, paddingBottom: 36 },
  columns: { gap: 8 },
  card: { flex: 1 },
  topBar: { height: 46, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  back: { color: COLORS.ink, fontSize: 32, lineHeight: 34, paddingHorizontal: 8 },
  topTitle: { color: COLORS.ink, fontSize: 16, fontWeight: '700' },
  topSpacer: { width: 38 },
  hero: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: COLORS.line },
  avatar: { width: 58, height: 58, borderRadius: 29, backgroundColor: COLORS.accentSoft, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: COLORS.accent, fontSize: 18, fontWeight: '800' },
  copy: { flex: 1 },
  name: { color: COLORS.ink, fontSize: 18, fontWeight: '700' },
  bio: { color: COLORS.muted, fontSize: 12, marginTop: 2 },
  stats: { color: COLORS.muted, fontSize: 11, marginTop: 4 },
  follow: { borderRadius: 999, backgroundColor: COLORS.accent, paddingHorizontal: 14, paddingVertical: 7 },
  followed: { backgroundColor: COLORS.bgDeep },
  followText: { color: COLORS.white, fontSize: 12, fontWeight: '700' },
  followedText: { color: COLORS.muted },
  sectionTitle: { color: COLORS.ink, fontSize: 15, fontWeight: '700', paddingVertical: 12 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.bg },
  error: { color: COLORS.muted },
  emptyText: { color: COLORS.muted, textAlign: 'center', paddingVertical: 36 },
});
