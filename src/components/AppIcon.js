import React from 'react';
import { StyleSheet, View } from 'react-native';

function Frame({ size, style, children }) {
  return <View style={[styles.frame, { width: size, height: size }, style]}>{children}</View>;
}

function Cross({ size, color, stroke, style }) {
  const length = Math.round(size * 0.72);
  return (
    <Frame size={size} style={style}>
      <View style={[styles.centerLine, { width: length, height: stroke, backgroundColor: color }]} />
      <View style={[styles.centerLine, { width: stroke, height: length, backgroundColor: color }]} />
    </Frame>
  );
}

function Close({ size, color, stroke, style }) {
  const length = Math.round(size * 0.72);
  return (
    <Frame size={size} style={style}>
      <View style={[styles.centerLine, { width: length, height: stroke, backgroundColor: color, transform: [{ rotate: '45deg' }] }]} />
      <View style={[styles.centerLine, { width: length, height: stroke, backgroundColor: color, transform: [{ rotate: '-45deg' }] }]} />
    </Frame>
  );
}

function Chevron({ size, color, stroke, direction, style }) {
  const side = Math.round(size * 0.42);
  const rotation = {
    up: '225deg',
    down: '45deg',
    left: '135deg',
    right: '-45deg',
  }[direction] || '45deg';
  return (
    <Frame size={size} style={style}>
      <View
        style={[
          styles.chevron,
          {
            width: side,
            height: side,
            borderRightWidth: stroke,
            borderBottomWidth: stroke,
            borderColor: color,
            transform: [{ rotate: rotation }],
          },
        ]}
      />
    </Frame>
  );
}

function Heart({ size, color, filled, style }) {
  const lobe = Math.round(size * 0.44);
  const body = Math.round(size * 0.55);
  const tone = filled ? color : `${color}`;
  return (
    <Frame size={size} style={[style, !filled && styles.iconMuted]}>
      <View style={[styles.heartLobe, { width: lobe, height: lobe, left: size * 0.17, top: size * 0.14, backgroundColor: tone }]} />
      <View style={[styles.heartLobe, { width: lobe, height: lobe, right: size * 0.17, top: size * 0.14, backgroundColor: tone }]} />
      <View style={[styles.heartBody, { width: body, height: body, backgroundColor: tone, transform: [{ rotate: '45deg' }] }]} />
    </Frame>
  );
}

function Comment({ size, color, stroke, style }) {
  const width = Math.round(size * 0.77);
  const height = Math.round(size * 0.58);
  return (
    <Frame size={size} style={style}>
      <View style={[styles.commentBody, { width, height, borderColor: color, borderWidth: stroke }]} />
      <View style={[styles.commentTail, { borderLeftWidth: stroke, borderBottomWidth: stroke, borderColor: color }]} />
    </Frame>
  );
}

function Bookmark({ size, color, stroke, filled, style }) {
  const width = Math.round(size * 0.58);
  const height = Math.round(size * 0.78);
  return (
    <Frame size={size} style={style}>
      <View
        style={[
          styles.bookmark,
          {
            width,
            height,
            borderColor: color,
            borderWidth: stroke,
            backgroundColor: filled ? color : 'transparent',
          },
        ]}
      >
        <View style={[styles.bookmarkNotch, { borderTopColor: filled ? '#fffdf8' : color }]} />
      </View>
    </Frame>
  );
}

function Share({ size, color, stroke, style }) {
  const dot = Math.max(4, Math.round(size * 0.22));
  return (
    <Frame size={size} style={style}>
      <View style={[styles.shareLine, { width: size * 0.51, height: stroke, backgroundColor: color, transform: [{ rotate: '-28deg' }], top: size * 0.35 }]} />
      <View style={[styles.shareLine, { width: size * 0.51, height: stroke, backgroundColor: color, transform: [{ rotate: '28deg' }], bottom: size * 0.35 }]} />
      <View style={[styles.shareDot, { width: dot, height: dot, borderRadius: dot / 2, left: size * 0.08, top: size * 0.39, backgroundColor: color }]} />
      <View style={[styles.shareDot, { width: dot, height: dot, borderRadius: dot / 2, right: size * 0.06, top: size * 0.1, backgroundColor: color }]} />
      <View style={[styles.shareDot, { width: dot, height: dot, borderRadius: dot / 2, right: size * 0.06, bottom: size * 0.1, backgroundColor: color }]} />
    </Frame>
  );
}

