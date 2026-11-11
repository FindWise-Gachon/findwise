import { validateGrid } from './grid.ts'

export const defaultRegionId = 'yosemite-valley'

export const regions = {
  [defaultRegionId]: {
    id: defaultRegionId, name: '요세미티 국립공원', shortName: '요세미티', placeName: 'Yosemite Valley',
    location: '미국 · 캘리포니아', placeContext: 'California', center: [-119.59, 37.745] as [number, number], zoom: 12,
    terrainAsset: 'yosemite.geojson', terrain: { type: 'prepared', file: 'yosemite-terrain-v2.geojson' },
    terrainImages: null, demFile: 'yosemite-terrain.npz', demEnv: 'FINDWISE_DEM_NPZ',
    grid: validateGrid({
      id: 'yosemite-valley-dev-6m-v1', crs: 'EPSG:32611',
      projection: '+proj=utm +zone=11 +datum=WGS84 +units=m +no_defs',
      origin: [268800, 4183680], cellSizeM: 6, rows: 1000, columns: 1000,
    }),
  },
  bukhansan: {
    id: 'bukhansan', name: '북한산 국립공원', shortName: '북한산', placeName: 'Bukhansan',
    location: '한국 · 서울·경기', placeContext: 'South Korea', center: [126.985, 37.658] as [number, number], zoom: 12,
    terrainAsset: 'bukhansan.geojson', terrain: { type: 'lines', files: [
      { path: 'bukhansan-demo/trails.geojson', kind: 'trail', fallbackName: '이름 없는 등산로' },
      { path: 'bukhansan-demo/waterways.geojson', kind: 'river', fallbackName: '이름 없는 하천' },
    ] },
    terrainImages: { elevation: 'bukhansan-demo/elevation.png', slope: 'bukhansan-demo/slope.png' },
    demFile: 'bukhansan-terrain.npz', demEnv: 'FINDWISE_BUKHANSAN_DEM_NPZ',
    grid: validateGrid({
      id: 'bukhansan---test-grid', crs: 'EPSG:5179',
      projection: '+proj=tmerc +lat_0=38 +lon_0=127.5 +k=0.9996 +x_0=1000000 +y_0=2000000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs',
      origin: [949970, 1971170], cellSizeM: 10, rows: 1584, columns: 980,
    }),
  },
} as const

export type Region = typeof regions[keyof typeof regions]

export function findRegion(id: string): Region | undefined {
  return Object.hasOwn(regions, id) ? regions[id as keyof typeof regions] : undefined
}
