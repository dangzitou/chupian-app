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
import { formatRelativeTime } from '../utils/time';

const TYPE_META = {
  like: { mark: '赞', label: '赞了你的出片', color: '#d93657' },
  favorite: { mark: '藏', label: '收藏了你的出片', color: '#a36325' },
  comment: { mark: '评', label: '评论了你的出片', color: '#315d79' },
  follow: { mark: '关', label: '关注了你', color: '#2f6b45' },
};

const FILTERS = [
  { key: 'all', label: '全部' },
  { key: 'like', label: '赞与收藏', types: ['like', 'favorite'] },
  { key: 'comment', label: '评论', types: ['comment'] },
  { key: 'follow', label: '关注', types: ['follow'] },
];

export default function NotificationsScreen({ navigation }) {
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const [cursor, setCursor] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('all');

  const load = useCallback(async ({ append = false, nextCursor = null } = {}) => {
    if (append ? loadingMore : (loading && !refreshing)) return;
    if (append) setLoadingMore(true);
    else setLoading(true);
    setError('');
    try {
      const payload = await api.notifications({ limit: 20, cursor: append ? nextCursor : null });
      setItems((prev) => {
        const merged = append ? [...prev, ...payload.notifications] : payload.notifications;
        const seen = new Set();
        return merged.filter((item) => {
          const key = String(item?.id || `${item?.actorId || ''}:${item?.createdAt || ''}:${item?.type || ''}`);
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      });
      setCursor(payload.nextCursor);
      setHasMore(payload.hasMore);
      setUnread(payload.unread);
    } catch (err) {
      setError(err?.message || '通知加载失败');
    } finally {
      if (append) setLoadingMore(false);
      else {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [loading, loadingMore, refreshing]);

  useEffect(() => {
    load();
  }, []);

  const refresh = useCallback(() => {
    setRefreshing(true);
    load({ append: false });
  }, [load]);

  const markAllRead = useCallback(async () => {
    if (!unread) return;
    const previousItems = items;
    const previousUnread = unread;
    setUnread(0);
    setItems((prev) => prev.map((item) => ({ ...item, read: true })));
    try {
      await api.markAllNotificationsRead();
    } catch (_err) {
      setItems(previousItems);
      setUnread(previousUnread);
      setError('全部已读失败，请重试');
    }
  }, [items, unread]);

  const openNotification = useCallback((item) => {
    if (!item.read) {
      setItems((prev) => prev.map((entry) => (
        entry.id === item.id ? { ...entry, read: true } : entry
      )));
      setUnread((value) => Math.max(0, value - 1));
      api.markNotificationRead(item.id).catch(() => {
        // The next refresh restores the server state if the write failed.
      });
    }
    if (item.postId) {
      navigation.navigate('PostDetail', { postId: item.postId, title: item.postTitle });
      return;
    }
    if (item.actorId) {
      const parent = navigation?.getParent?.();
      const params = { authorId: item.actorId, authorName: item.actorName };
      if (parent) {
        parent.navigate(APP_ROUTES.DISCOVERY, { screen: 'AuthorProfile', params });
        return;
      }
      navigation.navigate('AuthorProfile', params);
    }
  }, [navigation]);

  const visibleItems = useMemo(() => {
    const active = FILTERS.find((item) => item.key === filter);
    if (!active?.types) return items;
    return items.filter((item) => active.types.includes(item.type));
  }, [filter, items]);

  const renderItem = useCallback(({ item }) => {
    const meta = TYPE_META[item.type] || TYPE_META.comment;
    return (
      <Pressable style={[styles.item, !item.read && styles.itemUnread]} onPress={() => openNotification(item)}>
        <View style={[styles.mark, { backgroundColor: meta.color }]}>
          <Text style={styles.markText}>{meta.mark}</Text>
        </View>
        <View style={styles.itemBody}>
          <Text style={styles.itemTitle}>
            <Text style={styles.actor}>{item.actorName}</Text>
            {` ${meta.label}`}
          </Text>
          {item.content && item.type === 'comment' ? (
            <Text style={styles.itemContent} numberOfLines={2}>{item.content}</Text>
          ) : null}
          {item.postTitle ? <Text style={styles.postTitle} numberOfLines={1}>{item.postTitle}</Text> : null}
          <Text style={styles.time}>{formatRelativeTime(item.createdAt)}</Text>
        </View>
        {!item.read ? <View style={styles.unreadDot} /> : null}
      </Pressable>
    );
  }, [openNotification]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Pressable style={styles.back} onPress={() => navigation.goBack()} accessibilityRole="button">
          <Text style={styles.backText}>‹</Text>
        </Pressable>
        <View style={styles.headerTitleWrap}>
          <Text style={styles.title}>消息</Text>
          {unread ? <Text style={styles.unreadLabel}>{unread} 条未读</Text> : null}
        </View>
        <Pressable style={styles.readAll} onPress={markAllRead} disabled={!unread}>
          <Text style={[styles.readAllText, !unread && styles.readAllDisabled]}>全部已读</Text>
        </Pressable>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filterBar}
      >
        {FILTERS.map((item) => (
          <Pressable
            key={item.key}
            style={[styles.filterChip, filter === item.key && styles.filterChipActive]}
            onPress={() => setFilter(item.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: filter === item.key }}
          >
            <Text style={[styles.filterText, filter === item.key && styles.filterTextActive]}>
              {item.label}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
      <FlatList
        data={visibleItems}
        keyExtractor={(item) => String(item.id)}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        refreshing={refreshing}
        onRefresh={refresh}
        onEndReached={() => {
          if (hasMore && cursor && !loadingMore) load({ append: true, nextCursor: cursor });
        }}
        onEndReachedThreshold={0.3}
        ListEmptyComponent={loading ? (
          <View style={styles.center}><ActivityIndicator color={COLORS.accent} /></View>
        ) : (
          <View style={styles.empty}>
            {error ? <Text style={styles.error}>{error}</Text> : (
              <Text style={styles.emptyText}>
                {filter === 'all' ? '暂时没有新的互动' : '当前分类暂无互动'}
              </Text>
            )}
            <Pressable style={styles.retry} onPress={() => load()}><Text style={styles.retryText}>重新加载</Text></Pressable>
          </View>
        )}
        ListFooterComponent={loadingMore ? <View style={styles.footer}><ActivityIndicator color={COLORS.accent} /></View> : null}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  header: {
    height: 58,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.line,
    backgroundColor: COLORS.white,
  },
  back: { width: 34, height: 40, alignItems: 'flex-start', justifyContent: 'center' },
  backText: { color: COLORS.ink, fontSize: 32, lineHeight: 34, fontWeight: '300' },
  headerTitleWrap: { flex: 1, alignItems: 'center' },
  title: { color: COLORS.ink, fontSize: 17, fontWeight: '800' },
  unreadLabel: { color: COLORS.accent, fontSize: 10.5, marginTop: 2, fontWeight: '600' },
  readAll: { minWidth: 58, alignItems: 'flex-end', paddingVertical: 8 },
  readAllText: { color: COLORS.accent, fontSize: 11.5, fontWeight: '700' },
  readAllDisabled: { color: COLORS.mutedText },
  filterBar: {
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 9,
    backgroundColor: COLORS.white,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.line,
  },
  filterChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 9,
    backgroundColor: '#f2f0ef',
  },
  filterChipActive: { backgroundColor: COLORS.accentBg },
  filterText: { color: COLORS.muted, fontSize: 12, fontWeight: '600' },
  filterTextActive: { color: COLORS.accent, fontWeight: '800' },
  list: { paddingHorizontal: 12, paddingVertical: 10, paddingBottom: 32, flexGrow: 1 },
  item: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: 13,
    marginBottom: 8,
    borderRadius: 14,
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  itemUnread: { borderColor: 'rgba(217,54,87,0.16)', backgroundColor: '#fffafb' },
  mark: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  markText: { color: COLORS.white, fontSize: 12, fontWeight: '800' },
  itemBody: { flex: 1, minWidth: 0 },
  itemTitle: { color: COLORS.ink, fontSize: 13.5, lineHeight: 19 },
  actor: { fontWeight: '800' },
  itemContent: { color: COLORS.ink, fontSize: 12.5, lineHeight: 18, marginTop: 5 },
  postTitle: { color: COLORS.muted, fontSize: 11.5, marginTop: 5 },
  time: { color: COLORS.mutedText, fontSize: 10.5, marginTop: 7 },
  unreadDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: COLORS.accent, marginLeft: 8, marginTop: 5 },
  center: { flex: 1, minHeight: 180, alignItems: 'center', justifyContent: 'center' },
  empty: { alignItems: 'center', justifyContent: 'center', minHeight: 220 },
  emptyText: { color: COLORS.muted, fontSize: 13 },
  error: { color: '#a34a2a', fontSize: 12, textAlign: 'center' },
  retry: { marginTop: 14, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 999, backgroundColor: COLORS.accentBg },
  retryText: { color: COLORS.accent, fontSize: 12, fontWeight: '700' },
  footer: { paddingVertical: 16, alignItems: 'center' },
});
