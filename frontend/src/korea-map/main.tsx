import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import * as maplibregl from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import 'maplibre-gl/dist/maplibre-gl.css'

import MarkerForm from '../markers/MarkerForm'
import {
  addMarkerLayer,
  getTimeOrder,
} from '../markers/MarkerLayer'
import type { MapMarker } from '../markers/markerTypes'

import {
  boundary,
  visibleGrid,
  emptyGrid,
  toLngLat,
  type GridSpec,
} from '../map/grid'

import {
  loadMarkers,
  saveMarkers,
} from '../markers/markerStorage'

import {
  Mountain,
  Folder,
  MapPin,
  Layers,
  ListFilter,
  PlusCircle,
} from 'lucide-react'

maplibregl.setWorkerUrl(workerUrl)

type TerrainLayer = 'none' | 'elevation' | 'slope'

type SidebarMenu = 'coordinates' | 'terrain' | 'visibility' | 'register'

type RegionManifest = {
  region_id: string
  grid: string
  trails: string
  waterways: string
  elevation: string
  slope: string
  bounds_projected: [number, number, number, number]
  crs: string
}

const requestedRegion = new URLSearchParams(window.location.search).get('region') || 'bukhansan-pipeline-test'
const region = /^[a-z0-9][a-z0-9_-]*$/.test(requestedRegion)
  ? requestedRegion
  : 'bukhansan-pipeline-test' 


const regionNames: Record<string, string> = {
  bukhansan: '북한산',
  seoraksan: '설악산',
  jirisan: '지리산',
  hallasan: '한라산',
  gyeryongsan: '계룡산',
}

function getRegionDisplayName(regionId: string): string {
  const regionKey = regionId.split(/[-_]/)[0].toLowerCase()
  return regionNames[regionKey] ?? regionId
}

const regionDisplayName = getRegionDisplayName(region)


function BukhansanMap() {
  const [activeMenu, setActiveMenu] = useState<SidebarMenu | null>(null)
  const [selectedCoordinate, setSelectedCoordinate] = useState<{
  latitude: number
  longitude: number
} | null>(null)
  const container = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)

  const [message, setMessage] = useState('지도 준비 중...')
  const [terrainLayer, setTerrainLayer] =
    useState<TerrainLayer>('none')
  const [mapReady, setMapReady] = useState(false)
  const [markers, setMarkers] = useState<MapMarker[]>(() =>
    loadMarkers(region)
  )

  const [visibleTypes, setVisibleTypes] = useState({
  report: true,
  cctv: true,
  search: true,
})

const [showTimeOrder, setShowTimeOrder] = useState(false)

