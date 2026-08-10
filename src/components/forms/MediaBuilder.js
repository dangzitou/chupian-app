import React from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { COLORS, MEDIA_KINDS } from '../../config';
import VideoSurface from '../VideoSurface';
import AppIcon from '../AppIcon';

const KIND_LABEL = {
  [MEDIA_KINDS.IMAGE]: '图片',
  [MEDIA_KINDS.VIDEO]: '视频',
  [MEDIA_KINDS.LIVE]: '实况',
};

const MAX_MEDIA = 9;

function getMediaKey(item) {
  return String(item?.id || item?.assetId || item?.uri || item?.url || 'media');
}

function toNumber(value) {
  const valueNumber = Number(value || 0);
  return Number.isFinite(valueNumber) ? valueNumber : 0;
}

function formatDuration(value) {
  const normalized = toNumber(value);
  if (!normalized) return null;
  const seconds = normalized > 500 ? Math.round(normalized / 1000) : Math.round(normalized);
  return `${Math.max(1, seconds)}s`;
}

function PreviewError({ kind, onRetry }) {
  return (
    <View style={styles.previewError}>
      <Text style={styles.previewErrorTitle}>{KIND_LABEL[kind] || '素材'}预览失败</Text>
      <Pressable
        style={({ pressed }) => [styles.retry, pressed && styles.retryPressed]}
        onPress={onRetry}
        accessibilityRole="button"
        accessibilityLabel="重新加载素材预览"
      >
        <Text style={styles.retryText}>重试</Text>
      </Pressable>
    </View>
  );
}

