/**
 * FindWise common map marker types
 *
 * Used by both urban (Kakao Maps)
 * and mountain (MapLibre) maps.
 */

// Marker categories
export type MarkerType = "report" | "cctv" | "search";

// Report verification status
export type ReportStatus =
  | "unverified"
  | "reviewing"
  | "verified";

// Common marker data structure
export type MapMarker = {
  id: string;
  type: MarkerType;

  // WGS84 coordinates (EPSG:4326)
  latitude: number;
  longitude: number;

  // Marker information
  recordedAt: string;
  comment: string;

  // Search completion status
  searched: boolean;

  // Optional information
  name?: string;
  reportStatus?: ReportStatus;
};

// Marker category labels
export const markerTypeLabels: Record<MarkerType, string> = {
  report: "제보",
  cctv: "CCTV",
  search: "수색",
};

// Marker colors
export const markerTypeColors: Record<MarkerType, string> = {
  report: "#E45A45",
  cctv: "#3276D4",
  search: "#E4A62B",
};

// Search completion color
export const searchedMarkerColor = "#111111";