const panelScrollbarStyle = `
  .findwise-panel-scroll {
    scrollbar-width: thin;
    scrollbar-color: #78918e #232f36;
  }

  .findwise-panel-scroll::-webkit-scrollbar {
    width: 5px;
  }

  .findwise-panel-scroll::-webkit-scrollbar-track {
    background: #232f36;
  }

  .findwise-panel-scroll::-webkit-scrollbar-thumb {
    background: #78918e;
    border-radius: 10px;
  }

  .findwise-panel-scroll::-webkit-scrollbar-thumb:hover {
    background: #a9ded5;
  }
`

  // 1. 지도 생성 및 데이터 연결
  useEffect(() => {
    if (!container.current) return

    let disposed = false

    const map = new maplibregl.Map({
      container: container.current,
      center: [126.985, 37.66],
      zoom: 12,
      style: {
        version: 8,
        sources: {
          osm: {
            type: 'raster',
            tiles: [
              'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
            ],
            tileSize: 256,
            attribution: '© OpenStreetMap contributors',
          },
        },
        layers: [
          {
            id: 'osm',
            type: 'raster',
            source: 'osm',
          },
        ],
      },
    })

    mapRef.current = map
    map.addControl(new maplibregl.NavigationControl())

    map.on('load', async () => {
      try {
        const base = import.meta.env.BASE_URL

        // 2. 지역별 manifest를 먼저 읽고, 파일 경로를 구성
        const regionBase = `${base}terrain/${region}/`
        const manifestResponse = await fetch(`${regionBase}manifest.json`)
        if (!manifestResponse.ok) {
          throw new Error(`${region} manifest.json을 불러오지 못했습니다.`)
        }
        const manifest = (await manifestResponse.json()) as RegionManifest
        if (disposed) return

        // manifest 경로는 지역 폴더 내부의 파일명만 허용
        const fileUrl = (filename: string) => {
          if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(filename) || filename.includes('..')) {
            throw new Error('manifest에 허용되지 않는 파일 경로가 있습니다.')
          }
          return `${regionBase}${filename}`
        }

        const gridResponse = await fetch(fileUrl(manifest.grid))

        if (!gridResponse.ok) {
          throw new Error(
            '지역 격자 파일을 불러오지 못했습니다.'
          )
        }

        const gridData = await gridResponse.json()
        if (disposed) return

        const grid: GridSpec = {
          id: gridData.grid_id,
          crs: gridData.crs,
          projection: gridData.proj4,
          origin: gridData.origin_north_west,
          cellSizeM: gridData.cell_size_m,
          rows: gridData.rows,
          columns: gridData.columns,
        }

        // 3. 격자 분석 범위 표시
        const gridBoundary = boundary(grid)

        map.addSource('bukhansan-boundary', {
          type: 'geojson',
          data: gridBoundary,
        })

        map.addLayer({
          id: 'bukhansan-boundary-line',
          type: 'line',
          source: 'bukhansan-boundary',
          paint: {
            'line-color': '#2b8790',
            'line-width': 4,
            'line-opacity': 0.85,
            'line-dasharray': [5, 3],
          },
        })

        // 4. 10m 격자선 추가
        map.addSource('bukhansan-grid-lines', {
          type: 'geojson',
          data: emptyGrid,
        })

        map.addLayer({
          id: 'bukhansan-grid-lines',
          type: 'line',
          source: 'bukhansan-grid-lines',
          paint: {
            'line-color': '#65b8ad',
            'line-width': 0.6,
            'line-opacity': 0.75,
          },
        })

        const updateGrid = () => {
          const bounds = map.getBounds()

          const gridLines = visibleGrid(
            grid,
            [
              bounds.getWest(),
              bounds.getSouth(),
              bounds.getEast(),
              bounds.getNorth(),
            ],
            map.getZoom()
          )

          const source = map.getSource(
            'bukhansan-grid-lines'
          ) as maplibregl.GeoJSONSource | undefined

          source?.setData(gridLines)
        }

        map.on('moveend', updateGrid)
        updateGrid()

        // 5. 등산로와 하천 GeoJSON 불러오기
        const [trailsResponse, waterwaysResponse] =
          await Promise.all([
            fetch(fileUrl(manifest.trails)),
            fetch(fileUrl(manifest.waterways)),
          ])

        if (!trailsResponse.ok || !waterwaysResponse.ok) {
          throw new Error(
            '등산로 또는 하천 GeoJSON 파일을 불러오지 못했습니다.'
          )
        }

        const trails = await trailsResponse.json()
        const waterways = await waterwaysResponse.json()

        if (disposed) return

        map.addSource('bukhansan-trails', {
          type: 'geojson',
          data: trails,
        })

        map.addSource('bukhansan-waterways', {
          type: 'geojson',
          data: waterways,
        })

        map.addLayer({
          id: 'bukhansan-waterways-line',
          type: 'line',
          source: 'bukhansan-waterways',
          paint: {
            'line-color': '#2585d9',
            'line-opacity': 0.55,
            'line-width': 2.5,
          },
        })

        map.addLayer({
          id: 'bukhansan-trails-line',
          type: 'line',
          source: 'bukhansan-trails',
          paint: {
            'line-color': '#e68a24',
            'line-opacity': 0.55,
            'line-width': 2.5,
          },
        })

        // 6. 고도·경사도 이미지의 지리적 좌표 계산
        const west = grid.origin[0]
        const north = grid.origin[1]

        const east =
          west + grid.columns * grid.cellSizeM

        const south =
          north - grid.rows * grid.cellSizeM

        const corners: [
          [number, number],
          [number, number],
          [number, number],
          [number, number],
        ] = [
          toLngLat(grid, [west, north]),
          toLngLat(grid, [east, north]),
          toLngLat(grid, [east, south]),
          toLngLat(grid, [west, south]),
        ]

        // 지역 격자 네 모서리의 경위도로 화면 자동 맞춤
        const longitudes = corners.map((point) => point[0])
        const latitudes = corners.map((point) => point[1])
        map.fitBounds(
          [
            [Math.min(...longitudes), Math.min(...latitudes)],
            [Math.max(...longitudes), Math.max(...latitudes)],
          ],
          { padding: 45, duration: 0 }
        )

        // 7. 고도 이미지 소스
        map.addSource('bukhansan-elevation', {
          type: 'image',
          url: fileUrl(manifest.elevation),
          coordinates: corners,
        })

        // 8. 경사도 이미지 소스
        map.addSource('bukhansan-slope', {
          type: 'image',
          url: fileUrl(manifest.slope),
          coordinates: corners,
        })

        // 9. 고도·경사도 레이어
        // 등산로·하천·격자선 아래에 배치
        const firstOverlayLayer =
          'bukhansan-boundary-line'

        map.addLayer(
          {
            id: 'bukhansan-elevation-layer',
            type: 'raster',
            source: 'bukhansan-elevation',
            layout: {
              visibility: 'none',
            },
            paint: {
              'raster-opacity': 0.75,
            },
          },
          firstOverlayLayer
        )

        map.addLayer(
          {
            id: 'bukhansan-slope-layer',
            type: 'raster',
            source: 'bukhansan-slope',
            layout: {
              visibility: 'none',
            },
            paint: {
              'raster-opacity': 0.75,
            },
          },
          firstOverlayLayer
        )

        setMessage(
          `${region} 등산로·하천·격자·DEM 데이터 연결 완료`
        )

        setMapReady(true)
      } catch (error) {
        if (disposed) return

        console.error('지역 지도 오류:', error)

        setMessage(
          error instanceof Error
            ? error.message
            : '자료 연결 오류'
        )
      }
    })

    // 지도 컴포넌트 제거 시 정리
    return () => {
      disposed = true
      mapRef.current = null
      map.remove()
    }
  }, [])

  // 10. 고도·경사도 레이어 전환
  useEffect(() => {
    if (!mapReady) return

    const map = mapRef.current
    if (!map) return

    const elevationLayer = 'bukhansan-elevation-layer'
    const slopeLayer = 'bukhansan-slope-layer'

    if (
      !map.getLayer(elevationLayer) ||
      !map.getLayer(slopeLayer)
    ) {
      return
    }

    map.setLayoutProperty(
      elevationLayer,
      'visibility',
      terrainLayer === 'elevation' ? 'visible' : 'none'
    )

    map.setLayoutProperty(
      slopeLayer,
      'visibility',
      terrainLayer === 'slope' ? 'visible' : 'none'
    )
  }, [terrainLayer, mapReady])



  // Coordinate selection on map click
  useEffect(() => {
    if (!mapReady || !mapRef.current) return

    const map = mapRef.current

    const handleMapClick = (event: maplibregl.MapMouseEvent) => {
      // Only select coordinates in coordinate mode
      if (activeMenu !== 'coordinates') return

      setSelectedCoordinate({
        latitude: event.lngLat.lat,
        longitude: event.lngLat.lng,
      })
    }

    map.on('click', handleMapClick)

    return () => {
      map.off('click', handleMapClick)
    }
  }, [mapReady, activeMenu])


  
  // Show a temporary marker at the selected coordinate
  useEffect(() => {
    if (!mapReady || !mapRef.current || !selectedCoordinate) {
      return
    }

    const map = mapRef.current

    const element = document.createElement('div')

    element.style.cssText = `
      width: 16px;
      height: 16px;
      background: #111827;
      border: 3px solid white;
      border-radius: 50%;
      box-shadow: 0 2px 8px rgba(0,0,0,0.4);
      pointer-events: none;
    `

    const temporaryMarker = new maplibregl.Marker({
  element,
  anchor: 'center',
  offset: [0, 0],
})
      .setLngLat([
        selectedCoordinate.longitude,
        selectedCoordinate.latitude,
      ])
      .addTo(map)

    return () => {
      temporaryMarker.remove()
    }
  }, [mapReady, selectedCoordinate])


