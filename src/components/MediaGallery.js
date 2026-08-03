import React from 'react';
import { Dimensions, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { COLORS } from '../config';
import VideoSurface from './VideoSurface';

const COL_GAP = 6;
const CARD_WIDTH = Dimensions.get('window').width;

const videoStyle = {
  width: '100%',
  aspectRatio: 16 / 10,
};

function MediaCover({ item }) {
  if (!item) return null;

  if (item.kind === 'video') {
    return (
      <View style={[styles.mediaWrap, styles.videoWrap]}>
        <VideoSurface uri={item.url} style={videoStyle} />
        {item.duration > 0 ? (
          <View style={styles.durationBadge}>
            <Text style={styles.durationText}>{Math.max(1, Math.floor(item.duration))}s</Text>
          </View>
        ) : null}
      </View>
    );
  }

  // live kind is visualized as image first frame + tag
  return (
    <View>
      <Image source={{ uri: item.url }} style={styles.mediaWrap} resizeMode="cover" />
      {item.kind === 'live' ? <Text style={styles.liveMark}>实况</Text> : null}
    </View>
  );
}

export default function MediaGallery({ media = [], onPressMedia, columns = 1, showAll = true }) {
  if (!media.length) return null;
  const list = showAll ? media : media.slice(0, columns === 2 ? 2 : 1);

  const width = columns > 1 ? (CARD_WIDTH - 48 - COL_GAP) / 2 : CARD_WIDTH - 32;

  const renderStyle = (item, index, isLast) => ({
    width: columns > 1 && list.length === 2 ? width : '100%',
    marginRight: columns > 1 && index % columns === 0 ? COL_GAP : 0,
    marginBottom: isLast ? 0 : COL_GAP,
  });

  return (
    <View style={styles.grid}>
      {list.map((item, idx) => {
        const isLast = idx === list.length - 1;
        return (
          <Pressable key={`${item.url}-${idx}`} style={renderStyle(item, idx, isLast)} onPress={onPressMedia}>
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
    height: 220,
    borderRadius: 10,
    backgroundColor: '#e8e8e8',
  },
  videoWrap: {
    backgroundColor: '#000',
    borderRadius: 10,
    overflow: 'hidden',
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
