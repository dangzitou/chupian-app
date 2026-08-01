import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { COLORS } from '../config';
import { toShotParamPairs } from '../utils/postCodec';

function normalizeRows(post) {
  const pairs = toShotParamPairs(post);
  const rows = pairs.map(([name, value]) => ({
    name,
    value: String(value || '').trim(),
  })).filter((item) => item.value);
  if (!rows.length) return null;
  return rows.slice(0, 8);
}

export default function ShotMetaPanel({ post, compact = false, fallback = '博主未填写拍摄参数。' }) {
  const rows = normalizeRows(post);

  if (!rows) {
    if (!fallback) return null;
    return (
      <View style={styles.emptyWrap}>
        <Text style={styles.empty}>{fallback}</Text>
      </View>
    );
  }

  return (
    <View style={[styles.wrap, compact && styles.compactWrap]}>
      {rows.map((item) => (
        <View key={item.name} style={[styles.row, compact && styles.compactRow]}>
          <Text style={[styles.label, compact && styles.compactLabel]}>{item.name}</Text>
          <Text style={[styles.value, compact && styles.compactValue]} numberOfLines={1}>{item.value}</Text>
        </View>
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
    marginTop: 10,
  },
  compactWrap: {
    marginTop: 6,
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: COLORS.card,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    minHeight: 20,
  },
  compactRow: {
    minHeight: 18,
  },
  label: {
    width: 56,
    color: COLORS.muted,
    fontSize: 12,
  },
  compactLabel: {
    width: 50,
    fontSize: 11.2,
  },
  value: {
    flex: 1,
    color: COLORS.ink,
    fontSize: 12.5,
    textAlign: 'right',
  },
  compactValue: {
    fontSize: 11.5,
  },
  emptyWrap: {
    marginTop: 8,
    marginBottom: 2,
  },
  empty: {
    color: COLORS.muted,
    fontSize: 12,
  },
});
