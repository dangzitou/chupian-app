import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { COLORS } from './src/config';
import { APP_ROUTES } from './src/constants/routes';

import MapScreen from './src/screens/MapScreen';
import PostsScreen from './src/screens/PostsScreen';
import PostDetailScreen from './src/screens/PostDetailScreen';
import SpotDetailScreen from './src/screens/SpotDetailScreen';
import SpotsScreen from './src/screens/SpotsScreen';
import NewPostScreen from './src/screens/NewPostScreen';
import ProfileScreen from './src/screens/ProfileScreen';

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

const icons = {
  [APP_ROUTES.DISCOVERY]: { icon: '🏠', active: '🏠' },
  [APP_ROUTES.MAP]: { icon: '🗺️', active: '🗺️' },
  [APP_ROUTES.CREATE]: { icon: '＋', active: '＋' },
  [APP_ROUTES.PROFILE]: { icon: '👤', active: '👤' },
};

function HomeStack() {
  return (
    <Stack.Navigator screenOptions={{ headerStyle: { backgroundColor: COLORS.panel }, headerTintColor: COLORS.ink, headerTitleStyle: { fontWeight: '700' } }}>
      <Stack.Screen name="PostsList" component={PostsScreen} options={{ headerShown: false }} />
      <Stack.Screen name="PostDetail" component={PostDetailScreen} options={({ route }) => ({ title: route.params?.title || '作品详情' })} />
      <Stack.Screen name="NewPost" component={NewPostScreen} options={{ title: '发布出片' }} />
    </Stack.Navigator>
  );
}

function MapStack() {
  return (
    <Stack.Navigator screenOptions={{ headerStyle: { backgroundColor: COLORS.panel }, headerTintColor: COLORS.ink, headerTitleStyle: { fontWeight: '700' } }}>
      <Stack.Screen name="SpotsList" component={SpotsScreen} options={{ title: '出片点位', headerShown: false }} />
      <Stack.Screen name="SpotDetail" component={SpotDetailScreen} options={({ route }) => ({ title: route.params?.name || '点位详情' })} />
      <Stack.Screen name="Map" component={MapScreen} options={{ title: '地图探索' }} />
    </Stack.Navigator>
  );
}

function RedBookTabBar({ state, descriptors, navigation }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.tabBar, { paddingBottom: Math.max(10, insets.bottom + 4) }]}>
      {state.routes.map((route, index) => {
        const isFocused = state.index === index;
        const label = descriptors[route.key].options.tabBarLabel ?? route.name;
        const activeStyle = isFocused;
        const config = icons[label] || { icon: 'ellipse-outline', active: 'ellipse' };
        const iconName = activeStyle ? config.active : config.icon;
        const isPlus = label === APP_ROUTES.CREATE;

        return (
          <Pressable
            key={route.key}
            accessibilityRole="button"
            style={[
              styles.tabBtn,
              isPlus && styles.plusBtnWrap,
              activeStyle && isPlus && styles.plusBtnActive,
            ]}
            android_ripple={{ color: '#ddd', borderless: false }}
            onPress={() => navigation.navigate(route.name)}
          >
            <View
              style={[
                styles.tabInner,
                activeStyle && styles.tabInnerActive,
                isPlus && styles.plusCircle,
                activeStyle && isPlus ? styles.plusCircleActive : null,
              ]}
            >
              <Text style={[
                styles.tabIcon,
                activeStyle && styles.tabIconActive,
                isPlus && styles.plusText,
              ]}>
                {iconName}
              </Text>
            </View>
            <Text style={[
              styles.tabText,
              activeStyle && styles.tabTextActive,
              isPlus && styles.plusLabel,
            ]}>{label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <NavigationContainer>
      <Tab.Navigator
        screenOptions={{ headerShown: false }}
        tabBar={(props) => <RedBookTabBar {...props} />}
        initialRouteName={APP_ROUTES.DISCOVERY}
      >
        <Tab.Screen name={APP_ROUTES.DISCOVERY} component={HomeStack} />
        <Tab.Screen name={APP_ROUTES.MAP} component={MapStack} />
        <Tab.Screen name={APP_ROUTES.CREATE} component={NewPostScreen} />
        <Tab.Screen name={APP_ROUTES.PROFILE} component={ProfileScreen} />
      </Tab.Navigator>
      </NavigationContainer>
      <StatusBar style="dark" />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    flexDirection: 'row',
    backgroundColor: COLORS.card,
    borderTopColor: 'rgba(0,0,0,0.08)',
    borderTopWidth: 1,
    paddingBottom: 8,
    paddingTop: 8,
    justifyContent: 'space-around',
    alignItems: 'center',
    height: 67,
  },
  tabBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabInner: {
    width: 34,
    height: 34,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabInnerActive: {
    backgroundColor: COLORS.accentBg,
  },
  plusBtnWrap: {
    marginTop: -18,
  },
  plusBtnActive: {
    transform: [{ translateY: -2 }],
  },
  plusCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: COLORS.accent,
    shadowColor: '#000',
    shadowOpacity: 0.14,
    shadowRadius: 9,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
    borderWidth: 4,
    borderColor: COLORS.card,
  },
  plusCircleActive: {
    borderColor: '#f7f7f7',
  },
  tabIcon: {
    fontSize: 18,
    color: COLORS.muted,
    fontWeight: '700',
  },
  tabIconActive: {
    color: COLORS.accent,
  },
  tabText: {
    marginTop: 2,
    color: COLORS.muted,
    fontSize: 11,
  },
  tabTextActive: {
    color: COLORS.accent,
    fontWeight: '600',
  },
  plusText: {
    color: COLORS.onAccent,
    fontSize: 24,
    lineHeight: 26,
    fontWeight: '800',
  },
  plusLabel: {
    color: COLORS.accent,
    fontWeight: '700',
  },
});