function Play({ size, color, style }) {
  const side = Math.round(size * 0.42);
  return (
    <Frame size={size} style={style}>
      <View
        style={[
          styles.playTriangle,
          {
            borderTopWidth: side,
            borderBottomWidth: side,
            borderLeftWidth: Math.round(side * 1.34),
            borderTopColor: 'transparent',
            borderBottomColor: 'transparent',
            borderLeftColor: color,
            marginLeft: Math.round(size * 0.12),
          },
        ]}
      />
    </Frame>
  );
}

function Layers({ size, color, stroke, style }) {
  const width = Math.round(size * 0.66);
  const height = Math.round(size * 0.42);
  return (
    <Frame size={size} style={style}>
      <View style={[styles.layerBack, { width, height, borderColor: color, borderWidth: stroke }]} />
      <View style={[styles.layerFront, { width, height, borderColor: color, borderWidth: stroke }]} />
    </Frame>
  );
}

function Pin({ size, color, stroke, style }) {
  const head = Math.round(size * 0.58);
  const dot = Math.max(3, Math.round(size * 0.18));
  return (
    <Frame size={size} style={style}>
      <View style={[styles.pinHead, { width: head, height: head, borderRadius: head / 2, borderColor: color, borderWidth: stroke }]}>
        <View style={{ width: dot, height: dot, borderRadius: dot / 2, backgroundColor: color }} />
      </View>
      <View style={[styles.pinTail, { width: Math.round(size * 0.28), height: Math.round(size * 0.28), borderRightWidth: stroke, borderBottomWidth: stroke, borderColor: color }]} />
    </Frame>
  );
}

function Camera({ size, color, stroke, style }) {
  const width = Math.round(size * 0.82);
  const height = Math.round(size * 0.6);
  const lens = Math.round(size * 0.28);
  return (
    <Frame size={size} style={style}>
      <View style={[styles.cameraTop, { width: Math.round(size * 0.3), height: Math.round(size * 0.14), borderColor: color, borderWidth: stroke }]} />
      <View style={[styles.cameraBody, { width, height, borderRadius: Math.round(size * 0.1), borderColor: color, borderWidth: stroke }]}>
        <View style={{ width: lens, height: lens, borderRadius: lens / 2, borderColor: color, borderWidth: stroke }} />
      </View>
    </Frame>
  );
}

function Clock({ size, color, stroke, style }) {
  const diameter = Math.round(size * 0.78);
  return (
    <Frame size={size} style={style}>
      <View style={[styles.clock, { width: diameter, height: diameter, borderRadius: diameter / 2, borderColor: color, borderWidth: stroke }]}>
        <View style={[styles.clockHand, { width: stroke, height: diameter * 0.26, top: diameter * 0.18, backgroundColor: color }]} />
        <View style={[styles.clockHand, { width: diameter * 0.2, height: stroke, left: diameter * 0.48, top: diameter * 0.48, backgroundColor: color }]} />
      </View>
    </Frame>
  );
}

function Bulb({ size, color, stroke, style }) {
  const globe = Math.round(size * 0.56);
  return (
    <Frame size={size} style={style}>
      <View style={[styles.bulbGlobe, { width: globe, height: globe, borderRadius: globe / 2, borderColor: color, borderWidth: stroke }]} />
      <View style={[styles.bulbBase, { width: Math.round(size * 0.3), height: stroke, backgroundColor: color, bottom: size * 0.16 }]} />
      <View style={[styles.bulbBase, { width: Math.round(size * 0.22), height: stroke, backgroundColor: color, bottom: size * 0.05 }]} />
    </Frame>
  );
}

function Compass({ size, color, stroke, style }) {
  const side = Math.round(size * 0.54);
  return (
    <Frame size={size} style={style}>
      <View style={[styles.compass, { width: side, height: side, borderColor: color, borderWidth: stroke }]} />
      <View style={[styles.compassNeedle, { borderBottomWidth: Math.round(size * 0.22), borderBottomColor: color }]} />
    </Frame>
  );
}