useEffect(() => {
  if (!mapReady || !mapRef.current) return

  // Only render selected marker types.
  const filteredMarkers = markers.filter(
    (marker) => visibleTypes[marker.type]
  )

  // Recalculate chronological order from visible markers.
  const timeOrder = getTimeOrder(filteredMarkers)

  const cleanup = addMarkerLayer(
    mapRef.current,
    filteredMarkers,

    // Update search completion
    (id, searched) => {
      setMarkers((prev) =>
        prev.map((marker) =>
          marker.id === id
            ? { ...marker, searched }
            : marker
        )
      )
    },

    // Edit marker
    (marker) => {
  setEditingMarker(marker)
  setActiveMenu('register')
},

    // Delete marker
    (id) => {
      setMarkers((prev) =>
        prev.filter((marker) => marker.id !== id)
      )
      setEditingMarker((prev) =>
        prev?.id === id ? null : prev
      )
    },

    timeOrder,
    showTimeOrder
  )

  return cleanup
}, [mapReady, markers, visibleTypes, showTimeOrder])



 

const [editingMarker, setEditingMarker] =
  useState<MapMarker | null>(null)

// Automatically save markers when they change.
useEffect(() => {
  const success = saveMarkers(region, markers)

  if (!success) {
    console.warn("Marker changes could not be saved.")
  }
}, [region, markers])

