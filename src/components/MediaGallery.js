import React from 'react';
import { Dimensions, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { COLORS } from '../config';
import VideoSurface from './VideoSurface';

const COL_GAP = 6;
const CARD_WIDTH = Dimensions.get('window').width;

const IMAGE_RATIO = 16 / 10;
const LIVE_CARD_COLOR = '#0d0d0d';

function clampColumns(value) {
  return Math.max(1, Math.min(3, value));
}

function MediaCover({ item }) {
  if (!item) return null;

  if (item.kind === 'video') {
    return (
      <View style={styles.mediaWrap}>
        <VideoSurface uri={item.url} style={styles.videoSurface} />
        {item.duration > 0 ? (
          <View style={styles.durationBadge}>
            <Text style={styles.durationText}>{Math.max(1, Math.floor(item.duration))}s</Text>
          </View>
        ) : null}
      </View>
    );
  }

  return (
    <View>
      <Image source={{ uri: item.url }} style={styles.mediaWrap} resizeMode="cover" />
      {item.kind === 'live' ? <Text style={styles.liveMark}>实况</Text> : null}
    </View>
  );
}

export default function MediaGallery({ media = [], onPressMedia, columns = 1, showAll = true, containerWidth }) {
  const normalized = Array.isArray(media) ? media : [];
  if (!normalized.length) return null;

  const list = showAll ? normalized : normalized.slice(0, columns > 1 ? 4 : 1);
  const activeColumns = clampColumns(columns);
  const visibleCols = activeColumns > 1 ? Math.min(activeColumns, list.length) : 1;
  const maxWidth = Number.isFinite(containerWidth) && containerWidth > 0
    ? containerWidth
    : CARD_WIDTH - 32;
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
            onPress={onPressMedia}
          >
            <MediaCover item={item} />
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
});
