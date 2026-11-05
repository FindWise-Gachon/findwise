import { gridManifest, type GridSpec } from './grid.ts'
import { readTerrain, type TerrainFeature } from './terrain.ts'

export type TerrainChange = { id: string; feature: TerrainFeature | null; reason: string; at: string }
export type TerrainDocument = {
  version: 1
  grid: ReturnType<typeof gridManifest>
  revision: string
  base: TerrainFeature[]
  changes: TerrainChange[]
}

export function visibleTerrain(document: TerrainDocument): TerrainFeature[] {
  const original = new Map(document.base.map(feature => [feature.properties.id, feature]))
  const effective = new Map(original)
  for (const change of document.changes) {
    const base = original.get(change.id)
    if (change.feature) effective.set(change.id, change.feature)
    else if (base) effective.set(change.id, base)
    else effective.delete(change.id)
  }
  return [...effective.values()]
}

export function exportTerrain(document: TerrainDocument) {
  const effective = visibleTerrain(document)
  return {
    schema_version: 1, type: 'FeatureCollection', grid: document.grid,
    revision: document.revision,
    base_feature_count: document.base.length,
    features: [...document.base, ...effective.filter(feature => (
      feature !== document.base.find(base => base.properties.id === feature.properties.id)
    ))],
    unknown_policy: 'requires-model-decision',
    history: document.changes,
    terrain_document: document,
  }
}

export function readTerrainDocument(value: unknown, grid: GridSpec): TerrainDocument {
  if (!value || typeof value !== 'object') throw new Error('지형 자료를 확인해 주세요.')
  const data = value as Record<string, unknown>
  const manifest = gridManifest(grid)
  if (data.terrain_document) return readTerrainDocument(data.terrain_document, grid)
  const sameGrid = (candidate: unknown) => {
    if (!candidate || typeof candidate !== 'object') return false
    return Object.entries(manifest).every(([key, expected]) => (
      JSON.stringify((candidate as Record<string, unknown>)[key]) === JSON.stringify(expected)
    ))
  }
  if (data.version === 1) {
    if (!sameGrid(data.grid) || typeof data.revision !== 'string' || !data.revision ||
        !Array.isArray(data.changes) || !Array.isArray(data.base)) throw new Error('저장된 지형의 격자나 버전을 확인해 주세요.')
    const base = readTerrain({ type: 'FeatureCollection', features: data.base })
    const changes = data.changes.map((change): TerrainChange => {
      if (!change || typeof change.id !== 'string' || typeof change.reason !== 'string' ||
          typeof change.at !== 'string' || !Number.isFinite(Date.parse(change.at))) throw new Error('수정 이력이 올바르지 않습니다.')
      const feature = change.feature === null ? null : readTerrain({ type: 'FeatureCollection', features: [change.feature] })[0]
      if (feature && feature.properties.id !== change.id) throw new Error('수정 이력의 지형 ID가 일치하지 않습니다.')
      return { id: change.id, reason: change.reason, at: change.at, feature }
    })
    return { version: 1, grid: manifest, revision: data.revision, base, changes }
  }
  // Migrate packages saved by the earlier editor without discarding applied edits.
  if (data.schema_version === 1 && data.grid) {
    if (!sameGrid(data.grid) || !Array.isArray(data.features) || !Number.isInteger(data.base_feature_count)) throw new Error('현재 격자에 맞는 자료를 선택해 주세요.')
    const count = data.base_feature_count as number
    if (count < 0 || count > data.features.length) throw new Error('원본 지형 개수를 확인해 주세요.')
    const base = readTerrain({ type: 'FeatureCollection', features: data.features.slice(0, count) })
    const changes = data.features.slice(count).map(feature => {
      const parsed = readTerrain({ type: 'FeatureCollection', features: [feature] })[0]
      if (!base.some(item => item.properties.id === parsed.properties.id)) throw new Error('수정 대상 지형을 찾지 못했습니다.')
      return { id: parsed.properties.id, feature: parsed, reason: parsed.properties.reason, at: new Date().toISOString() }
    })
    return { version: 1, grid: manifest, revision: typeof data.revision === 'string' && data.revision ? data.revision : crypto.randomUUID(), base, changes }
  }
  if (data.grid_id && data.grid_id !== grid.id) throw new Error('다른 지역의 지형 자료입니다.')
  return { version: 1, grid: manifest, revision: crypto.randomUUID(), base: readTerrain(data), changes: [] }
}

export function changeTerrain(document: TerrainDocument, change: TerrainChange): TerrainDocument {
  return { ...document, revision: crypto.randomUUID(), changes: [...document.changes, change] }
}

export function undoTerrain(document: TerrainDocument): TerrainDocument {
  return document.changes.length ? { ...document, revision: crypto.randomUUID(), changes: document.changes.slice(0, -1) } : document
}
