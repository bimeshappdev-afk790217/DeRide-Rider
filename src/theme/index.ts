export const Colors = {
  brand:       "#00E5A0",
  brandDim:    "#00B87C",
  brandGlow:   "rgba(0, 229, 160, 0.15)",

  dark: {
    bg:          "#0A0A0F",
    surface:     "#13131A",
    surfaceAlt:  "#1A1A24",
    border:      "#2A2A38",
    borderBright:"#3A3A50",
    text:        "#F0F0FF",
    textSub:     "#8888AA",
    textMuted:   "#555570",
    overlay:     "rgba(0,0,0,0.6)",
  },

  light: {
    bg:          "#F4F4F8",
    surface:     "#FFFFFF",
    surfaceAlt:  "#EBEBF0",
    border:      "#E0E0E8",
    borderBright:"#C8C8D8",
    text:        "#0A0A1A",
    textSub:     "#555570",
    textMuted:   "#9999B0",
    overlay:     "rgba(0,0,0,0.3)",
  },

  success:  "#00E5A0",
  warning:  "#FFB800",
  error:    "#FF4560",
  info:     "#0090FF",
  mapDriver:   "#00E5A0",
  mapRider:    "#0090FF",
  mapRoute:    "#00E5A0",
};

export const Typography = {
  display: { fontFamily: "System", letterSpacing: -1 },
  mono:    { fontFamily: "Courier", letterSpacing: 0.3 },
  ui:      { fontFamily: "System", letterSpacing: 0.1 },
  sizes: {
    xs:    10,
    sm:    12,
    md:    14,
    base:  16,
    lg:    18,
    xl:    22,
    "2xl": 28,
    "3xl": 36,
    "4xl": 48,
  },
};

export const Spacing = {
  xs:    4,
  sm:    8,
  md:    12,
  base:  16,
  lg:    20,
  xl:    24,
  "2xl": 32,
  "3xl": 48,
  "4xl": 64,
};

export const Radius = {
  sm:   6,
  md:   12,
  lg:   16,
  xl:   24,
  full: 9999,
};

export const Shadow = {
  sm: { shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.15, shadowRadius: 4, elevation: 2 },
  md: { shadowColor: "#000", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2,  shadowRadius: 8, elevation: 4 },
  lg: { shadowColor: "#000", shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.25, shadowRadius: 16, elevation: 8 },
  brand: { shadowColor: "#00E5A0", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 12, elevation: 6 },
};
