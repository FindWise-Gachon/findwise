// 예를 들어
// bukhansan---test 지역에서 저장하면
// findwise:markers:bukhansan---test 키로 저장되고
// 이후에도 계속 유지된 채 저장됨

import type { MapMarker, MarkerType } from "./markerTypes";

// Each region uses a separate storage key.
function getStorageKey(region: string): string {
  return `findwise:markers:${region}`;
}

// Check whether loaded data is a valid marker.
function isMapMarker(value: unknown): value is MapMarker {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const marker = value as Record<string, unknown>;

  const validTypes: MarkerType[] = [
    "report",
    "cctv",
    "search",
  ];

  return (
    typeof marker.id === "string" &&
    typeof marker.type === "string" &&
    validTypes.includes(marker.type as MarkerType) &&
    typeof marker.latitude === "number" &&
    Number.isFinite(marker.latitude) &&
    marker.latitude >= -90 &&
    marker.latitude <= 90 &&
    typeof marker.longitude === "number" &&
    Number.isFinite(marker.longitude) &&
    marker.longitude >= -180 &&
    marker.longitude <= 180 &&
    typeof marker.recordedAt === "string" &&
    typeof marker.comment === "string" &&
    typeof marker.searched === "boolean"
  );
}

// Load saved markers.
export function loadMarkers(region: string): MapMarker[] {
  try {
    const saved = localStorage.getItem(getStorageKey(region));

    if (saved === null) {
      return [];
    }

    const parsed: unknown = JSON.parse(saved);

    if (!Array.isArray(parsed)) {
      console.warn("Invalid saved marker data.");
      return [];
    }

    return parsed.filter(isMapMarker);
  } catch (error) {
    console.error("Failed to load markers:", error);
    return [];
  }
}

// Save markers.
export function saveMarkers(
  region: string,
  markers: MapMarker[]
): boolean {
  try {
    localStorage.setItem(
      getStorageKey(region),
      JSON.stringify(markers)
    );

    return true;
  } catch (error) {
    console.error("Failed to save markers:", error);
    return false;
  }
}
