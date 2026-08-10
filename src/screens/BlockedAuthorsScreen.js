import React, { useCallback, useEffect, useState } from 'react';
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
import { formatRelativeTime } from '../utils/time';
import AppIcon from '../components/AppIcon';

export default function BlockedAuthorsScreen({ navigation }) {
  const [authors, setAuthors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.blockedAuthors();
      setAuthors(Array.isArray(result?.authors) ? result.authors : []);
      setError('');
    } catch (err) {
      setError(err?.cause || err?.message || '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const unblock = useCallback((item) => {
    const authorId = String(item?.authorId || '').trim();
    if (!authorId || busyId) return;
    Alert.alert('解除屏蔽？', `之后可能再次看到 ${item.authorName || '该创作者'} 的公开作品。`, [
      { text: '取消', style: 'cancel' },
      {
        text: '解除屏蔽',
        onPress: async () => {
          setBusyId(authorId);
          try {
            await api.toggleBlock(authorId, 'unblock', item.authorName);
            setAuthors((current) => current.filter((author) => String(author.authorId || '').trim() !== authorId));
          } catch (err) {
            Alert.alert('操作失败', err?.cause || err?.message || '网络异常，请稍后重试');
          } finally {
            setBusyId('');
          }
        },
      },
    ]);
  }, [busyId]);

  const renderItem = useCallback(({ item }) => (
    <View style={styles.row}>
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>{String(item.authorName || '匿名拍友').slice(0, 2)}</Text>
      </View>
      <View style={styles.copy}>
        <Text style={styles.name} numberOfLines={1}>{item.authorName || '匿名拍友'}</Text>
        <Text style={styles.time}>屏蔽于 {formatRelativeTime(item.createdAt)}</Text>
      </View>
      <Pressable
        style={styles.unblock}
        onPress={() => unblock(item)}
        disabled={busyId === String(item.authorId || '').trim()}
      >
        <Text style={styles.unblockText}>{busyId === String(item.authorId || '').trim() ? '...' : '解除'}</Text>
      </Pressable>
    </View>
  ), [busyId, unblock]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Pressable style={styles.back} onPress={() => navigation.goBack()} accessibilityRole="button">
          <AppIcon name="chevronLeft" size={19} color={COLORS.ink} stroke={1.8} />
        </Pressable>
        <Text style={styles.title}>屏蔽管理</Text>
        <View style={styles.back} />
      </View>
      {loading ? <ActivityIndicator style={styles.loading} color={COLORS.accent} /> : null}
      {!loading && error ? (
        <View style={styles.empty}>
          <Text style={styles.error}>{error}</Text>
          <Pressable style={styles.retry} onPress={load}><Text style={styles.retryText}>重试</Text></Pressable>
        </View>
      ) : null}
      {!loading && !error ? (
        <FlatList
          data={authors}
          keyExtractor={(item) => String(item.authorId || '')}
          renderItem={renderItem}
          contentContainerStyle={authors.length ? styles.list : styles.emptyList}
          ListEmptyComponent={<Text style={styles.emptyText}>还没有屏蔽创作者</Text>}
        />
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  header: {
    height: 54,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: COLORS.line,
    backgroundColor: COLORS.panel,
  },
  back: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  backText: { color: COLORS.text, fontSize: 34, lineHeight: 36, fontWeight: '300' },
  title: { color: COLORS.text, fontSize: 16, fontWeight: '800' },
  loading: { marginTop: 26 },
  list: { padding: 12, gap: 8 },
  row: {
    minHeight: 68,
    padding: 12,
    borderRadius: 14,
    backgroundColor: COLORS.panel,
    borderWidth: 1,
    borderColor: COLORS.line,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: COLORS.accentSoft, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: COLORS.accent, fontSize: 13, fontWeight: '800' },
  copy: { flex: 1 },
  name: { color: COLORS.text, fontSize: 14, fontWeight: '700' },
  time: { color: COLORS.muted, marginTop: 4, fontSize: 11 },
  unblock: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, borderWidth: 1, borderColor: COLORS.line },
  unblockText: { color: COLORS.text, fontSize: 12, fontWeight: '700' },
  empty: { alignItems: 'center', padding: 28 },
  emptyList: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 28 },
  emptyText: { color: COLORS.muted, fontSize: 14 },
  error: { color: COLORS.danger, textAlign: 'center' },
  retry: { marginTop: 12, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 999, backgroundColor: COLORS.accent },
  retryText: { color: '#fff', fontWeight: '700' },
});
