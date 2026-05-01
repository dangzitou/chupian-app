import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { StatusBar } from 'expo-status-bar';
import { hydrateActorId } from './src/lib/actor';

import { APP_ROUTES } from './src/constants/routes';

import MapScreen from './src/screens/MapScreen';
import PostsScreen from './src/screens/PostsScreen';
import SpotDetailScreen from './src/screens/SpotDetailScreen';
import SpotsScreen from './src/screens/SpotsScreen';
import PostDetailScreen from './src/screens/PostDetailScreen';
import NewPostScreen from './src/screens/NewPostScreen';
import ProfileScreen from './src/screens/ProfileScreen';
import AuthorProfileScreen from './src/screens/AuthorProfileScreen';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

const linking = {
  prefixes: ['chupian://'],
  config: {
    screens: {
      [APP_ROUTES.MAP]: 'map',
      [APP_ROUTES.DISCOVERY]: {
        screens: {
          PostsList: 'discover',
          PostDetail: 'post/:postId',
          AuthorProfile: 'author/:authorId',
          SpotsList: 'spots',
          SpotDetail: 'spot/:spotId',
        },
      },
      [APP_ROUTES.CREATE]: 'publish',
      [APP_ROUTES.PROFILE]: 'profile',
    },
  },
};

function TabIcon({ glyph, focused, primary = false }) {
  return (
    <View style={[styles.tabIcon, primary && styles.tabIconPrimary]}>
      <Text style={[styles.tabGlyph, focused && styles.tabGlyphActive, primary && styles.tabGlyphPrimary]}>
        {glyph}
      </Text>
    </View>
  );
}

function DiscoveryStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="PostsList" component={PostsScreen} />
      <Stack.Screen name="PostDetail" component={PostDetailScreen} />
      <Stack.Screen name="AuthorProfile" component={AuthorProfileScreen} />
      <Stack.Screen name="SpotsList" component={SpotsScreen} />
      <Stack.Screen name="SpotDetail" component={SpotDetailScreen} />
    </Stack.Navigator>
  );
}

function MapStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Map" component={MapScreen} />
    </Stack.Navigator>
  );
}

function CreateStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="NewPost" component={NewPostScreen} />
    </Stack.Navigator>
  );
}

function ProfileStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="ProfileHome" component={ProfileScreen} />
      <Stack.Screen name="PostDetail" component={PostDetailScreen} />
    </Stack.Navigator>
  );
}

export default function App() {
  const [actorReady, setActorReady] = useState(false);

  useEffect(() => {
    let alive = true;
    hydrateActorId().finally(() => {
      if (alive) setActorReady(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  if (!actorReady) {
    return (
      <SafeAreaProvider>
        <View style={styles.viewport}>
          <View style={[styles.mobileShell, styles.bootScreen]}>
            <ActivityIndicator size="small" color="#d93657" />
          </View>
        </View>
        <StatusBar style="dark" />
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <View style={styles.viewport}>
        <View style={styles.mobileShell}>
          <NavigationContainer linking={linking}>
            <Tab.Navigator
              initialRouteName={APP_ROUTES.MAP}
              screenOptions={{
                headerShown: false,
                tabBarActiveTintColor: '#d93657',
                tabBarInactiveTintColor: '#8f8987',
                tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
                tabBarItemStyle: { minWidth: 0 },
                tabBarStyle: {
                  height: 64,
                  paddingTop: 5,
                  paddingBottom: 7,
                  borderTopWidth: 1,
                  borderTopColor: 'rgba(25,25,25,0.08)',
                  backgroundColor: '#ffffff',
                },
              }}
            >
              <Tab.Screen
                name={APP_ROUTES.MAP}
                component={MapStack}
                options={{
                  tabBarLabel: '首页',
                  tabBarIcon: ({ focused }) => <TabIcon glyph="⌖" focused={focused} />,
                }}
              />
              <Tab.Screen
                name={APP_ROUTES.DISCOVERY}
                component={DiscoveryStack}
                options={{
                  tabBarLabel: '发现',
                  tabBarIcon: ({ focused }) => <TabIcon glyph="⌂" focused={focused} />,
                }}
              />
              <Tab.Screen
                name={APP_ROUTES.CREATE}
                component={CreateStack}
                options={{
                  tabBarLabel: '发布',
                  tabBarIcon: ({ focused }) => <TabIcon glyph="＋" focused={focused} primary />,
                }}
              />
              <Tab.Screen
                name={APP_ROUTES.PROFILE}
                component={ProfileStack}
                options={{
                  tabBarLabel: '我的',
                  tabBarIcon: ({ focused }) => <TabIcon glyph="○" focused={focused} />,
                }}
              />
            </Tab.Navigator>
          </NavigationContainer>
        </View>
      </View>
      <StatusBar style="dark" />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  viewport: {
    flex: 1,
    width: '100%',
    minHeight: '100%',
    alignItems: 'center',
    backgroundColor: '#e9e6e2',
  },
  mobileShell: {
    flex: 1,
    width: '100%',
    maxWidth: 480,
    overflow: 'hidden',
    backgroundColor: '#f8f7f6',
    shadowColor: '#1c1c1c',
    shadowOpacity: 0.12,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 0 },
    elevation: 4,
  },
  tabIcon: {
    width: 25,
    height: 23,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabIconPrimary: {
    width: 34,
    height: 28,
    borderRadius: 9,
    backgroundColor: '#d93657',
  },
  tabGlyph: {
    color: '#8f8987',
    fontSize: 21,
    lineHeight: 22,
    fontWeight: '600',
  },
  tabGlyphActive: {
    color: '#d93657',
  },
  tabGlyphPrimary: {
    color: '#ffffff',
    fontSize: 21,
    lineHeight: 24,
  },
  bootScreen: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f8f7f6',
  },
});
