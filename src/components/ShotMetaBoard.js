import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { COLORS } from '../config';
import ShotMetaStrip from './ShotMetaStrip';
import ShotMetaPanel from './ShotMetaPanel';
import { buildShotMetaLines } from '../utils/shotMeta';
import { toShotParamPairs } from '../utils/postCodec';

const DEFAULT_OPTIONS = {
  includeSpot: true,
  includeLocation: true,
  includeMedia: false,
  maxItems: 8,
};

const TECHNICAL_KEYS = [
  'camera',
  'lens',
  'focal',
  'focalLength',
  'aperture',
  'shutter',
  'iso',
  'whiteBalance',
];

const CONTEXT_KEYS = [
  'angle',
  'direction',
  'spotName',
  'locationName',
  'district',
  'shotAt',
  'timeWindow',
  'shotTime',
  'bestTime',
];

function getContextOnlySource(source) {
  if (!source || typeof source !== 'object') return source;
  const context = { ...source };
  TECHNICAL_KEYS.forEach((key) => {
    context[key] = '';
  });
  if (source.gear && typeof source.gear === 'object') {
    context.gear = {};
  }
  return context;
}

function getTechnicalOnlySource(source) {
  if (!source || typeof source !== 'object') return source;
  const technical = { ...source };
  CONTEXT_KEYS.forEach((key) => {
    technical[key] = '';
  });
  return technical;
}

function hasRows(source, options) {
  const stripRows = buildShotMetaLines(source, options);
  const panelRows = toShotParamPairs(source || {});
  return stripRows.length > 0 || panelRows.length > 0;
}

export default function ShotMetaBoard({
  source,
  title,
  options = {},
  compact = false,
  fallback = '暂无可展示的拍摄参数',
  showStrip = true,
  showPanel = false,
}) {
  const mergeOptions = {
    ...DEFAULT_OPTIONS,
    ...options,
  };
  const stripSource = showPanel ? getContextOnlySource(source) : source;
  const panelSource = showPanel && showStrip && (mergeOptions.includeSpot || mergeOptions.includeLocation)
    ? getTechnicalOnlySource(source)
    : source;

  if (!hasRows(source, mergeOptions)) {
    return (
      <View style={styles.wrap}>
        {title ? <Text style={[styles.title, compact && styles.compactTitle]}>{title}</Text> : null}
        <Text style={styles.fallback}>{fallback}</Text>
      </View>
    );
  }

  return (
    <View style={[styles.wrap, compact && styles.compactWrap]}>
      {title ? <Text style={[styles.title, compact && styles.compactTitle]}>{title}</Text> : null}
      {showStrip ? (
        <ShotMetaStrip
          source={stripSource}
          options={mergeOptions}
          compact={compact}
          fallback={null}
        />
      ) : null}
      {showPanel ? (
      <ShotMetaPanel
        post={panelSource}
          compact={compact}
          fallback={null}
        />
      ) : null}
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
    gap: 8,
  },
  compactWrap: {
    padding: 8,
    gap: 6,
  },
  title: {
    color: COLORS.ink,
    fontSize: 13,
    fontWeight: '700',
  },
  compactTitle: {
    fontSize: 12.2,
  },
  fallback: {
    color: COLORS.muted,
    fontSize: 12,
  },
});
