import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { COLORS } from './src/config';

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
  首页: { icon: '🏠', active: '🏠' },
  地图: { icon: '🗺️', active: '🗺️' },
  发布: { icon: '+', active: '＋' },
  我的: { icon: '👤', active: '👤' },
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
  return (
    <View style={styles.tabBar}>
      {state.routes.map((route, index) => {
        const isFocused = state.index === index;
        const label = descriptors[route.key].options.tabBarLabel ?? route.name;
        const activeStyle = isFocused;
        const config = icons[label] || { icon: 'ellipse-outline', active: 'ellipse' };
        const iconName = activeStyle ? config.active : config.icon;

        return (
          <Pressable
            key={route.key}
            style={[
              styles.tabBtn,
              label === '发布' && styles.plusBtnWrap,
              activeStyle && label === '发布' && styles.plusBtnActive,
            ]}
            onPress={() => navigation.navigate(route.name)}
            android_ripple={{ color: '#ddd', borderless: false }}
          >
            <View style={[styles.tabInner, activeStyle && styles.tabInnerActive, label === '发布' && styles.plusCircle]}>
              <Text style={[styles.tabIcon, activeStyle && styles.tabIconActive]}>
                {iconName}
              </Text>
            </View>
            <Text style={[styles.tabText, activeStyle && styles.tabTextActive]}>{label}</Text>
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
          initialRouteName="首页"
        >
          <Tab.Screen name="首页" component={HomeStack} />
          <Tab.Screen name="地图" component={MapStack} />
          <Tab.Screen name="发布" component={NewPostScreen} />
          <Tab.Screen name="我的" component={ProfileScreen} />
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
    borderTopColor: COLORS.cardBorder,
    borderTopWidth: 1,
    paddingBottom: 4,
    paddingTop: 6,
    justifyContent: 'space-around',
    alignItems: 'center',
    height: 64,
  },
  tabBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabInner: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabInnerActive: {
    backgroundColor: COLORS.accentBg,
  },
  plusBtnWrap: {
    marginTop: -14,
  },
  plusBtnActive: {
    transform: [{ translateY: -2 }],
  },
  plusCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: COLORS.accent,
  },
  plusIcon: {
    color: COLORS.onAccent,
    fontSize: 28,
  },
  tabIcon: {
    fontSize: 19,
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
});
