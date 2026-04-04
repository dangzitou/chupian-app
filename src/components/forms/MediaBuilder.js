import React from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { COLORS, MEDIA_KINDS } from '../../config';

const KIND_LABEL = {
  [MEDIA_KINDS.IMAGE]: '图片',
  [MEDIA_KINDS.VIDEO]: '视频',
  [MEDIA_KINDS.LIVE]: '实况',
};

export default function MediaBuilder({ mediaList, onRemove }) {
  if (!mediaList.length) {
    return <Text style={styles.empty}>建议上传 1~9 张图片/视频，内容更容易被发现</Text>;
  }

  return (
    <View style={styles.row}>
      {mediaList.map((item, idx) => (
        <View key={`${item.uri}-${idx}`} style={styles.card}>
          <Image source={{ uri: item.uri }} style={styles.image} resizeMode="cover" />
          <Text style={styles.kind}>{KIND_LABEL[item.kind] || item.kind}</Text>
          {item.kind === MEDIA_KINDS.VIDEO && item.duration ? (
            <Text style={styles.tag}>{Math.max(1, Math.floor(item.duration / 1000 || item.duration || 0))}s</Text>
          ) : null}

          <Pressable style={styles.delete} onPress={() => onRemove(idx)}>
            <Text style={styles.deleteText}>−</Text>
          </Pressable>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  card: {
    width: 112,
    height: 112,
    borderRadius: 10,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    backgroundColor: COLORS.card,
    position: 'relative',
  },
  image: {
    width: '100%',
    height: '100%',
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
  empty: {
    color: COLORS.muted,
    fontSize: 12,
    marginTop: 6,
    marginBottom: 4,
  },
});
