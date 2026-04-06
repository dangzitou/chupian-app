import { useCallback, useRef } from 'react';

function clampNonNegative(value, delta) {
  const base = Number(value || 0);
  return Math.max(0, base + Number(delta || 0));
}

function toBool(value) {
  return Boolean(value);
}

function defaultBusyKey(postId, _stateField, action) {
  if (action) return `${String(postId)}:${String(action)}`;
  return String(postId);
}

export function usePostListActions({
  getPostById,
  patchById,
  setBusyForPost,
  isBusyExternal,
  busyKey,
}) {
  const localBusyRef = useRef(new Set());
  const resolveBusyKey = busyKey || defaultBusyKey;

  const isBusy = useCallback((postId, stateField = '', action = '') => {
    const normalizedId = String(postId);
    const key = resolveBusyKey(normalizedId, stateField, action);
    return localBusyRef.current.has(key)
      || Boolean(isBusyExternal?.(key))
      || Boolean(isBusyExternal?.(normalizedId));
  }, [isBusyExternal, resolveBusyKey]);

  const setBusy = useCallback((postId, next, stateField = '', action = '') => {
    const normalizedId = String(postId);
    const key = resolveBusyKey(normalizedId, stateField, action);
    const nextSet = new Set(localBusyRef.current);
    if (next) {
      nextSet.add(key);
    } else {
      nextSet.delete(key);
    }
    localBusyRef.current = nextSet;

    if (typeof setBusyForPost === 'function') {
      setBusyForPost(normalizedId, next);
      if (key !== normalizedId) {
        setBusyForPost(key, next);
      }
    }
  }, [setBusyForPost, resolveBusyKey]);

  const applyOptimistic = useCallback((postId, metricField, stateField, nextState) => {
    patchById(postId, (item) => {
      const currentActive = toBool(item[stateField]);
      const targetActive = Boolean(nextState ?? !currentActive);
      const baseCount = Number(item[metricField] || 0);
      return {
        ...item,
        [stateField]: targetActive,
        [metricField]: clampNonNegative(baseCount, targetActive ? 1 : -1),
      };
    });
  }, [patchById]);

  const patchFromServer = useCallback((postId, metricField, stateField, nextState, fallbackBase, fresh) => {
    const fallbackCount = clampNonNegative(Number(fallbackBase?.[metricField] || 0), nextState ? 1 : -1);
    patchById(postId, {
      [metricField]: Number(fresh?.[metricField] ?? fallbackCount),
      [stateField]: Boolean(fresh?.[stateField] ?? nextState),
    });
  }, [patchById]);

  const rollback = useCallback((postId, metricField, stateField, fallbackBase) => {
    patchById(postId, {
      [metricField]: Number(fallbackBase?.[metricField] || 0),
      [stateField]: toBool(fallbackBase?.[stateField]),
    });
  }, [patchById]);

  const toggle = useCallback(async ({
    postId,
    metricField,
    stateField,
    actionResolver,
  }) => {
    const id = String(postId);
    if (isBusy(id, stateField, stateField)) return;

    const base = getPostById?.(id);
    if (!base) return;

    const nextState = !toBool(base[stateField]);
    setBusy(id, true, stateField, stateField);
    applyOptimistic(id, metricField, stateField, nextState);

    try {
      const fresh = await actionResolver({
        post: base,
        postId: id,
        next: nextState,
      });
      patchFromServer(id, metricField, stateField, nextState, base, fresh);
    } catch (_err) {
      rollback(id, metricField, stateField, base);
    } finally {
      setBusy(id, false, stateField, stateField);
    }
  }, [applyOptimistic, getPostById, isBusy, patchFromServer, rollback, setBusy]);

  return {
    isBusy,
    toggleAction: toggle,
  };
}
