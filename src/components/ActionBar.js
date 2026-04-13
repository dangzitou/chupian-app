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
  compact = false,
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
    <View style={[styles.row, compact && styles.rowCompact]}>
      {actionItems.map((item) => (
        <Pressable
          key={item.key}
          style={[styles.item, compact && styles.itemCompact, item.disabled && styles.itemDisabled]}
          onPress={item.onPress}
          disabled={item.disabled}
          android_ripple={{ color: '#ddd' }}
        >
          <Text style={[styles.icon, compact && styles.iconCompact, item.active && styles.active]}>
            {item.showBusy ? '…' : item.icon}
          </Text>
          <Text style={[styles.text, compact && styles.textCompact, item.active && styles.activeText]}>{item.label}</Text>
        </Pressable>
      ))}

      {onShare ? (
        <Pressable
          style={[styles.item, compact && styles.itemCompact]}
          onPress={onShare}
          android_ripple={{ color: '#ddd' }}
        >
          <Text style={[styles.icon, compact && styles.iconCompact]}>↗️</Text>
          <Text style={[styles.text, compact && styles.textCompact]}>分享</Text>
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
  rowCompact: {
    flex: 1,
    justifyContent: 'flex-end',
    marginTop: 0,
    paddingVertical: 0,
    paddingTop: 0,
    borderTopWidth: 0,
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
  itemCompact: {
    minWidth: 0,
    paddingHorizontal: 3,
    paddingVertical: 2,
    gap: 2,
  },
  itemDisabled: {
    opacity: 0.5,
  },
  icon: { fontSize: 16, color: COLORS.ink },
  iconCompact: { fontSize: 14 },
  text: { fontSize: 11.8, color: COLORS.mutedText || COLORS.muted },
  textCompact: { fontSize: 10.5 },
  active: { color: COLORS.accent },
  activeText: { color: COLORS.accent, fontWeight: '700' },
});
