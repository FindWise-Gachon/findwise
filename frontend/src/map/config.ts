import { defaultRegionId, findRegion, regions } from './regions.ts'

const regionId = typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('region')
export const region = (regionId && findRegion(regionId)) || regions[defaultRegionId]
export const analysisGrid = region.grid

export const sources = {
  base: { url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap contributors</a>' },
  satellite: { url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', attribution: 'Imagery © Esri, Maxar, Earthstar Geographics, and the GIS User Community' },
  elevation: { url: 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png', attribution: 'Elevation: <a href="https://registry.opendata.aws/terrain-tiles/" target="_blank">Mapzen / AWS Terrain Tiles</a>' },
}
export type TerrainImage = 'none' | 'elevation' | 'slope'
export type MapSettings = { base: 'base' | 'satellite'; contours: boolean; hillshade: boolean; opacity: number; area: boolean; grid: boolean; trail: boolean; road: boolean; river: boolean; water: boolean; access: boolean; heatmap: boolean; terrainImage: TerrainImage }
export const defaults: MapSettings = { base: 'base', contours: true, hillshade: true, opacity: 65, area: true, grid: false, trail: true, road: true, river: true, water: true, access: false, heatmap: true, terrainImage: 'none' }
export function readSettings(): MapSettings {
  try {
    const s = JSON.parse(localStorage.getItem('findwise.map.v1') || '{}')
    return { trail: typeof s.trail === 'boolean' ? s.trail : true,
      road: typeof s.road === 'boolean' ? s.road : true,
      river: typeof s.river === 'boolean' ? s.river : true,
      water: typeof s.water === 'boolean' ? s.water : true,
      access: typeof s.access === 'boolean' ? s.access : false,
      terrainImage: s.terrainImage === 'elevation' || s.terrainImage === 'slope' ? s.terrainImage : 'none',
      heatmap: typeof s.heatmap === 'boolean' ? s.heatmap : true,
      area: typeof s.area === 'boolean' ? s.area : true, grid: typeof s.grid === 'boolean' ? s.grid : false, base: s.base === 'satellite' ? 'satellite' : 'base', contours: typeof s.contours === 'boolean' ? s.contours : true, hillshade: typeof s.hillshade === 'boolean' ? s.hillshade : true, opacity: typeof s.opacity === 'number' && Number.isFinite(s.opacity) ? Math.max(0, Math.min(100, s.opacity)) : 65 }
  } catch { return defaults }
}
