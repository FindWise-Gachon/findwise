import { useEffect, useRef } from 'react'
import * as maplibregl from 'maplibre-gl'
import type { Map as MapInstance } from 'maplibre-gl'
import mlcontour from 'maplibre-contour'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import 'maplibre-gl/dist/maplibre-gl.css'
import { analysisGrid, region, sources, type MapSettings } from './config'

import { boundary, emptyGrid, gridExtent, gridMinZoom, toLngLat, visibleGrid } from './grid'
import { distanceBands, type DistanceRun } from './distance'
import type { Timeline } from './timeline'
import type { MapStatusEvent } from './status'

maplibregl.setWorkerUrl(workerUrl)

function updateGrid(map: MapInstance, settings: MapSettings) {
  const source = map.getSource<maplibregl.GeoJSONSource>('analysis-grid')
  if (!source) return
  const b = map.getBounds()
  source.setData(settings.grid ? visibleGrid(analysisGrid, [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()], map.getZoom()) : emptyGrid)
}

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
  map.setLayoutProperty('analysis-boundary', 'visibility', settings.area ? 'visible' : 'none')
  map.setLayoutProperty('analysis-grid-lines', 'visibility', settings.grid ? 'visible' : 'none')
  updateGrid(map, settings)
  map.setPaintProperty('contours', 'line-opacity', settings.opacity / 100)
  map.setPaintProperty('contours', 'line-color', settings.base === 'satellite' ? '#f0e7ba' : '#6c674e')
}
const [west, south, east, north] = gridExtent(analysisGrid)
const rasterCorners: [[number, number], [number, number], [number, number], [number, number]] = [
  toLngLat(analysisGrid, [west, north]), toLngLat(analysisGrid, [east, north]),
  toLngLat(analysisGrid, [east, south]), toLngLat(analysisGrid, [west, south]),
]

function showHeatmap(map: MapInstance, run: DistanceRun | null, timeline: Timeline | null, step: number) {
  if (!map.getLayer('analysis-grid-lines')) return
  if (map.getSource('distance-raster')) {
    map.removeLayer('distance-raster')
    map.removeSource('distance-raster')
  }
  if (!run && !timeline) return

  const canvas = document.createElement('canvas')
  canvas.width = analysisGrid.columns
  canvas.height = analysisGrid.rows
  const context = canvas.getContext('2d')
  if (!context) return
  const image = context.createImageData(canvas.width, canvas.height)
  if (timeline) {
    for (const [index, mass] of timeline.frames[step].cells) {
      const intensity = Math.sqrt(mass / timeline.maxMass)
      image.data.set([138 + 117 * intensity, 84 + 137 * intensity, 208 - 61 * intensity, 80 + 130 * intensity], index * 4)
    }
  } else if (run) {
    let first = 0
    for (const band of distanceBands) {
      const end = Math.ceil(band.end * run.order.length)
      for (let rank = first; rank < end; rank++) {
        image.data.set(band.color, run.order[rank] * 4)
      }
      first = end
    }
  }
  context.putImageData(image, 0, 0)
  map.addSource('distance-raster', { type: 'canvas', canvas, coordinates: rasterCorners, animate: false })
  map.addLayer({ id: 'distance-raster', type: 'raster', source: 'distance-raster',
    paint: { 'raster-resampling': 'nearest', 'raster-fade-duration': 0 } }, 'contours')

}