// Add a new marker
const handleAddMarker = (marker: MapMarker) => {
  setMarkers((prev) => [...prev, marker])
  setSelectedCoordinate(null)
}


  // 11. 화면 구성
  return (
    
  <div
    style={{
      position: 'fixed',
      inset: 0,
      width: '100%',
      height: '100dvh',
      margin: 0,
      padding: 0,
      overflow: 'hidden',
      background: '#202a31',
      boxSizing: 'border-box',
    }}
  >
    <style>{panelScrollbarStyle}</style>
      
      
      {/* FindWise top header */}
      <header
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: 66,
          background: '#202a31',
          color: '#ecf1f2',
          display: 'flex',
          alignItems: 'center',
          gap: 20,
          padding: '0 24px',
          zIndex: 20,
          fontFamily: 'sans-serif',
          borderBottom: '1px solid #3b474d',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            fontSize: 24,
            fontWeight: 700,
          }}
        >
          <Mountain
  size={29}
  strokeWidth={1.7}
  color="#ecf1f2"
/>
          <span>FindWise</span>
        </div>

        <div
          style={{
            width: 1,
            height: 28,
            background: '#465058',
          }}
        />

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            fontSize: 15,
            fontWeight: 600,
          }}
        >
          <Folder
  size={19}
  strokeWidth={1.8}
  color="#ecf1f2"
/>
          <span>{regionDisplayName} 수색 작업 공간</span>
        </div>

        <span
          style={{
            fontSize: 11,
            color: '#c9d4da',
            background: '#39454f',
            borderRadius: 4,
            padding: '4px 7px',
          }}
        >
          개발 미리보기
        </span>
      </header>


      
      {/* Map container */}
<div
  ref={container}
  style={{
    position: 'absolute',
    top: 66,
    left: 80,
    right: 0,
    bottom: 0,
    minWidth: 0,
    overflow: 'hidden',
  }}
/>

        
{/* Left navigation sidebar */}
<nav
  style={{
    position: 'absolute',
    top: 66,
    left: 0,
    bottom: 0,
    width: 80,
    background: '#202a31',
    zIndex: 15,
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    padding: '12px 4px',
    boxSizing: 'border-box',
    fontFamily: 'sans-serif',
  }}
>
  {(
  [
    { menu: 'coordinates', Icon: MapPin, label: '좌표 확인' },
    { menu: 'terrain', Icon: Layers, label: 'DEM 레이어' },
    { menu: 'visibility', Icon: ListFilter, label: '마커 표시\n설정' },
    { menu: 'register', Icon: PlusCircle, label: '마커 등록' },
  ] as const
).map(({ menu, Icon, label }) => (
    <button
      key={menu}
      type="button"
      onClick={() => setActiveMenu(menu)}
      style={{
        border: 'none',
        borderRadius: 8,
        padding: '12px 4px',
        background:
          activeMenu === menu ? '#394c54' : 'transparent',
        color:
          activeMenu === menu ? '#a9e5d9' : '#cad5d9',
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 6,
        fontSize: 11,
        fontWeight: activeMenu === menu ? 700 : 500,
      }}
    >
      <Icon
  size={23}
  strokeWidth={1.8}
  color={activeMenu === menu ? '#a9ded5' : '#c6d6dc'}
/>
      
      <span
  style={{
    fontSize: 11,
    whiteSpace: 'pre-line',
    textAlign: 'center',
    lineHeight: 1.4,
  }}
>
  {label}
</span>
    </button>
  ))}
</nav>



      {/* Left panel container */}
      <div
      className="findwise-panel-scroll"
        style={{
          position: 'absolute',
          top: 82,
          left: 96,
          zIndex: 10,
          width: 350,
          maxWidth: 'calc(100% - 112px)',
maxHeight: 'calc(100% - 98px)',
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          fontFamily: 'sans-serif',
        }}
      >

  

