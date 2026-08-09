import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { COLORS } from '../../config';

export default function OptionPills({ options, value, onChange, compact = false }) {
  const safeOptions = Array.isArray(options) ? options : [];

  return (
    <View style={[styles.wrap, compact && styles.wrapCompact]}>
      {safeOptions.map((opt) => {
        const active = value === opt.value;
        return (
        <Pressable
          key={String(opt.value ?? opt.label)}
          style={({ pressed }) => [
            styles.pill,
            compact && styles.pillCompact,
            active && styles.pillActive,
            pressed && styles.pillPressed,
          ]}
          onPress={() => onChange?.(opt.value)}
          accessibilityRole="button"
          accessibilityLabel={opt.accessibilityLabel || opt.label}
          accessibilityState={{ selected: active }}
        >
          <Text style={[styles.text, active && styles.textActive]}>{opt.label}</Text>
        </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  wrapCompact: { gap: 6 },
  pill: {
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    backgroundColor: COLORS.card,
    borderRadius: 999,
    minHeight: 40,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  pillCompact: {
    minHeight: 36,
    paddingVertical: 7,
  },
  pillActive: {
    borderColor: COLORS.accent,
    backgroundColor: COLORS.accentBg,
  },
  text: {
    color: COLORS.muted,
    fontSize: 12.2,
    lineHeight: 16,
  },
  textActive: {
    color: COLORS.accent,
    fontWeight: '700',
  },
  pillPressed: {
    opacity: 0.68,
    transform: [{ scale: 0.97 }],
  },
});
