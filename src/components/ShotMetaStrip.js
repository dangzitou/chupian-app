import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { COLORS } from '../config';
import { buildShotMetaLines } from '../utils/shotMeta';

export default function ShotMetaStrip({
  source,
  options = {},
  compact = false,
  fallback = null,
}) {
  const lines = useMemo(() => buildShotMetaLines(source, options), [source, options]);

  if (!lines.length) {
    if (!fallback) return null;
    return <Text style={styles.fallback}>{fallback}</Text>;
  }

  return (
    <View style={[styles.wrap, compact && styles.compactWrap]}>
      {lines.map((line, index) => (
        <Text key={`${line}-${index}`} style={[styles.line, compact && styles.compactLine]}>
          {line}
        </Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    backgroundColor: COLORS.panel,
    padding: 10,
    gap: 6,
    marginTop: 6,
  },
  compactWrap: {
    marginTop: 0,
    borderColor: 'transparent',
    backgroundColor: 'transparent',
    padding: 0,
    gap: 5,
  },
  line: {
    color: COLORS.ink,
    fontSize: 12,
    lineHeight: 18,
  },
  compactLine: {
    fontSize: 11.4,
    lineHeight: 17,
    color: COLORS.muted,
  },
  fallback: {
    marginTop: 4,
    color: COLORS.muted,
    fontSize: 12,
  },
});