{activeMenu === 'coordinates' && (
  <div
    style={{
      background: '#232f36',
      color: '#ecf1f2',
      border: '1px solid #46565e',
      borderRadius: 8,
      padding: 20,
      boxShadow: '0 8px 24px rgba(0,0,0,0.2)',
      fontFamily: 'sans-serif',
    }}
  >
    {/* Panel header */}
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        borderBottom: '1px solid #48575e',
        paddingBottom: 18,
        marginBottom: 22,
      }}
    >
      <strong
        style={{
          borderLeft: '3px solid #8de6d8',
          paddingLeft: 11,
          fontSize: 18,
        }}
      >
        좌표 확인
      </strong>

      <button
        type="button"
        onClick={() => setActiveMenu(null)}
        aria-label="좌표 확인 패널 닫기"
        style={{
          background: 'transparent',
          border: 'none',
          color: '#c4d2d6',
          fontSize: 22,
          cursor: 'pointer',
        }}
      >
        ×
      </button>
    </div>

    {/* Section 1 */}
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        marginBottom: 14,
      }}
    >
      <span
        style={{
          width: 27,
          height: 27,
          borderRadius: '50%',
          background: '#3b5260',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 13,
        }}
      >
        1
      </span>
      <strong style={{ fontSize: 15 }}>
        지도에서 위치 선택
      </strong>
    </div>

    <div
      style={{
        border: '1px solid #53676e',
        borderRadius: 8,
        padding: 15,
        marginBottom: 24,
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>
        지도를 눌러 좌표를 지정하세요
      </div>

      <div
        style={{
          background: '#a9ded5',
          color: '#193c3b',
          borderRadius: 5,
          padding: '13px 10px',
          textAlign: 'center',
          fontWeight: 600,
          fontSize: 13,
        }}
      >
        지도에서 원하는 위치를 클릭
      </div>
    </div>

    {/* Section 2 */}
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        marginBottom: 16,
      }}
    >
      <span
        style={{
          width: 27,
          height: 27,
          borderRadius: '50%',
          background: '#3b5260',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 13,
        }}
      >
        2
      </span>
      <strong style={{ fontSize: 15 }}>
        선택한 좌표
      </strong>
    </div>

    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: 10,
        marginBottom: 12,
      }}
    >
      {([
        ['위도', selectedCoordinate?.latitude],
        ['경도', selectedCoordinate?.longitude],
      ] as const).map(([label, value]) => (
        <div key={label} style={{ minWidth: 0 }}>
          <div
            style={{
              fontSize: 12,
              color: '#c6d6dc',
              marginBottom: 8,
            }}
          >
            {label}
          </div>
          <div
            style={{
              background: '#1d272f',
              border: '1px solid #647783',
              borderRadius: 6,
              padding: '12px 8px',
              fontSize: 13,
              fontVariantNumeric: 'tabular-nums',
              color: '#f0f6f6',
              textAlign: 'center',
            }}
          >
            {value !== undefined ? value.toFixed(6) : '—'}
          </div>
        </div>
      ))}
    </div>

    <p
      style={{
        color: '#a6b8c1',
        fontSize: 11,
        lineHeight: 1.6,
        marginBottom: 18,
      }}
    >
      {selectedCoordinate
        ? '선택한 위치의 위도와 경도입니다.'
        : '지도를 클릭하면 좌표가 표시됩니다.'}
    </p>

    <button
      type="button"
      disabled={!selectedCoordinate}
      onClick={async () => {
        if (!selectedCoordinate) return

        const text = [
          selectedCoordinate.latitude.toFixed(6),
          selectedCoordinate.longitude.toFixed(6),
        ].join(', ')

        try {
          await navigator.clipboard.writeText(text)
          window.alert('좌표를 복사했습니다.')
        } catch {
          window.alert('좌표 복사에 실패했습니다.')
        }
      }}
      style={{
        width: '100%',
        padding: 13,
        background: selectedCoordinate ? '#a9ded5' : '#607e80',
        color: selectedCoordinate ? '#193c3b' : '#c5d2d4',
        border: 'none',
        borderRadius: 6,
        cursor: selectedCoordinate ? 'pointer' : 'not-allowed',
        fontWeight: 600,
        marginBottom: 10,
      }}
    >
      좌표 복사
    </button>

    <button
      type="button"
      disabled={!selectedCoordinate}
      onClick={() => {
        setEditingMarker(null)
        setActiveMenu('register')
      }}
      style={{
        width: '100%',
        padding: 13,
        background: '#344750',
        color: '#e2f1ef',
        border: '1px solid #53676e',
        borderRadius: 6,
        cursor: selectedCoordinate ? 'pointer' : 'not-allowed',
        fontWeight: 600,
      }}
    >
      이 좌표로 마커 등록
    </button>
  </div>
)}




