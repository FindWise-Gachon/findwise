import { validateGrid } from './grid'
export const region = {
  id: 'yosemite-valley', name: '요세미티 국립공원', subtitle: 'Yosemite Valley · California',
  center: [-119.59, 37.745] as [number, number], zoom: 12,
}
export const sources = {
  base: { url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap contributors</a>' },
  satellite: { url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', attribution: 'Imagery © Esri, Maxar, Earthstar Geographics, and the GIS User Community' },
  elevation: { url: 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png', attribution: 'Elevation: <a href="https://registry.opendata.aws/terrain-tiles/" target="_blank">Mapzen / AWS Terrain Tiles</a>' },
}
export type MapSettings = { base: 'base' | 'satellite'; contours: boolean; hillshade: boolean; opacity: number; area: boolean; grid: boolean }
export const defaults: MapSettings = { base: 'base', contours: true, hillshade: true, opacity: 65, area: true, grid: false }
export function readSettings(): MapSettings {
  try {
    const s = JSON.parse(localStorage.getItem('findwise.map.v1') || '{}')
    return { area: typeof s.area === 'boolean' ? s.area : true, grid: typeof s.grid === 'boolean' ? s.grid : false, base: s.base === 'satellite' ? 'satellite' : 'base', contours: typeof s.contours === 'boolean' ? s.contours : true, hillshade: typeof s.hillshade === 'boolean' ? s.hillshade : true, opacity: typeof s.opacity === 'number' && Number.isFinite(s.opacity) ? Math.max(0, Math.min(100, s.opacity)) : 65 }
  } catch { return defaults }
}

// Fixed, projected development area. Do not choose an evaluation extent using find locations.
export const analysisGrid = validateGrid({
  id: 'yosemite-valley-dev-6m-v1', crs: 'EPSG:32611',
  projection: '+proj=utm +zone=11 +datum=WGS84 +units=m +no_defs',
  origin: [268800, 4183680], cellSizeM: 6, rows: 1000, columns: 1000,
})
