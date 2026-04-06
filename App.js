import React from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { StatusBar } from 'expo-status-bar';

import { APP_ROUTES } from './src/constants/routes';

import MapScreen from './src/screens/MapScreen';
import PostsScreen from './src/screens/PostsScreen';
import SpotDetailScreen from './src/screens/SpotDetailScreen';
import SpotsScreen from './src/screens/SpotsScreen';
import PostDetailScreen from './src/screens/PostDetailScreen';
import NewPostScreen from './src/screens/NewPostScreen';
import ProfileScreen from './src/screens/ProfileScreen';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

function DiscoveryStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="PostsList" component={PostsScreen} />
      <Stack.Screen name="PostDetail" component={PostDetailScreen} />
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
  return (
    <SafeAreaProvider>
      <NavigationContainer>
        <Tab.Navigator
          initialRouteName={APP_ROUTES.MAP}
          screenOptions={{
            headerShown: false,
            tabBarActiveTintColor: '#d93657',
            tabBarInactiveTintColor: '#8f8987',
            tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
            tabBarStyle: {
              height: 58,
              paddingTop: 5,
              paddingBottom: 6,
              borderTopWidth: 1,
              borderTopColor: 'rgba(25,25,25,0.08)',
              backgroundColor: '#ffffff',
            },
          }}
        >
          <Tab.Screen
            name={APP_ROUTES.DISCOVERY}
            component={DiscoveryStack}
            options={{ tabBarLabel: '发现' }}
          />
          <Tab.Screen
            name={APP_ROUTES.MAP}
            component={MapStack}
            options={{ tabBarLabel: '地图' }}
          />
          <Tab.Screen
            name={APP_ROUTES.CREATE}
            component={CreateStack}
            options={{ tabBarLabel: '发布' }}
          />
          <Tab.Screen
            name={APP_ROUTES.PROFILE}
            component={ProfileStack}
            options={{ tabBarLabel: '我的' }}
          />
        </Tab.Navigator>
      </NavigationContainer>
      <StatusBar style="dark" />
    </SafeAreaProvider>
  );
}