{activeMenu === 'terrain' && (
  <div
    style={{
      padding: 20,
      background: '#232f36',
      color: '#ecf1f2',
      border: '1px solid #46565e',
      borderRadius: 8,
      boxShadow: '0 8px 24px rgba(0,0,0,0.2)',
      boxSizing: 'border-box',
      flexShrink: 0,
      fontFamily: 'sans-serif',
    }}
  >
    {/* Panel header */}
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        borderBottom: '1px solid #48575e',
        paddingBottom: 18,
        marginBottom: 22,
      }}
    >
      <strong
        style={{
          borderLeft: '3px solid #8de6d8',
          paddingLeft: 11,
          fontSize: 18,
        }}
      >
        DEM 레이어
      </strong>

      <button
        type="button"
        onClick={() => setActiveMenu(null)}
        aria-label="DEM 레이어 패널 닫기"
        style={{
          background: 'transparent',
          border: 'none',
          color: '#c4d2d6',
          fontSize: 22,
          cursor: 'pointer',
        }}
      >
        ×
      </button>
    </div>

    {/* Section 1: Terrain selection */}
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        marginBottom: 14,
      }}
    >
      <span
        style={{
          width: 27,
          height: 27,
          borderRadius: '50%',
          background: '#3b5260',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 13,
        }}
      >
        1
      </span>
      <strong style={{ fontSize: 15 }}>지형 레이어 선택</strong>
    </div>

    <p
      style={{
        fontSize: 12,
        color: '#a6b8c1',
        lineHeight: 1.7,
        marginBottom: 14,
      }}
    >
      지도에 표시할 지형 정보를 선택하세요.
    </p>

    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
        gap: 8,
        marginBottom: 10,
      }}
    >
      {([
        ['none', '기본'],
        ['elevation', '고도'],
        ['slope', '경사도'],
      ] as const).map(([value, label]) => {
        const selected = terrainLayer === value

        return (
          <button
            key={value}
            type="button"
            disabled={!mapReady}
            aria-pressed={selected}
            onClick={() => setTerrainLayer(value)}
            style={{
              padding: '12px 4px',
              background: selected ? '#a9ded5' : '#1d272f',
              color: selected ? '#193c3b' : '#d0dfe3',
              border: selected
                ? '1px solid #a9ded5'
                : '1px solid #53676e',
              borderRadius: 6,
              cursor: mapReady ? 'pointer' : 'not-allowed',
              fontSize: 13,
              fontWeight: selected ? 700 : 500,
              opacity: mapReady ? 1 : 0.5,
            }}
          >
            {label}
          </button>
        )
      })}
    </div>

    <div
      style={{
        background: '#1d272f',
        border: '1px solid #53676e',
        borderRadius: 6,
        padding: 15,
        marginBottom: 24,
      }}
    >
      
      <div
        style={{
          fontSize: 14,
          fontWeight: 600,
          color: '#a9ded5',
          marginBottom: 6,
        }}
      >
        {terrainLayer === 'none'
          ? '기본 지도'
          : terrainLayer === 'elevation'
            ? '고도'
            : '경사도'}
      </div>

      <div
        style={{
          fontSize: 11,
          color: '#a6b8c1',
          lineHeight: 1.6,
        }}
      >
        {terrainLayer === 'none'
          ? '기본 지도 배경을 표시합니다.'
          : terrainLayer === 'elevation'
            ? 'DEM 기반 고도 정보를 지도에 표시합니다.'
            : 'DEM 기반 경사도 정보를 지도에 표시합니다.'}
      </div>
    </div>

    {/* Section 2: Map legend */}
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        marginBottom: 14,
      }}
    >
      <span
        style={{
          width: 27,
          height: 27,
          borderRadius: '50%',
          background: '#3b5260',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 13,
        }}
      >
        2
      </span>
      <strong style={{ fontSize: 15 }}>지도 범례</strong>
    </div>

    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 13,
        padding: 15,
        background: '#1d272f',
        border: '1px solid #53676e',
        borderRadius: 6,
        marginBottom: 24,
        fontSize: 13,
      }}
    >
      {([
        ['#e68a24', '━', '등산로'],
        ['#2585d9', '━', '하천'],
        ['#e53935', '┄', '격자 경계'],
      ] as const).map(([color, symbol, label]) => (
        <div
          key={label}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <span
            style={{
              color,
              fontSize: 21,
              fontWeight: 700,
              width: 25,
              textAlign: 'center',
              lineHeight: 1,
            }}
          >
            {symbol}
          </span>
          <span>{label}</span>
        </div>
      ))}
    </div>

    {/* Section 3: Connection status */}
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        marginBottom: 14,
      }}
    >
      <span
        style={{
          width: 27,
          height: 27,
          borderRadius: '50%',
          background: '#3b5260',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 13,
        }}
      >
        3
      </span>
      <strong style={{ fontSize: 15 }}>데이터 연결 상태</strong>
    </div>

    <div
      role="status"
      style={{
        padding: 14,
        background: '#1d272f',
        border: '1px solid #53676e',
        borderRadius: 6,
        fontSize: 12,
        color: '#c6d6dc',
        lineHeight: 1.7,
        overflowWrap: 'anywhere',
      }}
    >
      <div
        style={{
          fontSize: 11,
          color: '#a9ded5',
          marginBottom: 6,
          fontWeight: 600,
        }}
      >
        {regionDisplayName}
      </div>
      {message}
    </div>
  </div>
)}

        

