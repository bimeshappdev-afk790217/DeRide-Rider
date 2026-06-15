// mapType='none' suppresses all Google tile requests — the Google Maps SDK initialises
// normally (providing coordinate transforms, fitToCoordinates, etc.) but makes no
// authenticated tile requests to Google's servers, so no API key is validated.
// MapUrlTile then loads OSM tiles on top of the blank canvas.
export const HAS_GOOGLE_MAPS_KEY =
  (process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ?? '').length > 0;

export const OSM_TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
