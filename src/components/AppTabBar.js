import React from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS } from '../config';
import { APP_ROUTES } from '../constants/routes';

const NAV_ITEMS = new Set([
  APP_ROUTES.MAP,
  APP_ROUTES.DISCOVERY,
  APP_ROUTES.CREATE,
  APP_ROUTES.PROFILE,
]);

function MapIcon({ color }) {
  return (
    <View style={[styles.mapIcon, { borderColor: color }]}>
      <View style={[styles.mapDot, { backgroundColor: color }]} />
    </View>
  );
}

function DiscoverIcon({ color }) {
  return (
    <View style={styles.discoverIcon}>
      {[0, 1, 2, 3].map((item) => (
        <View key={item} style={[styles.discoverCell, { borderColor: color }]} />
      ))}
    </View>
  );
}

function ProfileIcon({ color }) {
  return (
    <View style={styles.profileIcon}>
      <View style={[styles.profileHead, { borderColor: color }]} />
      <View style={[styles.profileBody, { borderColor: color }]} />
    </View>
  );
}

function PlusIcon() {
  return (
    <View style={styles.plusIcon}>
      <View style={styles.plusHorizontal} />
      <View style={styles.plusVertical} />
    </View>
  );
}

function TabGlyph({ routeName, color, isCreate }) {
  if (isCreate) return <PlusIcon />;
  if (routeName === APP_ROUTES.MAP) return <MapIcon color={color} />;
  if (routeName === APP_ROUTES.DISCOVERY) return <DiscoverIcon color={color} />;
  return <ProfileIcon color={color} />;
}

export default function AppTabBar({ state, descriptors, navigation }) {
  const insets = useSafeAreaInsets();
  const bottomInset = Platform.OS === 'web' ? Math.max(8, insets.bottom) : insets.bottom;
  const activeRoute = state.routes[state.index];
  if (activeRoute?.name === APP_ROUTES.CREATE) return null;

  return (
    <View style={[styles.bar, { paddingBottom: bottomInset }]}>
      <View style={styles.row}>
        {state.routes.map((route, index) => {
          if (!NAV_ITEMS.has(route.name)) return null;
          const options = descriptors[route.key]?.options || {};
          const focused = state.index === index;
          const isCreate = route.name === APP_ROUTES.CREATE;
          const color = focused ? COLORS.ink : COLORS.mutedText;
          const configuredLabel = options.tabBarLabel || options.title || route.name;
          const label = typeof configuredLabel === 'string' ? configuredLabel : route.name;

          const onPress = () => {
            const event = navigation.emit({
              type: 'tabPress',
              target: route.key,
              canPreventDefault: true,
            });
            if (!focused && !event.defaultPrevented) {
              navigation.navigate(route.name, route.params);
            }
          };

          return (
            <Pressable
              key={route.key}
              style={({ pressed }) => [styles.item, pressed && styles.itemPressed]}
              onPress={onPress}
              onLongPress={() => navigation.emit({ type: 'tabLongPress', target: route.key })}
              accessibilityRole="tab"
              accessibilityLabel={options.tabBarAccessibilityLabel || label}
              accessibilityState={focused ? { selected: true } : {}}
              testID={options.tabBarButtonTestID}
              hitSlop={6}
            >
              <View style={[isCreate ? styles.createIcon : styles.icon, isCreate && styles.createShadow]}>
                <TabGlyph routeName={route.name} color={isCreate ? COLORS.white : color} isCreate={isCreate} />
              </View>
              <Text style={[styles.label, { color }, focused && styles.labelActive]}>{label}</Text>
              {focused ? <View style={styles.activeDot} /> : <View style={styles.activeDotPlaceholder} />}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: '#fffdfb',
    borderTopWidth: 1,
    borderTopColor: 'rgba(25,25,25,0.08)',
    paddingTop: 7,
    paddingHorizontal: 18,
  },
  row: {
    width: '100%',
    maxWidth: 380,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  item: {
    flex: 1,
    minHeight: 53,
    alignItems: 'center',
    justifyContent: 'flex-start',
    borderRadius: 14,
  },
  itemPressed: {
    opacity: 0.65,
    transform: [{ scale: 0.96 }],
  },
  icon: {
    width: 27,
    height: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  createIcon: {
    width: 40,
    height: 32,
    marginTop: -1,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.accent,
  },
  createShadow: {
    shadowColor: COLORS.accent,
    shadowOpacity: 0.24,
    shadowRadius: 9,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  label: {
    marginTop: 2,
    fontSize: 10.5,
    lineHeight: 14,
    fontWeight: '600',
    letterSpacing: 0.1,
  },
  labelActive: {
    fontWeight: '700',
  },
  activeDot: {
    width: 3,
    height: 3,
    marginTop: 2,
    borderRadius: 2,
    backgroundColor: COLORS.accent,
  },
  activeDotPlaceholder: {
    width: 3,
    height: 3,
    marginTop: 2,
  },
  mapIcon: {
    width: 20,
    height: 20,
    borderWidth: 1.8,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mapDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
  },
  discoverIcon: {
    width: 24,
    height: 24,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignContent: 'center',
    justifyContent: 'center',
    padding: 2,
  },
  discoverCell: {
    width: 8,
    height: 8,
    margin: 1.5,
    borderWidth: 1.5,
    borderRadius: 2.5,
  },
  profileIcon: {
    width: 24,
    height: 24,
    alignItems: 'center',
    paddingTop: 1,
  },
  profileHead: {
    width: 9,
    height: 9,
    borderWidth: 1.6,
    borderRadius: 5,
  },
  profileBody: {
    width: 19,
    height: 9,
    marginTop: 2,
    borderWidth: 1.6,
    borderBottomWidth: 0,
    borderTopLeftRadius: 10,
    borderTopRightRadius: 10,
  },
  plusIcon: {
    width: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  plusHorizontal: {
    position: 'absolute',
    width: 17,
    height: 2,
    borderRadius: 1,
    backgroundColor: COLORS.white,
  },
  plusVertical: {
    position: 'absolute',
    width: 2,
    height: 17,
    borderRadius: 1,
    backgroundColor: COLORS.white,
  },
});