{activeMenu === 'visibility' && (
  <div
    style={{
      padding: 20,
      background: '#232f36',
      color: '#ecf1f2',
      border: '1px solid #46565e',
      borderRadius: 8,
      boxShadow: '0 8px 24px rgba(0,0,0,0.2)',
      boxSizing: 'border-box',
      flexShrink: 0,
      fontFamily: 'sans-serif',
    }}
  >
    {/* Panel header */}
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        borderBottom: '1px solid #48575e',
        paddingBottom: 18,
        marginBottom: 22,
      }}
    >
      <strong
        style={{
          borderLeft: '3px solid #8de6d8',
          paddingLeft: 11,
          fontSize: 18,
        }}
      >
        마커 표시 설정
      </strong>

      <button
        type="button"
        onClick={() => setActiveMenu(null)}
        aria-label="마커 표시 설정 패널 닫기"
        style={{
          background: 'transparent',
          border: 'none',
          color: '#c4d2d6',
          fontSize: 22,
          cursor: 'pointer',
        }}
      >
        ×
      </button>
    </div>

    {/* Section 1: All markers */}
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        marginBottom: 14,
      }}
    >
      <span
        style={{
          width: 27,
          height: 27,
          borderRadius: '50%',
          background: '#3b5260',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 13,
        }}
      >
        1
      </span>
      <strong style={{ fontSize: 15 }}>전체 마커 표시</strong>
    </div>

    <p
      style={{
        fontSize: 12,
        color: '#a6b8c1',
        lineHeight: 1.7,
        marginBottom: 14,
      }}
    >
      지도에 등록된 모든 유형의 마커를 표시하거나 숨깁니다.
    </p>

    <label
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: 14,
        background: '#1d272f',
        border: '1px solid #53676e',
        borderRadius: 6,
        cursor: 'pointer',
        marginBottom: 24,
      }}
    >
      <input
        type="checkbox"
        checked={Object.values(visibleTypes).every(Boolean)}
        onChange={(e) => {
          const checked = e.target.checked
          setVisibleTypes({
            report: checked,
            cctv: checked,
            search: checked,
          })
        }}
        style={{
          width: 17,
          height: 17,
          accentColor: '#a9ded5',
          cursor: 'pointer',
        }}
      />

      <div>
        <div style={{ fontSize: 13, fontWeight: 600 }}>
          전체 표시
        </div>
        <div
          style={{
            fontSize: 11,
            color: '#a6b8c1',
            marginTop: 4,
          }}
        >
        
        </div>
      </div>
    </label>
    
    
{/* Section 2: Marker types */}
<div
  style={{
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    marginBottom: 14,
  }}
>
  <span
    style={{
      width: 27,
      height: 27,
      borderRadius: '50%',
      background: '#3b5260',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: 13,
    }}
  >
    2
  </span>
  <strong style={{ fontSize: 15 }}>유형별 마커 표시</strong>
</div>

<p
  style={{
    fontSize: 12,
    color: '#a6b8c1',
    lineHeight: 1.7,
    marginBottom: 14,
  }}
>
  필요한 마커 유형만 선택하여 지도에 표시할 수 있습니다.
</p>

<div
  style={{
    display: 'flex',
    flexDirection: 'column',
    gap: 9,
    marginBottom: 24,
  }}
>
  {([
    ['report', '제보', '제보 위치'],
    ['cctv', 'CCTV', 'CCTV 위치'],
    ['search', '수색', '수색 관련 위치'],
  ] as const).map(([type, label, description]) => (
    <label
      key={type}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: 14,
        background: '#1d272f',
        border: '1px solid #53676e',
        borderRadius: 6,
        cursor: 'pointer',
      }}
    >
      <input
        type="checkbox"
        checked={visibleTypes[type]}
        onChange={(e) =>
          setVisibleTypes((prev) => ({
            ...prev,
            [type]: e.target.checked,
          }))
        }
        style={{
          width: 17,
          height: 17,
          accentColor: '#a9ded5',
          cursor: 'pointer',
        }}
      />

      {/* Label and description in one row */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          flexWrap: 'wrap',
        }}
      >
        <span
          style={{
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          {label}
        </span>

        <span
          style={{
            fontSize: 11,
            color: '#a6b8c1',
          }}
        >
          {description}
        </span>
      </div>
    </label>
  ))}
