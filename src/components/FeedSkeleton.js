import React from 'react';
import { StyleSheet, View } from 'react-native';
import { COLORS } from '../config';

const BAR_COLOR = '#ece5de';

function SkeletonItem() {
  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={[styles.circle, { marginTop: 1 }]} />
        <View style={styles.meta}>
          <View style={[styles.line, styles.lineTitle]} />
          <View style={[styles.line, styles.lineMeta]} />
          <View style={[styles.line, styles.lineMetaSmall]} />
        </View>
      </View>
      <View style={styles.media} />
      <View style={styles.content}>
        <View style={[styles.line, styles.lineCardTitle]} />
        <View style={[styles.line, styles.lineCardTitle]} />
        <View style={[styles.pill, styles.pillWide]} />
        <View style={[styles.line, styles.lineTiny]} />
      </View>
    </View>
  );
}

export default function FeedSkeleton({ count = 3 }) {
  return (
    <View>
      {Array.from({ length: count }).map((_, idx) => <SkeletonItem key={idx} />)}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 12,
    marginBottom: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    backgroundColor: COLORS.card,
    paddingBottom: 10,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    gap: 8,
  },
  circle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: BAR_COLOR,
  },
  meta: {
    flex: 1,
    gap: 6,
  },
  line: {
    backgroundColor: BAR_COLOR,
    borderRadius: 999,
  },
  lineTitle: {
    width: '58%',
    height: 15,
  },
  lineMeta: {
    width: '72%',
    height: 11,
  },
  lineMetaSmall: {
    width: '42%',
    height: 11,
  },
  media: {
    width: '100%',
    height: 220,
    backgroundColor: BAR_COLOR,
  },
  content: {
    paddingHorizontal: 12,
    paddingTop: 9,
    gap: 8,
  },
  lineCardTitle: {
    width: '84%',
    height: 14,
  },
  pillWide: {
    width: '62%',
    height: 16,
    borderRadius: 10,
  },
  lineTiny: {
    width: '36%',
    height: 12,
    borderRadius: 6,
  },
  pill: {
    borderRadius: 999,
    backgroundColor: BAR_COLOR,
    height: 16,
  },
});
