import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { COLORS } from '../config';
import { formatCount } from '../utils/format';

export default function ActionBar({
  likes = 0,
  favorites = 0,
  comments = 0,
  liked = false,
  favorited = false,
  onShare,
  onLike,
  onFavorite,
  onComment,
  likeBusy = false,
  favoriteBusy = false,
}) {
  const actionItems = [
    {
      key: 'like',
      active: liked,
      disabled: likeBusy || !onLike,
      icon: liked ? '❤️' : '♡',
      label: formatCount(likes),
      onPress: onLike,
      showBusy: likeBusy,
    },
    {
      key: 'comment',
      disabled: !onComment,
      icon: '💬',
      label: formatCount(comments),
      onPress: onComment,
    },
    {
      key: 'favorite',
      active: favorited,
      disabled: favoriteBusy || !onFavorite,
      icon: favorited ? '⭐' : '☆',
      label: formatCount(favorites),
      onPress: onFavorite,
      showBusy: favoriteBusy,
    },
  ];

  return (
    <View style={styles.row}>
      {actionItems.map((item) => (
        <Pressable
          key={item.key}
          style={[styles.item, item.disabled && styles.itemDisabled]}
          onPress={item.onPress}
          disabled={item.disabled}
          android_ripple={{ color: '#ddd' }}
        >
          <Text style={[styles.icon, item.active && styles.active]}>
            {item.showBusy ? '…' : item.icon}
          </Text>
          <Text style={[styles.text, item.active && styles.activeText]}>{item.label}</Text>
        </Pressable>
      ))}

      {onShare ? (
        <Pressable
          style={styles.item}
          onPress={onShare}
          android_ripple={{ color: '#ddd' }}
        >
          <Text style={styles.icon}>↗️</Text>
          <Text style={styles.text}>分享</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 10,
    paddingVertical: 6,
    borderTopWidth: 1,
    borderTopColor: COLORS.line,
    paddingTop: 9,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 20,
    minWidth: 52,
    justifyContent: 'center',
  },
  itemDisabled: {
    opacity: 0.5,
  },
  icon: { fontSize: 16, color: COLORS.ink },
  text: { fontSize: 11.8, color: COLORS.mutedText || COLORS.muted },
  active: { color: COLORS.accent },
  activeText: { color: COLORS.accent, fontWeight: '700' },
});