export default function MediaBuilder({
  mediaList,
  onRemove,
  onMove,
  coverIndex = -1,
  onSetCover,
}) {
  const mediaItems = Array.isArray(mediaList) ? mediaList : [];
  const [failedKeys, setFailedKeys] = React.useState(() => new Set());
  const [loadedKeys, setLoadedKeys] = React.useState(() => new Set());
  const canSetCover = typeof onSetCover === 'function';
  const canMove = typeof onMove === 'function';
  const safeCoverIndex = Number.isInteger(Number(coverIndex)) ? Number(coverIndex) : -1;

  const markPreviewFailed = React.useCallback((item) => {
    const key = getMediaKey(item);
    setLoadedKeys((current) => {
      if (!current.has(key)) return current;
      const next = new Set(current);
      next.delete(key);
      return next;
    });
    setFailedKeys((current) => {
      if (current.has(key)) return current;
      const next = new Set(current);
      next.add(key);
      return next;
    });
  }, []);

  const retryPreview = React.useCallback((item) => {
    const key = getMediaKey(item);
    setLoadedKeys((current) => {
      if (!current.has(key)) return current;
      const next = new Set(current);
      next.delete(key);
      return next;
    });
    setFailedKeys((current) => {
      if (!current.has(key)) return current;
      const next = new Set(current);
      next.delete(key);
      return next;
    });
  }, []);

  const removeMedia = React.useCallback((index) => {
    const item = mediaItems[index];
    const key = getMediaKey(item);
    setFailedKeys((current) => {
      if (!current.has(key)) return current;
      const next = new Set(current);
      next.delete(key);
      return next;
    });
    onRemove?.(index);
  }, [mediaItems, onRemove]);

  const markPreviewLoaded = React.useCallback((item) => {
    const key = getMediaKey(item);
    setLoadedKeys((current) => {
      if (current.has(key)) return current;
      const next = new Set(current);
      next.add(key);
      return next;
    });
  }, []);

  const moveMedia = React.useCallback((index, direction) => {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= mediaItems.length || targetIndex === index) return;
    onMove?.(index, targetIndex);
  }, [mediaItems.length, onMove]);

  if (!mediaItems.length) {
    return (
      <View style={styles.emptyWrap}>
        <Text style={styles.empty}>先选一张照片或视频，拍摄参数可以稍后补充</Text>
        <Text style={styles.emptyHint}>支持静态图片、实况和视频，最多 {MAX_MEDIA} 个</Text>
      </View>
    );
  }

  return (
    <View>
      <View style={styles.summaryRow}>
        <Text style={styles.summary}>已选 {mediaItems.length}/{MAX_MEDIA}</Text>
        <Text style={styles.summaryHint}>图片 · 实况 · 视频</Text>
      </View>
      <View style={styles.row}>
      {mediaItems.map((item, idx) => {
        const durationText = formatDuration(item.duration);
        const isCover = safeCoverIndex === idx;
        const isVideo = item.kind === MEDIA_KINDS.VIDEO;
        const mediaKey = getMediaKey(item);
        const previewFailed = failedKeys.has(mediaKey);
        const previewLoading = !isVideo && !loadedKeys.has(mediaKey);

        return (
          <View key={`${mediaKey}-${idx}`} style={styles.mediaItem}>
            <View style={styles.card}>
            {previewFailed ? (
              <PreviewError kind={item.kind} onRetry={() => retryPreview(item)} />
            ) : isVideo ? (
              <VideoSurface uri={item.uri} style={styles.image} onError={() => markPreviewFailed(item)} />
            ) : (
              <>
                <Image
                  source={{ uri: item.uri }}
                  style={styles.image}
                  resizeMode="cover"
                  onLoadStart={() => {
                    setLoadedKeys((current) => {
                      if (!current.has(mediaKey)) return current;
                      const next = new Set(current);
                      next.delete(mediaKey);
                      return next;
                    });
                  }}
                  onLoad={() => markPreviewLoaded(item)}
                  onError={() => markPreviewFailed(item)}
                  accessibilityLabel={`${KIND_LABEL[item.kind] || '素材'}预览`}
                />
                {previewLoading ? (
                  <View style={styles.previewLoading} pointerEvents="none">
                    <ActivityIndicator size="small" color={COLORS.accent} />
                  </View>
                ) : null}
              </>
            )}
            <Text style={styles.kind}>{KIND_LABEL[item.kind] || item.kind}</Text>
            <Text style={styles.badge}>
              {idx + 1}
            </Text>

            {durationText ? (
              <Text style={styles.tag}>{durationText}</Text>
            ) : null}

            {isCover ? (
              <View style={styles.coverMark}>
                <Text style={styles.coverMarkText}>封面</Text>
              </View>
            ) : null}

            {canSetCover && !isCover && mediaList.length > 1 ? (
              <Pressable
                style={({ pressed }) => [styles.coverBtn, pressed && styles.coverBtnPressed]}
                onPress={() => onSetCover?.(idx)}
                accessibilityRole="button"
                accessibilityLabel={`将第 ${idx + 1} 个素材设为封面`}
                accessibilityState={{ selected: isCover }}
                hitSlop={6}
              >
                <Text style={styles.coverBtnText}>设为封面</Text>
              </Pressable>
            ) : null}

            <Pressable
              style={({ pressed }) => [styles.delete, pressed && styles.deletePressed]}
              onPress={() => removeMedia(idx)}
              accessibilityRole="button"
              accessibilityLabel={`删除第 ${idx + 1} 个素材`}
              hitSlop={6}
            >
              <AppIcon name="close" size={12} color={COLORS.white} stroke={2} />
            </Pressable>
            </View>
            {canMove ? (
              <View style={styles.orderControls}>
                <Pressable
                  style={({ pressed }) => [styles.orderBtn, idx === 0 && styles.orderBtnDisabled, pressed && styles.orderBtnPressed]}
                  onPress={() => moveMedia(idx, -1)}
                  disabled={idx === 0}
                  accessibilityRole="button"
                  accessibilityLabel={`将第 ${idx + 1} 个素材前移`}
                >
                  <Text style={[styles.orderText, idx === 0 && styles.orderTextDisabled]}>前移</Text>
                </Pressable>
                <Pressable
                  style={({ pressed }) => [styles.orderBtn, idx === mediaItems.length - 1 && styles.orderBtnDisabled, pressed && styles.orderBtnPressed]}
                  onPress={() => moveMedia(idx, 1)}
                  disabled={idx === mediaItems.length - 1}
                  accessibilityRole="button"
                  accessibilityLabel={`将第 ${idx + 1} 个素材后移`}
                >
                  <Text style={[styles.orderText, idx === mediaItems.length - 1 && styles.orderTextDisabled]}>后移</Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        );
      })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  mediaItem: { width: 112, gap: 4 },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  summary: {
    color: COLORS.text,
    fontSize: 12,
    fontWeight: '700',
  },
  summaryHint: {
    color: COLORS.muted,
    fontSize: 11,
  },
  card: {
    width: 112,
    height: 112,
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    backgroundColor: COLORS.card,
    position: 'relative',
  },
  orderControls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 4,
  },
  orderBtn: {
    flex: 1,
    minHeight: 24,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6,
    backgroundColor: COLORS.panel,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
  },
  orderBtnDisabled: { opacity: 0.42 },
  orderBtnPressed: { transform: [{ scale: 0.96 }] },
  orderText: { color: COLORS.accent, fontSize: 10.5, fontWeight: '700' },
  orderTextDisabled: { color: COLORS.muted },
  image: {
    width: '100%',
    height: '100%',
  },
  previewLoading: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(238,234,230,0.72)',
  },
  kind: {
    position: 'absolute',
    left: 6,
    top: 6,
    backgroundColor: 'rgba(0,0,0,0.62)',
    color: COLORS.onAccent,
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 2,
    fontSize: 10,
    overflow: 'hidden',
  },
  tag: {
    position: 'absolute',
    right: 6,
    bottom: 6,
    backgroundColor: 'rgba(0,0,0,0.62)',
    color: COLORS.onAccent,
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 2,
    fontSize: 10,
  },
  delete: {
    position: 'absolute',
    right: 4,
    top: 4,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1d1d1d',
    opacity: 0.88,
  },
  deleteText: {
    color: '#fff',
    fontSize: 16,
    lineHeight: 18,
    fontWeight: '700',
  },
  deletePressed: {
    opacity: 0.6,
    transform: [{ scale: 0.92 }],
  },
  badge: {
    position: 'absolute',
    right: 6,
    top: 6,
    fontSize: 10,
    color: COLORS.onAccent,
    backgroundColor: 'rgba(0,0,0,0.48)',
    borderRadius: 999,
    paddingHorizontal: 6,
    paddingVertical: 1,
    fontWeight: '700',
  },
  empty: {
    color: COLORS.muted,
    fontSize: 12,
    marginTop: 6,
  },
  emptyWrap: {
    marginTop: 6,
    marginBottom: 4,
    gap: 3,
  },
  emptyHint: {
    color: COLORS.muted,
    fontSize: 11,
  },
  previewError: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
    backgroundColor: '#eeeae6',
  },
  previewErrorTitle: {
    color: COLORS.text,
    fontSize: 11,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 8,
  },
  retry: {
    minHeight: 28,
    paddingHorizontal: 10,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.accent,
  },
  retryText: {
    color: COLORS.onAccent,
    fontSize: 11,
    fontWeight: '700',
  },
  retryPressed: {
    opacity: 0.72,
    transform: [{ scale: 0.96 }],
  },
  coverMark: {
    position: 'absolute',
    left: 6,
    bottom: 6,
    backgroundColor: COLORS.accent,
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  coverMarkText: {
    color: COLORS.onAccent,
    fontSize: 10,
    fontWeight: '700',
  },
  coverBtn: {
    position: 'absolute',
    left: 6,
    top: 28,
    backgroundColor: 'rgba(0,0,0,0.74)',
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  coverBtnText: {
    color: COLORS.onAccent,
    fontSize: 10,
    fontWeight: '700',
  },
  coverBtnPressed: {
    opacity: 0.68,
    transform: [{ scale: 0.97 }],
  },
});