</div>


    {/* Section 3: Time order */}
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        marginBottom: 14,
      }}
    >
      <span
        style={{
          width: 27,
          height: 27,
          borderRadius: '50%',
          background: '#3b5260',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 13,
        }}
      >
        3
      </span>
      <strong style={{ fontSize: 15 }}>시간순 표시 설정</strong>
    </div>

    <p
      style={{
        fontSize: 12,
        color: '#a6b8c1',
        lineHeight: 1.7,
        marginBottom: 14,
      }}
    >
      기록 시각을 기준으로 마커에 순서 번호를 표시합니다.
    </p>

    <label
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: 14,
        background: '#1d272f',
        border: '1px solid #53676e',
        borderRadius: 6,
        cursor: 'pointer',
      }}
    >
      <input
        type="checkbox"
        checked={showTimeOrder}
        onChange={(e) => setShowTimeOrder(e.target.checked)}
        style={{
          width: 17,
          height: 17,
          accentColor: '#a9ded5',
          cursor: 'pointer',
        }}
      />

      <div>
        <div style={{ fontSize: 13, fontWeight: 600 }}>
          시간순 표시
        </div>
        <div
          style={{
            fontSize: 11,
            color: '#a6b8c1',
            marginTop: 4,
          }}
        >
        
        </div>
      </div>
    </label>
  </div>
)}





        {/* Marker registration panel */}
        {activeMenu === 'register' && (
  <div
    style={{
      padding: 20,
      background: '#232f36',
      color: '#ecf1f2',
      border: '1px solid #46565e',
      borderRadius: 8,
      boxShadow: '0 8px 24px rgba(0,0,0,0.2)',
      boxSizing: 'border-box',
      flexShrink: 0,
      fontFamily: 'sans-serif',
    }}
  >

    {/* Panel header */}
<div
  style={{
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottom: '1px solid #48575e',
    paddingBottom: 18,
    marginBottom: 22,
  }}
>
  <strong
    style={{
      borderLeft: '3px solid #8de6d8',
      paddingLeft: 11,
      fontSize: 18,
    }}
  >
    {editingMarker ? '마커 수정' : '마커 등록'}
  </strong>

  <button
    type="button"
    onClick={() => {
      setEditingMarker(null)
      setActiveMenu(null)
    }}
    aria-label="마커 등록 패널 닫기"
    style={{
      background: 'transparent',
      border: 'none',
      color: '#c4d2d6',
      fontSize: 22,
      cursor: 'pointer',
    }}
  >
    ×
  </button>
</div>
          
{editingMarker ? (
  <div>
    <h3>마커 수정</h3>

    <label>
      기록 시각
      <input
        type="datetime-local"
        value={editingMarker.recordedAt}
        onChange={(e) =>
          setEditingMarker({
            ...editingMarker,
            recordedAt: e.target.value,
          })
        }
      />
    </label>

    <label style={{ display: 'block', marginTop: 12 }}>
      코멘트
      <textarea
        value={editingMarker.comment}
        onChange={(e) =>
          setEditingMarker({
            ...editingMarker,
            comment: e.target.value,
          })
        }
        rows={3}
        style={{
          display: 'block',
          width: '100%',
          boxSizing: 'border-box',
        }}
      />
    </label>

    <label style={{ display: 'block', marginTop: 12 }}>
      <input
        type="checkbox"
        checked={editingMarker.searched}
        onChange={(e) =>
          setEditingMarker({
            ...editingMarker,
            searched: e.target.checked,
          })
        }
      />
      {' '}수색 완료
    </label>

    <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
      <button
        onClick={() => {
          setMarkers((prev) =>
            prev.map((marker) =>
              marker.id === editingMarker.id
                ? editingMarker
                : marker
            )
          )
          setEditingMarker(null)
        }}
      >
        저장
      </button>

      <button onClick={() => setEditingMarker(null)}>
        취소
      </button>
    </div>
  </div>
) : (
  <MarkerForm
  onAddMarker={handleAddMarker}
  selectedCoordinate={selectedCoordinate}
/>
)}

        </div>
        )}
      </div>
    </div>
  )
}

createRoot(
  document.getElementById('root')!
).render(<BukhansanMap />)
