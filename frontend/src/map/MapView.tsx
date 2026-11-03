import { useEffect, useRef } from 'react'
import * as maplibregl from 'maplibre-gl'
import type { Map as MapInstance } from 'maplibre-gl'
import mlcontour from 'maplibre-contour'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
maplibregl.setWorkerUrl(workerUrl)
import 'maplibre-gl/dist/maplibre-gl.css'
import { region, sources, type MapSettings } from './config'

let dem: InstanceType<typeof mlcontour.DemSource> | undefined
function elevation() {
  if (!dem) {
    dem = new mlcontour.DemSource({ url: sources.elevation.url, encoding: 'terrarium', maxzoom: 13, worker: true, cacheSize: 100, timeoutMs: 15000 })
    dem.setupMaplibre(maplibregl)
  }
  return dem
}
function apply(map: MapInstance, settings: MapSettings) {
  if (!map.getLayer('base')) return
  map.setLayoutProperty('base', 'visibility', settings.base === 'base' ? 'visible' : 'none')
  map.setLayoutProperty('satellite', 'visibility', settings.base === 'satellite' ? 'visible' : 'none')
  map.setLayoutProperty('contours', 'visibility', settings.contours ? 'visible' : 'none')
  map.setLayoutProperty('hillshade', 'visibility', settings.hillshade ? 'visible' : 'none')
  map.setPaintProperty('contours', 'line-opacity', settings.opacity / 100)
  map.setPaintProperty('contours', 'line-color', settings.base === 'satellite' ? '#f0e7ba' : '#6c674e')
}
export function MapView({ settings, onReady, onStatus, onZoom }: { settings: MapSettings; onReady: (map: MapInstance | null) => void; onStatus: (s: string) => void; onZoom: (z: number) => void }) {
  const container = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapInstance | null>(null)
  const latest = useRef(settings)
  latest.current = settings
  useEffect(() => {
    if (!container.current) return
    let map: MapInstance
    try {
      const terrain = elevation()
      map = new maplibregl.Map({ container: container.current, center: region.center, zoom: region.zoom, minZoom: 9, maxZoom: 17, attributionControl: false,
        style: { version: 8, sources: {
          base: { type: 'raster', tiles: [sources.base.url], tileSize: 256, maxzoom: 19, attribution: sources.base.attribution },
          satellite: { type: 'raster', tiles: [sources.satellite.url], tileSize: 256, maxzoom: 19, attribution: sources.satellite.attribution },
          dem: { type: 'raster-dem', tiles: [terrain.sharedDemProtocolUrl], encoding: 'terrarium', tileSize: 256, maxzoom: 13, attribution: sources.elevation.attribution },
          contours: { type: 'vector', tiles: [terrain.contourProtocolUrl({ thresholds: { 9: [100, 500], 12: [50, 200], 14: [20, 100] }, contourLayer: 'contours', elevationKey: 'ele', levelKey: 'level' })], maxzoom: 15, attribution: sources.elevation.attribution },
        }, layers: [
          { id: 'background', type: 'background', paint: { 'background-color': '#dce4d5' } },
          { id: 'base', type: 'raster', source: 'base', paint: { 'raster-saturation': -.35 } },
          { id: 'satellite', type: 'raster', source: 'satellite', layout: { visibility: 'none' } },
          { id: 'hillshade', type: 'hillshade', source: 'dem', paint: { 'hillshade-exaggeration': .32, 'hillshade-shadow-color': '#465549', 'hillshade-highlight-color': '#fff9e4' } },
          { id: 'contours', type: 'line', source: 'contours', 'source-layer': 'contours', paint: { 'line-color': '#6c674e', 'line-opacity': .65, 'line-width': ['match', ['get', 'level'], 1, 1.1, .45] } },
        ] },
      })
    } catch {
      onStatus('지도를 시작하지 못했습니다. WebGL 지원과 브라우저 설정을 확인해 주세요.')
      return
    }
    mapRef.current = map
    onReady(map)
    map.addControl(new maplibregl.ScaleControl({ maxWidth: 130, unit: 'metric' }), 'bottom-right')
    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right')
    const errors = new Set<string>()
    map.on('load', () => { apply(map, latest.current); onStatus('지도 연결됨') })
    map.on('error', (event) => {
      errors.add(('sourceId' in event && typeof event.sourceId === 'string') ? event.sourceId : 'map')
      onStatus('일부 지도 자료를 불러오지 못했습니다. 연결을 확인하고 다시 시도해 주세요.')
    })
    map.on('sourcedata', (event) => {
      if (event.isSourceLoaded && event.sourceId) errors.delete(event.sourceId)
    })
    map.on('idle', () => { if (!errors.size) onStatus('지도 연결됨') })
    map.on('zoom', () => onZoom(map.getZoom()))
    const observer = new ResizeObserver(() => map.resize())
    observer.observe(container.current)
    return () => { observer.disconnect(); onReady(null); mapRef.current = null; map.remove() }
  }, [onReady, onStatus, onZoom])
  useEffect(() => { if (mapRef.current?.getLayer('base')) apply(mapRef.current, settings) }, [settings])
  return <div ref={container} className="map-canvas" aria-label="요세미티 지도" />
}
