import React, { useCallback, useState } from 'react';
import { Image, Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { COLORS } from '../config';
import VideoSurface from './VideoSurface';

const COL_GAP = 6;

const IMAGE_RATIO = 16 / 10;
const LIVE_CARD_COLOR = '#0d0d0d';

function clampColumns(value) {
  return Math.max(1, Math.min(3, value));
}

function MediaFallback({ kind }) {
  return (
    <View style={[styles.mediaWrap, styles.mediaFallback]}>
      <Text style={styles.fallbackTitle}>{kind === 'video' ? '视频暂不可用' : '图片暂不可用'}</Text>
      <Text style={styles.fallbackHint}>素材地址已失效或无法加载</Text>
    </View>
  );
}

function MediaCover({ item, playing }) {
  const [failed, setFailed] = useState(false);
  const handleError = useCallback(() => setFailed(true), []);

  if (!item) return null;
  if (failed) return <MediaFallback kind={item.kind} />;

  if (item.kind === 'video') {
    if (!item.url) return <MediaFallback kind="video" />;
    return (
      <View style={styles.mediaWrap}>
        <VideoSurface
          uri={item.url}
          style={styles.videoSurface}
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

  const imageUri = item.kind === 'live' ? (item.cover || item.url) : item.url;
  if (!imageUri) return <MediaFallback kind="image" />;

  if (item.kind === 'live' && playing && item.cover && item.url && item.url !== item.cover) {
    return (
      <View style={styles.mediaWrap}>
        <VideoSurface
          uri={item.url}
          style={styles.videoSurface}
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

  return (
    <View>
      <Image source={{ uri: imageUri }} style={styles.mediaWrap} resizeMode="cover" onError={handleError} />
      {item.kind === 'live' ? <Text style={styles.liveMark}>{item.cover ? '实况 · 动态' : '实况'}</Text> : null}
    </View>
  );
}

export default function MediaGallery({ media = [], onPressMedia, columns = 1, showAll = true, containerWidth }) {
  const { width: windowWidth } = useWindowDimensions();
  const normalized = Array.isArray(media) ? media : [];
  const [playingIndex, setPlayingIndex] = useState(-1);
  const toggleLive = useCallback((index, item) => {
    if (onPressMedia) {
      onPressMedia(item, index);
      return;
    }
    const playable = item?.kind === 'video'
      || (item?.kind === 'live' && item.cover && item.url && item.url !== item.cover);
    if (!playable) {
      onPressMedia?.(item, index);
      return;
    }
    setPlayingIndex((current) => (current === index ? -1 : index));
  }, [onPressMedia]);

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
        return (
          <Pressable
            key={`${item.url}-${idx}`}
            style={renderStyle(idx, isLast)}
            onPress={() => toggleLive(idx, item)}
          >
            <MediaCover item={item} playing={playingIndex === idx} />
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
