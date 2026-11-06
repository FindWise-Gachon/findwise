import type { TerrainDocument } from './terrainDocument'

let database: Promise<IDBDatabase> | undefined
function openDatabase(): Promise<IDBDatabase> {
  database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open('findwise-workspace', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('terrain')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
    request.onblocked = () => reject(new Error('다른 창에서 저장소를 사용 중입니다.'))
  })
  return database
}

export async function loadTerrain(gridId: string): Promise<unknown> {
  const db = await openDatabase()
  return new Promise((resolve, reject) => {
    const request = db.transaction('terrain').objectStore('terrain').get(gridId)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export async function saveTerrain(document: TerrainDocument, expectedRevision: string | null): Promise<void> {
  const db = await openDatabase()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('terrain', 'readwrite')
    const store = transaction.objectStore('terrain')
    const existing = store.get(document.grid.grid_id)
    existing.onsuccess = () => {
      const revision = existing.result?.revision ?? null
      if (revision !== expectedRevision && revision !== document.revision) {
        transaction.abort()
        return
      }
      store.put(document, document.grid.grid_id)
    }
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error ?? new Error('다른 창의 변경과 충돌했습니다. 백업 후 새로고침해 주세요.'))
  })
}
