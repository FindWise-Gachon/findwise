import { readFile } from 'node:fs/promises'
import type { Feature, FeatureCollection } from 'geojson'
import type { Plugin } from 'vite'
import { regions, type Region } from './src/map/regions.ts'
import { readTerrain } from './src/map/terrain.ts'

function normalizeDemoFeatures(data: FeatureCollection, kind: string, fallbackName: string) {
  return data.features.flatMap((feature: Feature, index) => {
    if (feature.geometry?.type !== 'LineString') return []
    return [{
      type: 'Feature' as const, geometry: feature.geometry,
      properties: {
        id: `${kind}-${feature.id ?? index}`, kind, status: 'unknown', source: 'OpenStreetMap contributors',
        name: String(feature.properties?.name ?? fallbackName),
        reason: '팀 시연 자료 · 통행 미확인',
      },
    }]
  })
}

async function readTerrainFile(path: string) {
  return JSON.parse(await readFile(new URL(`../data/raw/${path}`, import.meta.url), 'utf8')) as FeatureCollection
}

async function terrainSnapshot(region: Region) {
  const source = region.terrain
  let data: FeatureCollection
  if (source.type === 'prepared') {
    data = await readTerrainFile(source.file)
  } else {
    const groups = await Promise.all(source.files.map(async file =>
      normalizeDemoFeatures(await readTerrainFile(file.path), file.kind, file.fallbackName)))
    data = { type: 'FeatureCollection', features: readTerrain({ type: 'FeatureCollection', features: groups.flat() }) }
  }
  return JSON.stringify({ ...data, grid_id: region.grid.id })
}

const images = Object.values(regions).flatMap(region => Object.values(region.terrainImages ?? {}))

export function terrainAssets(): Plugin {
  return {
    name: 'findwise-terrain',
    configureServer(server) {
      for (const region of Object.values(regions)) {
        server.middlewares.use(server.config.base + 'terrain/' + region.terrainAsset, async (_request, response) => {
          response.setHeader('Content-Type', 'application/geo+json; charset=utf-8')
          try { response.end(await terrainSnapshot(region)) }
          catch { response.statusCode = 503; response.end(JSON.stringify({ error: 'Terrain snapshot unavailable' })) }
        })
      }
      for (const file of images) {
        server.middlewares.use(server.config.base + 'terrain/' + file, async (_request, response) => {
          try {
            const image = await readFile(new URL(`../data/raw/${file}`, import.meta.url))
            response.setHeader('Content-Type', 'image/png')
            response.end(image)
          } catch {
            response.statusCode = 404
            response.end()
          }
        })
      }
    },
    async generateBundle() {
      for (const region of Object.values(regions)) {
        try {
          this.emitFile({ type: 'asset', fileName: 'terrain/' + region.terrainAsset, source: await terrainSnapshot(region) })
        } catch {
          this.warn(`Prepared terrain snapshot unavailable for ${region.id}.`)
        }
      }
      for (const file of images) {
        try {
          const source = await readFile(new URL(`../data/raw/${file}`, import.meta.url))
          this.emitFile({ type: 'asset', fileName: 'terrain/' + file, source })
        } catch {
          this.warn(`Prepared display image unavailable for ${file}.`)
        }
      }
    },
  }
}
