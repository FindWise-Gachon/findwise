import react from '@vitejs/plugin-react'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'
import { defaultRegionId, findRegion } from './src/map/regions.ts'
import { terrainAssets } from './terrainAssets.ts'
import { gridManifest, projectedToCell, toProjected } from './src/map/grid.ts'
import { isAbmBehavior } from './src/map/abmBehavior.ts'

const runPython = promisify(execFile)
const backendPath = fileURLToPath(new URL('../backend/', import.meta.url))

function isCoordinatePair(value: unknown): value is [number, number] {
  return Array.isArray(value) && value.length === 2 && value.every(Number.isFinite)
}

function modelPreview(): Plugin {
  return {
    name: 'findwise-model-preview',
    configureServer(server) {
      const python = process.env.FINDWISE_PYTHON || fileURLToPath(new URL('../backend/.venv/bin/python', import.meta.url))
      for (const model of ['ring', 'abm', 'report'] as const) {
        server.middlewares.use(server.config.base + 'api/' + model, async (request, response) => {
          const send = (status: number, body: string) => {
            response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
            response.end(body)
          }
          const reject = (status: number, error: string) => send(status, JSON.stringify({ error }))
          if (request.method !== 'POST') return reject(405, 'POST 요청이 필요합니다.')
          const regionId = new URL(request.url ?? '/', 'http://localhost').searchParams.get('region') ?? defaultRegionId
          const region = findRegion(regionId)
          if (!region) return reject(400, '작업 지역을 확인해 주세요.')
          const analysisGrid = region.grid
          const grid = JSON.stringify(gridManifest(analysisGrid))
          if (request.headers.origin && request.headers.origin !== `http://${request.headers.host}` &&
              request.headers.origin !== `https://${request.headers.host}`) return reject(403, '같은 사이트에서 요청해 주세요.')
          const length = Number(request.headers['content-length'])
          if (!Number.isSafeInteger(length) || length < 1 || length > (model === 'abm' ? 8 * 1024 * 1024 : model === 'report' ? 64 * 1024 : 512) ||
              request.headers['content-type'] !== 'application/json') return reject(400, '모델 입력 형식을 확인해 주세요.')

          let point: unknown
          try {
            let body = ''
            for await (const chunk of request) body += chunk.toString('utf8')
            point = JSON.parse(body)
          } catch {
            if (!response.destroyed) reject(400, '모델 입력을 읽을 수 없습니다.')
            return
          }
          let args: string[]
          let stdin: string | undefined
          if (model === 'ring') {
            if (!isCoordinatePair(point) || !projectedToCell(analysisGrid, ...point)) return reject(400, '분석 범위 안에서 위치를 선택해 주세요.')
            args = point.map(String)
          } else if (model === 'abm') {
            if (!point || typeof point !== 'object') return reject(400, 'ABM 입력 형식을 확인해 주세요.')
            const { lkp, last_seen_utc, hours, terrain, allow_unknown, behavior, slope_limit,
              apply_access = terrain !== null } = point as Record<string, unknown>
            if (!isCoordinatePair(lkp) || Math.abs(lkp[0]) > 180 || Math.abs(lkp[1]) > 90 ||
                typeof last_seen_utc !== 'string' || !Number.isFinite(Date.parse(last_seen_utc)) ||
                new Date(last_seen_utc).toISOString() !== last_seen_utc || (hours !== 1 && hours !== 2)) {
              return reject(400, '마지막 확인 위치·시각과 계산 시간을 확인해 주세요.')
            }
            const projected = toProjected(analysisGrid, lkp)
            if (!projectedToCell(analysisGrid, ...projected)) return reject(400, '분석 범위 안에서 위치를 선택해 주세요.')
            if (!isAbmBehavior(behavior) || (slope_limit !== null && slope_limit !== 35 && slope_limit !== 45) ||
                typeof allow_unknown !== 'boolean' || typeof apply_access !== 'boolean' || (apply_access && terrain === null)) {
              return reject(400, 'ABM 행동과 이동 조건을 확인해 주세요.')
            }
            if (terrain !== null) {
              if (!terrain || typeof terrain !== 'object') return reject(400, '통행 조건 자료를 확인해 주세요.')
              const { schema_version, revision, base_feature_count, features } = terrain as Record<string, unknown>
              if (schema_version !== 1 || typeof revision !== 'string' || !revision || revision.length > 128 ||
                  !Array.isArray(features) || features.length > 5000 || typeof base_feature_count !== 'number' ||
                  !Number.isSafeInteger(base_feature_count) || base_feature_count < 0 || base_feature_count > features.length) {
                return reject(400, '통행 조건 자료를 확인해 주세요.')
              }
            }
            args = []
            stdin = JSON.stringify({ point: projected, lkp, last_seen_utc, hours, terrain, apply_access, allow_unknown, behavior, slope_limit })
          } else {
            args = []
            stdin = JSON.stringify(point)
          }

          const controller = new AbortController()
          response.once('close', () => controller.abort())
          try {
            const result = runPython(python, ['-B', '-m', `app.${model}_preview`, grid, ...args], {
              cwd: backendPath, timeout: 30_000,
              env: { ...process.env, FINDWISE_DEM_NPZ: process.env[region.demEnv] ||
                fileURLToPath(new URL(`../data/processed/${region.demFile}`, import.meta.url)) }, maxBuffer: 4 * 1024 * 1024, signal: controller.signal,
            })
            result.child.stdin?.on('error', () => { /* The process result handles early exits. */ })
            result.child.stdin?.end(stdin)
            const { stdout } = await result
            const status = model !== 'ring' && typeof JSON.parse(stdout)?.error === 'string' ? 422 : 200
            send(status, stdout)
          } catch (error) {
            if (!controller.signal.aborted) {
              server.config.logger.error(`${model} preview failed: ${(error as NodeJS.ErrnoException).code ?? 'Python process error'}`)
              reject(503, '모델을 실행하지 못했습니다. 백엔드 Python 환경을 확인해 주세요.')
            }
          }
        })
      }
    },
  }
}

export default defineConfig({ plugins: [react(), terrainAssets(), modelPreview()] })
