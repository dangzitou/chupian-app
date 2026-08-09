import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Image, Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { COLORS } from '../config';
import VideoSurface from './VideoSurface';

const COL_GAP = 6;

const IMAGE_RATIO = 16 / 10;
const LIVE_CARD_COLOR = '#0d0d0d';

function clampColumns(value) {
  return Math.max(1, Math.min(3, value));
}

function getMediaKey(item, index) {
  return `${item?.kind || 'media'}:${item?.url || ''}:${item?.cover || ''}:${index}`;
}

function getMediaRatio(item) {
  const width = Number(item?.width);
  const height = Number(item?.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return IMAGE_RATIO;
  }
  return Math.min(Math.max(width / height, 0.75), 1.78);
}

function MediaFallback({ kind, ratio = IMAGE_RATIO, title, hint }) {
  return (
    <View style={[styles.mediaWrap, { aspectRatio: ratio }, styles.mediaFallback]}>
      <Text style={styles.fallbackTitle}>
        {title || (kind === 'video' ? '视频暂不可用' : kind === 'live' ? '实况暂不可用' : '图片暂不可用')}
      </Text>
      <Text style={styles.fallbackHint}>{hint || '素材地址已失效或无法加载'}</Text>
    </View>
  );
}

function MediaCover({ item, playing, ratio, retryVersion = 0, onMediaError }) {
  const [failed, setFailed] = useState(false);
  const handleError = useCallback(() => {
    setFailed(true);
    onMediaError?.();
  }, [onMediaError]);
  useEffect(() => {
    setFailed(false);
  }, [item?.kind, item?.url, item?.cover, retryVersion]);
  const mediaStyle = [styles.mediaWrap, { aspectRatio: ratio }];
  const videoStyle = [styles.videoSurface, { aspectRatio: ratio }];

  if (!item) return null;
  if (failed) return <MediaFallback kind={item.kind} ratio={ratio} />;

  if (item.kind === 'video') {
    if (!item.url) return <MediaFallback kind="video" ratio={ratio} />;
    if (!playing) {
      const posterUri = item.cover || item.thumbnail;
      if (!posterUri) {
        return <MediaFallback kind="video" ratio={ratio} title="视频" hint="点击播放" />;
      }
      return (
        <View style={mediaStyle}>
          <Image
            source={{ uri: posterUri }}
            style={styles.posterImage}
            resizeMode="cover"
            onError={handleError}
          />
          <View style={styles.posterShade} pointerEvents="none" />
          {item.duration > 0 ? (
            <View style={styles.durationBadge}>
              <Text style={styles.durationText}>{Math.max(1, Math.floor(item.duration))}s</Text>
            </View>
          ) : null}
          <Text style={styles.playBadge}>▶</Text>
        </View>
      );
    }
    return (
      <View style={mediaStyle}>
        <VideoSurface
          uri={item.url}
          style={videoStyle}
          shouldPlay={playing}
          controls={playing}
          poster={item.cover || item.thumbnail}
          onError={handleError}
        />
        {item.duration > 0 ? (
          <View style={styles.durationBadge}>
            <Text style={styles.durationText}>{Math.max(1, Math.floor(item.duration))}s</Text>
          </View>
        ) : null}
        {playing ? <Text style={styles.liveMark}>视频 · 播放中</Text> : <Text style={styles.playBadge}>▶</Text>}
      </View>
    );
  }

  const imageUri = item.kind === 'live' ? item.cover : item.url;

  if (item.kind === 'live' && playing && item.url) {
    return (
      <View style={mediaStyle}>
        <VideoSurface
          uri={item.url}
          style={videoStyle}
          shouldPlay
          loop
          controls
          poster={item.cover}
          onError={handleError}
        />
        <Text style={styles.liveMark}>实况 · 播放中</Text>
      </View>
    );
  }

  if (!imageUri) return <MediaFallback kind={item.kind === 'live' ? 'live' : 'image'} ratio={ratio} hint={item.kind === 'live' ? '点击播放' : undefined} title={item.kind === 'live' ? '实况' : undefined} />;

  return (
    <View>
      <Image source={{ uri: imageUri }} style={mediaStyle} resizeMode="cover" onError={handleError} />
      {item.kind === 'live' ? <Text style={styles.liveMark}>{item.cover ? '实况 · 动态' : '实况'}</Text> : null}
    </View>
  );
}

