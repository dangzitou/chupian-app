import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Text } from 'react-native';
import { COLORS } from './src/config';

import MapScreen from './src/screens/MapScreen';
import SpotsScreen from './src/screens/SpotsScreen';
import SpotDetailScreen from './src/screens/SpotDetailScreen';
import PostsScreen from './src/screens/PostsScreen';
import PostDetailScreen from './src/screens/PostDetailScreen';
import NewPostScreen from './src/screens/NewPostScreen';
import ProfileScreen from './src/screens/ProfileScreen';

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

const tabIcon = (name) => ({ color, size }) => {
  const icons = {
    地图: '🗺️',
    点位: '📍',
    攻略: '📖',
    我的: '👤',
  };
  return <Text style={{ fontSize: size * 0.9, color }}>{icons[name] || '•'}</Text>;
};

function SpotsStack() {
  return (
    <Stack.Navigator screenOptions={{ headerStyle: { backgroundColor: COLORS.panel }, headerTintColor: COLORS.ink, headerTitleStyle: { fontWeight: '700' } }}>
      <Stack.Screen name="SpotsList" component={SpotsScreen} options={{ headerShown: false }} />
      <Stack.Screen name="SpotDetail" component={SpotDetailScreen} options={({ route }) => ({ title: route.params?.name || '点位详情' })} />
    </Stack.Navigator>
  );
}

function PostsStack() {
  return (
    <Stack.Navigator screenOptions={{ headerStyle: { backgroundColor: COLORS.panel }, headerTintColor: COLORS.ink, headerTitleStyle: { fontWeight: '700' } }}>
      <Stack.Screen name="PostsList" component={PostsScreen} options={{ headerShown: false }} />
      <Stack.Screen name="PostDetail" component={PostDetailScreen} options={({ route }) => ({ title: route.params?.title || '攻略详情' })} />
      <Stack.Screen name="NewPost" component={NewPostScreen} options={{ title: '发攻略' }} />
    </Stack.Navigator>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <NavigationContainer>
        <Tab.Navigator
          screenOptions={({ route }) => ({
            tabBarIcon: tabIcon(route.name),
            tabBarActiveTintColor: COLORS.accent,
            tabBarInactiveTintColor: COLORS.muted,
            tabBarStyle: { backgroundColor: COLORS.panel, borderTopColor: COLORS.line },
            headerShown: false,
          })}
        >
          <Tab.Screen name="地图" component={MapScreen} />
          <Tab.Screen name="点位" component={SpotsStack} />
          <Tab.Screen name="攻略" component={PostsStack} />
          <Tab.Screen name="我的" component={ProfileScreen} />
        </Tab.Navigator>
      </NavigationContainer>
      <StatusBar style="dark" />
    </SafeAreaProvider>
  );
}
