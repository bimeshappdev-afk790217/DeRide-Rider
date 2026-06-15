import React, { useState, useEffect } from "react";
import * as Updates from "expo-updates";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { Text } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { ThemeProvider, useTheme } from "./src/theme/ThemeContext";
import { HomeScreen }           from "./src/screens/HomeScreen";
import { RideProgressScreen }  from "./src/screens/RideProgressScreen";
import { RideHistoryScreen }   from "./src/screens/RideHistoryScreen";
import { ProfileScreen }       from "./src/screens/ProfileScreen";
import { RegisterScreen }      from "./src/screens/RegisterScreen";
import { Colors } from "./src/theme";

const Stack = createNativeStackNavigator();
const Tab   = createBottomTabNavigator();

type AppState = "loading" | "register" | "ready";

const TabNavigator = () => {
  const { colors } = useTheme();
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor:  colors.border,
          borderTopWidth:  1,
          paddingBottom:   8,
          paddingTop:      8,
          height:          64,
        },
        tabBarActiveTintColor:   Colors.brand,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarLabelStyle: { fontSize: 10, fontWeight: "600" },
      }}
    >
      <Tab.Screen
        name="Home"
        component={HomeScreen}
        options={{
          tabBarLabel: "Ride",
          tabBarIcon: ({ focused }) => (
            <Text style={{ fontSize: 20, opacity: focused ? 1 : 0.4 }}>🚗</Text>
          ),
        }}
      />
      <Tab.Screen
        name="History"
        component={RideHistoryScreen}
        options={{
          tabBarLabel: "History",
          tabBarIcon: ({ focused }) => (
            <Text style={{ fontSize: 20, opacity: focused ? 1 : 0.4 }}>📋</Text>
          ),
        }}
      />
      <Tab.Screen
        name="Profile"
        component={ProfileScreen}
        options={{
          tabBarLabel: "Profile",
          tabBarIcon: ({ focused }) => (
            <Text style={{ fontSize: 20, opacity: focused ? 1 : 0.4 }}>👤</Text>
          ),
        }}
      />
    </Tab.Navigator>
  );
};

const AppNavigator = ({ appState, setAppState }: { appState: AppState; setAppState: (s: AppState) => void }) => {
  const { colors } = useTheme();

  if (appState === "loading") return null;

  if (appState === "register") {
    return <RegisterScreen onRegistered={() => setAppState("ready")} />;
  }

  return (
    <NavigationContainer>
      <Stack.Navigator
        screenOptions={{
          headerStyle:         { backgroundColor: colors.surface },
          headerTintColor:     colors.text,
          headerTitleStyle:    { fontWeight: "700" },
          headerShadowVisible: false,
        }}
      >
        <Stack.Screen
          name="Main"
          component={TabNavigator}
          options={{ headerShown: false }}
        />
        <Stack.Screen
          name="RideProgress"
          component={RideProgressScreen}
          options={{ title: "Your Ride", headerBackTitle: "" }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
};

async function checkForUpdates() {
  try {
    const update = await Updates.checkForUpdateAsync();
    if (update.isAvailable) {
      await Updates.fetchUpdateAsync();
      await Updates.reloadAsync();
    }
  } catch (e) {
    console.log("Update check failed:", e);
  }
}

function AppContent() {
  const [appState, setAppState] = useState<AppState>("loading");

  useEffect(() => {
    checkForUpdates();
    checkWallet();
  }, []);

  const checkWallet = async () => {
    try {
      const wallet = await AsyncStorage.getItem("rider_wallet_address");
      setAppState(wallet ? "ready" : "register");
    } catch {
      setAppState("register");
    }
  };

  return <AppNavigator appState={appState} setAppState={setAppState} />;
}

export default function App() {
  return (
    <ThemeProvider>
      <AppContent />
    </ThemeProvider>
  );
}