export default function AppIcon({ name, size = 20, color = '#1c1a17', stroke = 1.7, filled = false, style }) {
  if (name === 'plus') return <Cross size={size} color={color} stroke={stroke} style={style} />;
  if (name === 'close') return <Close size={size} color={color} stroke={stroke} style={style} />;
  if (name === 'chevronUp') return <Chevron size={size} color={color} stroke={stroke} direction="up" style={style} />;
  if (name === 'chevronDown') return <Chevron size={size} color={color} stroke={stroke} direction="down" style={style} />;
  if (name === 'chevronLeft') return <Chevron size={size} color={color} stroke={stroke} direction="left" style={style} />;
  if (name === 'chevronRight') return <Chevron size={size} color={color} stroke={stroke} direction="right" style={style} />;
  if (name === 'heart') return <Heart size={size} color={color} filled={filled} style={style} />;
  if (name === 'comment') return <Comment size={size} color={color} stroke={stroke} style={style} />;
  if (name === 'bookmark') return <Bookmark size={size} color={color} stroke={stroke} filled={filled} style={style} />;
  if (name === 'share') return <Share size={size} color={color} stroke={stroke} style={style} />;
  if (name === 'play') return <Play size={size} color={color} style={style} />;
  if (name === 'layers') return <Layers size={size} color={color} stroke={stroke} style={style} />;
  if (name === 'pin') return <Pin size={size} color={color} stroke={stroke} style={style} />;
  if (name === 'camera') return <Camera size={size} color={color} stroke={stroke} style={style} />;
  if (name === 'clock') return <Clock size={size} color={color} stroke={stroke} style={style} />;
  if (name === 'bulb') return <Bulb size={size} color={color} stroke={stroke} style={style} />;
  if (name === 'compass') return <Compass size={size} color={color} stroke={stroke} style={style} />;
  return null;
}

const styles = StyleSheet.create({
  frame: { alignItems: 'center', justifyContent: 'center', overflow: 'visible' },
  centerLine: { position: 'absolute', borderRadius: 99 },
  chevron: { marginTop: -2 },
  iconMuted: { opacity: 0.62 },
  heartLobe: { position: 'absolute', borderRadius: 999 },
  heartBody: { position: 'absolute', top: '35%', borderRadius: 2 },
  commentBody: { borderRadius: 5 },
  commentTail: { position: 'absolute', left: '25%', bottom: '16%', width: 6, height: 6, transform: [{ rotate: '-45deg' }] },
  bookmark: { alignItems: 'center', justifyContent: 'flex-end', overflow: 'hidden', borderRadius: 2 },
  bookmarkNotch: { width: 0, height: 0, borderLeftWidth: 5, borderRightWidth: 5, borderLeftColor: 'transparent', borderRightColor: 'transparent', transform: [{ rotate: '180deg' }], marginBottom: -1 },
  shareLine: { position: 'absolute', left: '25%', borderRadius: 99 },
  shareDot: { position: 'absolute' },
  playTriangle: { width: 0, height: 0 },
  layerBack: { position: 'absolute', transform: [{ rotate: '-10deg' }], borderRadius: 2, opacity: 0.56 },
  layerFront: { position: 'absolute', transform: [{ rotate: '10deg' }], borderRadius: 2 },
  pinHead: { position: 'absolute', top: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,253,248,0.9)' },
  pinTail: { position: 'absolute', bottom: 1, transform: [{ rotate: '45deg' }] },
  cameraTop: { position: 'absolute', top: 2, left: '35%', borderBottomWidth: 0, borderTopLeftRadius: 3, borderTopRightRadius: 3 },
  cameraBody: { position: 'absolute', bottom: 2, alignItems: 'center', justifyContent: 'center' },
  clock: { alignItems: 'center', justifyContent: 'center' },
  clockHand: { position: 'absolute', borderRadius: 99 },
  bulbGlobe: { position: 'absolute', top: 0 },
  bulbBase: { position: 'absolute', borderRadius: 99 },
  compass: { position: 'absolute', transform: [{ rotate: '45deg' }] },
  compassNeedle: { width: 0, height: 0, borderLeftWidth: 4, borderRightWidth: 4, borderLeftColor: 'transparent', borderRightColor: 'transparent', transform: [{ rotate: '180deg' }], marginTop: -3 },
});
