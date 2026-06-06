import React, { createContext, useContext } from "react";
import { useColorScheme } from "react-native";
import { Colors } from "./index";

type ThemeMode = "dark" | "light";

interface ThemeContextValue {
  mode:   ThemeMode;
  colors: typeof Colors.dark;
  isDark: boolean;
}

const ThemeContext = createContext<ThemeContextValue>({
  mode:   "dark",
  colors: Colors.dark,
  isDark: true,
});

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const scheme = useColorScheme();
  const isDark  = scheme !== "light";
  const mode: ThemeMode = isDark ? "dark" : "light";
  const colors = isDark ? Colors.dark : Colors.light;

  return (
    <ThemeContext.Provider value={{ mode, colors, isDark }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => useContext(ThemeContext);