export function MapView({ settings, onReady, onStatus, onZoom, distanceRun, timeline, timelineStep, picking, onPick, casePoint, pointPending, onPointInfo }: {
  settings: MapSettings
  onReady: (map: MapInstance | null) => void
  onStatus: (event: MapStatusEvent) => void
  onZoom: (z: number) => void
  distanceRun: DistanceRun | null
  timeline: Timeline | null
  timelineStep: number
  casePoint: [number, number] | null
  pointPending: boolean
  onPointInfo: () => void
  picking: boolean
  onPick: (start: [number, number]) => void
}) {
  const container = useRef<HTMLDivElement>(null)
  const coordinates = useRef<HTMLOutputElement>(null)
  const mapRef = useRef<MapInstance | null>(null)
  const latest = useRef(settings)
  useEffect(() => {
    if (!container.current) return
    let map: MapInstance
    try {
      const terrain = elevation()
      map = new maplibregl.Map({ container: container.current, center: region.center, zoom: region.zoom, minZoom: 9, maxZoom: 17, attributionControl: false,
        style: { version: 8, sources: {
          'analysis-area': { type: 'geojson', data: boundary(analysisGrid) },
          'analysis-grid': { type: 'geojson', data: emptyGrid },
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
          { id: 'analysis-grid-lines', type: 'line', source: 'analysis-grid', minzoom: gridMinZoom, layout: { visibility: 'none' }, paint: { 'line-color': '#18a5a0', 'line-opacity': .6, 'line-width': .7 } },
          { id: 'analysis-boundary', type: 'line', source: 'analysis-area', paint: { 'line-color': '#087e80', 'line-width': 2, 'line-dasharray': [5, 3] } },
        ] },
      })
    } catch {
      onStatus('startup-error')
      return
    }
    mapRef.current = map
    onReady(map)
    map.addControl(new maplibregl.ScaleControl({ maxWidth: 130, unit: 'metric' }), 'bottom-right')
    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right')
    const onError = () => onStatus('error')
    const onIdle = () => onStatus('idle')
    map.on('error', onError)
    map.once('style.load', () => apply(map, latest.current))
    map.once('idle', onIdle)
    const coordinateOutput = coordinates.current
    if (coordinateOutput) {
      map.on('mousemove', ({ lngLat }) => {
        const { lng, lat } = lngLat.wrap()
        coordinateOutput.textContent = `위도 ${lat.toFixed(5)} · 경도 ${lng.toFixed(5)}`
        coordinateOutput.hidden = false
      })
      map.on('mouseout', () => { coordinateOutput.hidden = true })
    }
    map.on('zoom', () => onZoom(map.getZoom()))
    map.on('moveend', () => updateGrid(map, latest.current))
    const observer = new ResizeObserver(() => map.resize())
    observer.observe(container.current)
    return () => {
      observer.disconnect()
      map.off('error', onError)
      map.off('idle', onIdle)
      onReady(null)
      mapRef.current = null
      map.remove()
    }
  }, [onReady, onStatus, onZoom])
  useEffect(() => {
    latest.current = settings
    if (mapRef.current) apply(mapRef.current, settings)
  }, [settings])
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const update = () => showHeatmap(map, settings.heatmap ? distanceRun : null, settings.heatmap ? timeline : null, timelineStep)
    map.on('style.load', update)
    update()
    return () => { map.off('style.load', update) }
  }, [distanceRun, timeline, timelineStep, settings.heatmap])
  useEffect(() => {
    const map = mapRef.current
    if (!map || !casePoint) return
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'case-marker'
    button.setAttribute('aria-label', pointPending ? '선택한 위치 정보' : '마지막 확인 위치 정보')
    const label = document.createElement('span')
    label.className = 'case-marker-label'
    label.textContent = pointPending ? '선택 위치' : '마지막 확인'
    button.append(label)
    button.addEventListener('click', event => { event.stopPropagation(); if (picking) onPick(casePoint); else onPointInfo() })
    const marker = new maplibregl.Marker({ element: button }).setLngLat(casePoint).addTo(map)
    return () => { marker.remove() }
  }, [casePoint, pointPending, onPointInfo, picking, onPick])
  useEffect(() => {
    const map = mapRef.current
    if (!map || !picking) return
    const canvas = map.getCanvas()
    const select = (event: maplibregl.MapMouseEvent) => {
      const { lng, lat } = event.lngLat.wrap()
      onPick([lng, lat])
    }
    canvas.style.cursor = 'crosshair'
    map.on('click', select)
    return () => {
      canvas.style.cursor = ''
      map.off('click', select)
    }
  }, [picking, onPick])
  return <>
    <div ref={container} className="map-canvas" aria-label={`${region.shortName} 지도`} />
    <output ref={coordinates} className="cursor-coordinates" aria-live="off" hidden />
  </>
}
