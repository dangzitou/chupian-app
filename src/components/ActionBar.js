import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { COLORS } from '../config';

export default function ActionBar({
  likes = 0,
  favorites = 0,
  comments = 0,
  liked = false,
  favorited = false,
  onLike,
  onFavorite,
  onComment,
}) {
  return (
    <View style={styles.row}>
      <Pressable style={styles.item} onPress={onLike} android_ripple={{ color: '#ddd' }}>
        <Text style={[styles.icon, liked && styles.active]}>{liked ? '❤️' : '🤍'}</Text>
        <Text style={[styles.text, liked && styles.activeText]}>{likes}</Text>
      </Pressable>

      <Pressable style={styles.item} onPress={onComment} android_ripple={{ color: '#ddd' }}>
        <Text style={styles.icon}>💬</Text>
        <Text style={styles.text}>{comments}</Text>
      </Pressable>

      <Pressable style={styles.item} onPress={onFavorite} android_ripple={{ color: '#ddd' }}>
        <Text style={[styles.icon, favorited && styles.active]}>{favorited ? '🔖' : '📌'}</Text>
        <Text style={[styles.text, favorited && styles.activeText]}>{favorites}</Text>
      </Pressable>

      <View style={[styles.item, styles.shareItem]}>
        <Text style={styles.icon}>↗️</Text>
        <Text style={styles.text}>分享</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 10,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 20,
  },
  shareItem: {
    opacity: 0.9,
  },
  icon: { fontSize: 16, color: COLORS.ink },
  text: { fontSize: 12.5, color: COLORS.mutedText || COLORS.muted },
  active: { color: COLORS.accent },
  activeText: { color: COLORS.accent, fontWeight: '700' },
});
