import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { COLORS } from '../config';
import { formatCount } from '../utils/format';
import AppIcon from './AppIcon';

function ActionGlyph({ type, active = false, busy = false, compact = false }) {
  const activeScale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!active) {
      Animated.timing(activeScale, {
        toValue: 1,
        duration: 120,
        useNativeDriver: true,
      }).start();
      return undefined;
    }

    activeScale.setValue(0.82);
    Animated.spring(activeScale, {
      toValue: 1,
      speed: 28,
      bounciness: 5,
      useNativeDriver: true,
    }).start();
    return undefined;
  }, [active, activeScale]);

  if (busy) {
    return (
      <ActivityIndicator
        size="small"
        color={active ? COLORS.accent : COLORS.muted}
        style={[styles.busy, compact && styles.busyCompact]}
      />
    );
  }

  const iconName = type === 'like'
    ? 'heart'
    : type === 'favorite'
      ? 'bookmark'
      : type;
  const color = active ? COLORS.accent : COLORS.ink;

  return (
    <Animated.View
      style={[
        styles.icon,
        compact && styles.iconCompact,
        { transform: [{ scale: activeScale }] },
      ]}
    >
      <AppIcon
        name={iconName}
        size={compact ? 15 : 18}
        color={color}
        filled={active}
        stroke={compact ? 1.45 : 1.7}
      />
    </Animated.View>
  );
}

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
  const [shareBusy, setShareBusy] = useState(false);
  const handleShare = useCallback(async () => {
    if (!onShare || shareBusy) return;
    setShareBusy(true);
    try {
      await onShare();
    } finally {
      setShareBusy(false);
    }
  }, [onShare, shareBusy]);
  const actionItems = [
    {
      key: 'like',
      active: liked,
      disabled: likeBusy || !onLike,
      label: formatCount(likes),
      accessibilityLabel: liked ? `取消点赞，${formatCount(likes)}个赞` : `点赞，${formatCount(likes)}个赞`,
      onPress: onLike,
      showBusy: likeBusy,
    },
    {
      key: 'comment',
      disabled: !onComment,
      label: formatCount(comments),
      accessibilityLabel: `评论，${formatCount(comments)}条评论`,
      onPress: onComment,
    },
    {
      key: 'favorite',
      active: favorited,
      disabled: favoriteBusy || !onFavorite,
      label: formatCount(favorites),
      accessibilityLabel: favorited ? `取消收藏，${formatCount(favorites)}个收藏` : `收藏，${formatCount(favorites)}个收藏`,
      onPress: onFavorite,
      showBusy: favoriteBusy,
    },
  ];

  return (
    <View style={[styles.row, compact && styles.rowCompact]}>
      {actionItems.map((item) => (
        <Pressable
          key={item.key}
          style={({ pressed }) => [
            styles.item,
            compact && styles.itemCompact,
            item.disabled && styles.itemDisabled,
            pressed && !item.disabled && styles.itemPressed,
          ]}
          onPress={item.onPress}
          disabled={item.disabled}
          accessibilityRole="button"
          accessibilityLabel={item.accessibilityLabel}
          accessibilityState={{ disabled: item.disabled, selected: item.active }}
          accessibilityHint={item.disabled ? '当前不可用' : undefined}
          accessibilityLiveRegion={item.showBusy ? 'polite' : 'none'}
          hitSlop={8}
          pressRetentionOffset={{ top: 8, right: 8, bottom: 8, left: 8 }}
          android_ripple={{ color: COLORS.accentSoft, borderless: true }}
        >
          <ActionGlyph
            type={item.key}
            active={item.active}
            busy={item.showBusy}
            compact={compact}
          />
          <Text style={[styles.text, compact && styles.textCompact, item.active && styles.activeText]}>{item.label}</Text>
        </Pressable>
      ))}

      {onShare ? (
        <Pressable
          style={({ pressed }) => [
            styles.item,
            compact && styles.itemCompact,
            shareBusy && styles.itemDisabled,
            pressed && !shareBusy && styles.itemPressed,
          ]}
          onPress={handleShare}
          disabled={shareBusy}
          accessibilityRole="button"
          accessibilityLabel={shareBusy ? '正在分享这条出片记录' : '分享这条出片记录'}
          accessibilityState={{ disabled: shareBusy }}
          accessibilityHint={shareBusy ? '分享面板正在打开' : undefined}
          accessibilityLiveRegion={shareBusy ? 'polite' : 'none'}
          hitSlop={8}
          pressRetentionOffset={{ top: 8, right: 8, bottom: 8, left: 8 }}
          android_ripple={{ color: COLORS.accentSoft, borderless: true }}
        >
          <ActionGlyph type="share" busy={shareBusy} compact={compact} />
          {compact ? null : <Text style={styles.text}>分享</Text>}
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
    minHeight: 34,
    paddingVertical: 5,
    paddingHorizontal: 8,
    borderRadius: 20,
    minWidth: 52,
    justifyContent: 'center',
  },
  itemCompact: {
    minWidth: 0,
    minHeight: 30,
    paddingHorizontal: 3,
    paddingVertical: 2,
    gap: 2,
  },
  itemPressed: {
    opacity: 0.62,
    transform: [{ scale: 0.96 }],
  },
  itemDisabled: {
    opacity: 0.5,
  },
  icon: { width: 18, height: 18, alignItems: 'center', justifyContent: 'center' },
  iconCompact: { width: 15, height: 15 },
  busy: { width: 16, height: 16 },
  busyCompact: { width: 14, height: 14 },
  text: { fontSize: 11.8, color: COLORS.mutedText || COLORS.muted },
  textCompact: { fontSize: 10.5 },
  active: { color: COLORS.accent },
  activeText: { color: COLORS.accent, fontWeight: '700' },
});
