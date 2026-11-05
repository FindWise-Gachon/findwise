import react from '@vitejs/plugin-react'
import { readFile } from 'node:fs/promises'
import { defineConfig, type Plugin } from 'vite'

// A prepared public OSM snapshot. Other raw/evaluation files are never exposed.
const terrainPath = new URL('../data/raw/yosemite-terrain-v2.geojson', import.meta.url)
async function terrainSnapshot() {
  const data = JSON.parse(await readFile(terrainPath, 'utf8'))
  return JSON.stringify({ ...data, grid_id: 'yosemite-valley-dev-6m-v1' })
}
function terrainAsset(): Plugin {
  return {
    name: 'findwise-terrain',
    configureServer(server) {
      server.middlewares.use('/terrain/yosemite.geojson', async (_request, response) => {
        response.setHeader('Content-Type', 'application/geo+json; charset=utf-8')
        try { response.end(await terrainSnapshot()) }
        catch { response.statusCode = 503; response.end(JSON.stringify({ error: 'Terrain snapshot unavailable' })) }
      })
    },
    async generateBundle() {
      try {
        this.emitFile({ type: 'asset', fileName: 'terrain/yosemite.geojson', source: await terrainSnapshot() })
      } catch {
        this.warn('Prepared terrain snapshot unavailable. The UI supports retry and user-provided data.')
      }
    },
  }
}
export default defineConfig({ plugins: [react(), terrainAsset()] })