export default function MediaGallery({ media = [], onPressMedia, onPressImage, onDoubleTap, columns = 1, showAll = true, containerWidth }) {
  const { width: windowWidth } = useWindowDimensions();
  const normalized = Array.isArray(media) ? media : [];
  const [playingIndex, setPlayingIndex] = useState(-1);
  const [failedKeys, setFailedKeys] = useState(() => new Set());
  const [retryVersions, setRetryVersions] = useState({});
  const tapRef = useRef({ at: 0, index: -1, item: null, timer: null });
  const toggleLive = useCallback((index, item) => {
    const playable = item?.kind === 'video'
      || (item?.kind === 'live' && item.cover && item.url && item.url !== item.cover);
    if (!playable) {
      if (onPressMedia) onPressMedia(item, index);
      else onPressImage?.(item, index);
      return;
    }
    if (onPressMedia) {
      onPressMedia(item, index);
      return;
    }
    setPlayingIndex((current) => (current === index ? -1 : index));
  }, [onPressImage, onPressMedia]);

  const markMediaFailed = useCallback((key) => {
    setFailedKeys((current) => {
      if (current.has(key)) return current;
      const next = new Set(current);
      next.add(key);
      return next;
    });
  }, []);

  const retryMedia = useCallback((key) => {
    setFailedKeys((current) => {
      if (!current.has(key)) return current;
      const next = new Set(current);
      next.delete(key);
      return next;
    });
    setRetryVersions((current) => ({
      ...current,
      [key]: Number(current[key] || 0) + 1,
    }));
  }, []);

  useEffect(() => () => {
    if (tapRef.current.timer) clearTimeout(tapRef.current.timer);
  }, []);

  const handleMediaPress = useCallback((index, item, key) => {
    if (failedKeys.has(key)) {
      retryMedia(key);
      return;
    }
    if (!onDoubleTap) {
      toggleLive(index, item);
      return;
    }

    const now = Date.now();
    const previous = tapRef.current;
    if (previous.timer && previous.index === index && now - previous.at <= 280) {
      clearTimeout(previous.timer);
      tapRef.current = { at: 0, index: -1, item: null, timer: null };
      onDoubleTap(item, index);
      return;
    }

    if (previous.timer) {
      clearTimeout(previous.timer);
      if (previous.item && previous.index >= 0) toggleLive(previous.index, previous.item);
    }

    const timer = setTimeout(() => {
      if (tapRef.current.index !== index || tapRef.current.at !== now) return;
      tapRef.current = { at: 0, index: -1, item: null, timer: null };
      toggleLive(index, item);
    }, 280);
    tapRef.current = { at: now, index, item, timer };
  }, [failedKeys, onDoubleTap, retryMedia, toggleLive]);

  if (!normalized.length) return null;

  const list = showAll ? normalized : normalized.slice(0, columns > 1 ? 4 : 1);
  const activeColumns = clampColumns(columns);
  const visibleCols = activeColumns > 1 ? Math.min(activeColumns, list.length) : 1;
  const shellWidth = Platform.OS === 'web' ? Math.min(windowWidth, 480) : windowWidth;
  const maxWidth = Number.isFinite(containerWidth) && containerWidth > 0
    ? containerWidth
    : Math.max(0, shellWidth - 32);
  const width = visibleCols === 1
    ? maxWidth
    : (maxWidth - COL_GAP * (visibleCols - 1)) / visibleCols;

  const renderStyle = (index, isLast) => ({
    width,
    marginRight: visibleCols > 1 && index % visibleCols !== visibleCols - 1 ? COL_GAP : 0,
    marginBottom: isLast ? 0 : COL_GAP,
  });

  return (
    <View style={styles.grid}>
      {list.map((item, idx) => {
        const isLast = idx === list.length - 1;
        const key = getMediaKey(item, idx);
        const failed = failedKeys.has(key);
        return (
          <Pressable
            key={key}
            style={renderStyle(idx, isLast)}
            onPress={() => handleMediaPress(idx, item, key)}
            accessibilityRole="button"
            accessibilityLabel={failed ? '重新加载素材' : (item.kind === 'video' ? '播放视频' : (item.kind === 'live' ? '播放实况' : '查看照片'))}
            accessibilityHint={onDoubleTap ? '双击点赞，单击查看或播放' : undefined}
          >
            <MediaCover
              item={item}
              ratio={getMediaRatio(item)}
              playing={playingIndex === idx}
              retryVersion={retryVersions[key] || 0}
              onMediaError={() => markMediaFailed(key)}
            />
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 10,
  },
  mediaWrap: {
    width: '100%',
    aspectRatio: IMAGE_RATIO,
    borderRadius: 10,
    backgroundColor: '#e8e8e8',
  },
  posterImage: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 10,
  },
  posterShade: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.12)',
  },
  mediaFallback: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  fallbackTitle: {
    color: COLORS.muted,
    fontSize: 12,
    fontWeight: '700',
  },
  fallbackHint: {
    color: COLORS.muted,
    fontSize: 10.5,
    marginTop: 4,
    textAlign: 'center',
  },
  videoSurface: {
    width: '100%',
    aspectRatio: IMAGE_RATIO,
    borderRadius: 10,
    backgroundColor: LIVE_CARD_COLOR,
  },
  durationBadge: {
    position: 'absolute',
    right: 8,
    bottom: 8,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  durationText: { color: COLORS.onAccent, fontSize: 11, fontWeight: '700' },
  liveMark: {
    position: 'absolute',
    left: 8,
    top: 8,
    backgroundColor: 'rgba(0,0,0,0.6)',
    color: COLORS.onAccent,
    fontSize: 11,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    overflow: 'hidden',
    fontWeight: '700',
  },
  playBadge: {
    position: 'absolute',
    left: '50%',
    top: '50%',
    width: 34,
    height: 34,
    marginLeft: -17,
    marginTop: -17,
    borderRadius: 17,
    backgroundColor: 'rgba(0,0,0,0.62)',
    color: COLORS.onAccent,
    fontSize: 15,
    lineHeight: 34,
    textAlign: 'center',
    overflow: 'hidden',
  },
});
