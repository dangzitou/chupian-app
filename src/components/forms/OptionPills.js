import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { COLORS } from '../../config';

export default function OptionPills({ options, value, onChange, compact = false }) {
  return (
    <View style={[styles.wrap, compact && styles.wrapCompact]}>
      {options.map((opt) => (
        <Pressable
          key={opt.value}
          style={[styles.pill, value === opt.value && styles.pillActive]}
          onPress={() => onChange(opt.value)}
        >
          <Text style={[styles.text, value === opt.value && styles.textActive]}>{opt.label}</Text>
        </Pressable>
      ))}
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
    paddingHorizontal: 10,
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
});
