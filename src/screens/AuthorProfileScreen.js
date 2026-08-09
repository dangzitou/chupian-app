import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../api';
import { COLORS } from '../config';
import Avatar from '../components/Avatar';
import PostCard from '../components/PostCard';
import FeedSkeleton from '../components/FeedSkeleton';
import { useFeedList } from '../hooks/useFeedList';
import { usePostListActions } from '../hooks/usePostListActions';

export default function AuthorProfileScreen({ route, navigation }) {
  const authorId = String(route?.params?.authorId || '').trim();
  const authorName = String(route?.params?.authorName || '匿名拍友').trim();
  const [followed, setFollowed] = useState(false);
  const [followers, setFollowers] = useState(0);
  const [followLoading, setFollowLoading] = useState(true);
  const [followBusy, setFollowBusy] = useState(false);
  const [followError, setFollowError] = useState('');
  const [followLoadAttempt, setFollowLoadAttempt] = useState(0);

  const fetcher = useCallback((params) => api.authorPosts(authorId, params), [authorId]);
  const feed = useFeedList(fetcher, { limit: 12, sort: 'latest' });
  const authorAvatar = String(
    route?.params?.avatar || feed.posts.find((item) => item?.avatar)?.avatar || '',
  ).trim();
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
    setFollowLoading(true);
    api.getAuthorFollow(authorId).then((state) => {
      if (!alive) return;
      setFollowError('');
      setFollowed(Boolean(state.followed));
      setFollowers(Number(state.followers || 0));
      setFollowLoading(false);
    }).catch((err) => {
      if (!alive) return;
      setFollowError(err?.message || '关注状态加载失败');
      setFollowLoading(false);
    });
    return () => { alive = false; };
  }, [authorId, followLoadAttempt]);

  useEffect(() => {
    if (authorId) feed.load({ append: false });
  }, [authorId]);

  const toggleFollow = useCallback(async () => {
    if (!authorId || followBusy || followLoading) return;
    const next = !followed;
    setFollowBusy(true);
    setFollowError('');
    setFollowed(next);
    setFollowers((value) => Math.max(0, value + (next ? 1 : -1)));
    try {
      const result = await api.toggleFollow(authorId, next ? 'follow' : 'unfollow');
      setFollowed(Boolean(result.followed));
      setFollowers(Number(result.followers || 0));
    } catch (err) {
      setFollowed(!next);
      setFollowers((value) => Math.max(0, value + (next ? -1 : 1)));
      setFollowError(err?.message || '关注操作失败');
      Alert.alert('关注失败', err?.message || '网络异常，请稍后重试');
    } finally {
      setFollowBusy(false);
    }
  }, [authorId, followBusy, followLoading, followed]);

  const renderCard = useCallback(({ item }) => (
    <PostCard
      post={item}
      compact
      showFollow={false}
      hideCompactAuthor
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
        <Pressable style={styles.backButton} onPress={() => navigation.goBack()} hitSlop={12} accessibilityRole="button" accessibilityLabel="返回">
          <Text style={styles.back}>‹</Text>
        </Pressable>
        <Text style={styles.topTitle}>创作者</Text>
        <View style={styles.topSpacer} accessibilityElementsHidden />
      </View>
      <View style={styles.hero}>
        <View style={styles.heroTop}>
          <Avatar name={authorName} uri={authorAvatar} size={58} />
          <View style={styles.copy}>
            <Text style={styles.name}>{authorName}</Text>
            <Text style={styles.bio}>出片位置记录者</Text>
          </View>
        </View>
        <Pressable style={[styles.follow, followed && styles.followed]} onPress={toggleFollow} disabled={followBusy || followLoading}>
          <Text style={[styles.followText, followed && styles.followedText]}>{followBusy || followLoading ? '...' : (followed ? '已关注' : '关注')}</Text>
        </Pressable>
        {followError ? (
          <Pressable
            style={styles.followErrorButton}
            onPress={() => {
              setFollowError('');
              setFollowLoadAttempt((value) => value + 1);
            }}
            accessibilityRole="button"
            accessibilityLabel="重试加载关注状态"
          >
            <Text style={styles.followError}>{followError} · 重试</Text>
          </Pressable>
        ) : null}
      </View>
      <View style={styles.statsRow}>
        <View style={styles.statItem}>
          <Text style={styles.statNumber}>{feed.total || 0}</Text>
          <Text style={styles.statLabel}>作品</Text>
        </View>
        <View style={styles.statItem}>
          <Text style={styles.statNumber}>{followers}</Text>
          <Text style={styles.statLabel}>关注者</Text>
        </View>
      </View>
      <View style={styles.profileTabs}>
        <Text style={styles.profileTabActive}>作品</Text>
        <View style={styles.profileTabUnderline} />
      </View>
    </View>
  ), [authorAvatar, authorName, feed.total, followed, followBusy, followError, followLoading, followers, navigation, toggleFollow]);

  if (!authorId) {
    return <SafeAreaView style={styles.empty}><Text style={styles.error}>创作者信息不可用</Text></SafeAreaView>;
  }

  const listEmpty = feed.loading ? <FeedSkeleton count={4} /> : feed.error ? (
    <View style={styles.emptyState}>
      <Text style={styles.error}>加载失败：{feed.error}</Text>
      <Pressable style={styles.retry} onPress={() => feed.load({ append: false })}>
        <Text style={styles.retryText}>重试</Text>
      </Pressable>
    </View>
  ) : (
    <View style={styles.emptyState}>
      <Text style={styles.emptyText}>还没有公开作品</Text>
      <Text style={styles.emptyHint}>作者发布后，作品会出现在这里</Text>
    </View>
  );

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
        ListEmptyComponent={listEmpty}
        ListFooterComponent={feed.loadingMore ? <ActivityIndicator style={styles.footer} color={COLORS.accent} /> : null}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  list: { paddingHorizontal: 7, paddingBottom: 36 },
  columns: { gap: 8, marginBottom: 10 },
  card: { flex: 1 },
  topBar: { height: 50, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: COLORS.line },
  backButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  back: { color: COLORS.ink, fontSize: 32, lineHeight: 34 },
  topTitle: { color: COLORS.ink, fontSize: 15, fontWeight: '800' },
  topSpacer: { width: 38 },
  hero: { paddingTop: 18, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: COLORS.line },
  heroTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  copy: { flex: 1 },
  name: { color: COLORS.ink, fontSize: 18, fontWeight: '700' },
  bio: { color: COLORS.muted, fontSize: 12, marginTop: 2 },
  stats: { color: COLORS.muted, fontSize: 11, marginTop: 4 },
  follow: { marginTop: 14, borderRadius: 10, backgroundColor: COLORS.accent, paddingVertical: 10, alignItems: 'center' },
  followed: { backgroundColor: COLORS.bgDeep },
  followText: { color: COLORS.white, fontSize: 12, fontWeight: '700' },
  followedText: { color: COLORS.muted },
  followErrorButton: { marginTop: 7, alignSelf: 'center' },
  followError: { color: '#a34a2a', fontSize: 11, textAlign: 'center' },
  statsRow: { flexDirection: 'row', gap: 34, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: COLORS.line },
  statItem: { minWidth: 52, alignItems: 'flex-start' },
  statNumber: { color: COLORS.ink, fontSize: 17, fontWeight: '800' },
  statLabel: { color: COLORS.muted, fontSize: 11, marginTop: 2 },
  profileTabs: { height: 48, alignItems: 'center', justifyContent: 'center', position: 'relative' },
  profileTabActive: { color: COLORS.ink, fontSize: 14, fontWeight: '800' },
  profileTabUnderline: { position: 'absolute', bottom: 0, width: 22, height: 2, borderRadius: 2, backgroundColor: COLORS.accent },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.bg },
  error: { color: '#a34a2a', textAlign: 'center' },
  emptyState: { alignItems: 'center', paddingVertical: 48, paddingHorizontal: 20 },
  emptyText: { color: COLORS.muted, textAlign: 'center' },
  emptyHint: { color: COLORS.muted, fontSize: 11.5, marginTop: 6 },
  retry: { marginTop: 12, paddingHorizontal: 15, paddingVertical: 8, borderRadius: 999, backgroundColor: COLORS.accentBg },
  retryText: { color: COLORS.accent, fontSize: 12, fontWeight: '700' },
  footer: { paddingVertical: 12 },
});
