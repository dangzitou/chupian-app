import { useCallback, useRef, useState } from 'react';

export function useFeedList(fetcher, options = {}) {
  const pageSize = Number.isFinite(options.limit) ? Number(options.limit) : 12;

  const normalizeUniquePosts = (nextPosts) => {
    const list = [];
    const seen = new Set();
    for (const item of nextPosts) {
      const id = item?.id;
      if (id == null) continue;
      const key = String(id);
      if (seen.has(key)) continue;
      seen.add(key);
      list.push(item);
    }
    return list;
  };

  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);
  const [nextCursor, setNextCursor] = useState(null);
  const [hasMore, setHasMore] = useState(true);
  const [sort, setSort] = useState(options.sort || 'latest');
  const [q, setQ] = useState(options.q || '');
  const [tag, setTag] = useState(options.tag || '');
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState(null);

  const busyIdsRef = useRef(new Set());
  const requestSeqRef = useRef(0);

  const ensureLoadingState = useCallback((append) => {
    if (append) {
      setLoadingMore(true);
      return;
    }
    if (!refreshing) setLoading(true);
  }, [refreshing]);

  const load = useCallback(async ({
    append = false,
    cursor = null,
    nextSort = sort,
    nextQ = q,
    nextTag = tag,
  } = {}) => {
        if (append && loadingMore) return;

    const nextCursor = cursor || '';
    const normalizedSort = nextSort === 'hot' ? 'hot' : 'latest';
    const normalizedQ = String(nextQ || '').trim();
    const normalizedTag = String(nextTag || '').trim();
    const useLimit = Math.min(Math.max(pageSize, 1), 40);
    const requestSeq = ++requestSeqRef.current;

    ensureLoadingState(append);

    try {
      const payload = await fetcher({
        sort: normalizedSort,
        q: normalizedQ,
        tag: normalizedTag,
        cursor: nextCursor,
        limit: useLimit,
      });

      const nextPosts = Array.isArray(payload?.posts) ? payload.posts : [];
      const nextCursorFromApi = payload?.nextCursor || null;
      const hasMoreFromApi = payload?.hasMore == null ? Boolean(nextCursorFromApi) : Boolean(payload.hasMore);

      if (requestSeq !== requestSeqRef.current) return;

      setPosts((prev) => {
        if (!append) return nextPosts;
        const merged = normalizeUniquePosts([...prev, ...nextPosts]);
        return merged;
      });
      setNextCursor(nextCursorFromApi);
      setHasMore(hasMoreFromApi);
      setSort(normalizedSort);
      setQ(normalizedQ);
      setTag(normalizedTag);
      setTotal(Number(payload?.total || 0));
      setStats(payload?.stats || null);
      setError(null);
    } catch (e) {
      if (requestSeq !== requestSeqRef.current) return;
      setError(e.message || 'network error');
    } finally {
      if (requestSeq !== requestSeqRef.current) return;
      setLoading(false);
      setRefreshing(false);
      setLoadingMore(false);
    }
  }, [ensureLoadingState, fetcher, loadingMore, pageSize, q, sort, tag]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    return load({ append: false, cursor: null, nextSort: sort, nextQ: q, nextTag: tag });
  }, [load, sort, q, tag]);

  const onEndReached = useCallback(() => {
    if (!hasMore || loadingMore || !nextCursor || loading) return;
    return load({
      append: true,
      cursor: nextCursor,
      nextSort: sort,
      nextQ: q,
      nextTag: tag,
    });
  }, [hasMore, loadingMore, loading, nextCursor, load, sort, q, tag]);

  const patchById = useCallback((postId, patch) => {
    const targetId = String(postId);
    setPosts((prev) => prev.map((item) => {
      if (String(item.id) !== targetId) return item;
      const next = typeof patch === 'function' ? patch(item) : patch;
      return { ...item, ...next };
    }));
  }, []);

  const setBusyForPost = useCallback((postId, active) => {
    const key = String(postId);
    const next = new Set(busyIdsRef.current);
    if (active) {
      next.add(key);
    } else {
      next.delete(key);
    }
    busyIdsRef.current = next;
  }, []);

  const isPostBusy = useCallback((postId) => busyIdsRef.current.has(String(postId)), []);

  const clearFeed = useCallback(() => {
    setPosts([]);
    setNextCursor(null);
    setHasMore(true);
    setError(null);
    setTotal(0);
    setStats(null);
  }, []);

  return {
    posts,
    loading,
    refreshing,
    loadingMore,
    error,
    nextCursor,
    hasMore,
    sort,
    q,
    tag,
    total,
    stats,
    setSort,
    setQ,
    setTag,
    load,
    onRefresh,
    onEndReached,
    patchById,
    clearFeed,
    setBusyForPost,
    isPostBusy,
  };
}
