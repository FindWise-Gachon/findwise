import { useEffect, useState } from 'react'
import type { GridSpec } from './grid'
import { readIncidentMarker, type IncidentMarker } from './incident'
import { latestSearchRecord, readSearchRecords, type NewSearchRecord, type SearchRecord } from './searchRecord'

let database: Promise<IDBDatabase> | undefined
function openRecords(): Promise<IDBDatabase> {
  if (!database) {
    const opening = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('findwise-search-records', 2)
      request.onupgradeneeded = event => {
        if (event.oldVersion < 1) {
          const store = request.result.createObjectStore('approved', { keyPath: 'id' })
          store.createIndex('case', 'caseKey')
          store.createIndex('duplicate', ['caseKey', 'duplicateKey'], { unique: true })
        }
        request.result.createObjectStore('markers', { keyPath: ['caseKey', 'id'] }).createIndex('case', 'caseKey')
      }
      let blocked = false
      request.onblocked = () => {
        blocked = true
        reject(new Error('다른 FindWise 탭을 닫고 다시 열어 주세요.'))
      }
      request.onsuccess = () => {
        const db = request.result
        if (blocked) { db.close(); return }
        db.onversionchange = () => { db.close(); database = undefined }
        resolve(db)
      }
      request.onerror = () => reject(request.error)
    })
    database = opening.catch(error => { database = undefined; throw error })
  }
  return database
}

async function loadRecords(caseKey: string, grid: GridSpec): Promise<SearchRecord[]> {
  const db = await openRecords()
  return new Promise((resolve, reject) => {
    const read = db.transaction('approved').objectStore('approved').index('case').getAll(caseKey)
    read.onsuccess = () => {
      try { resolve(readSearchRecords(read.result, grid, caseKey)) }
      catch (error) { reject(error) }
    }
    read.onerror = () => reject(read.error)
  })
}

export async function appendSearchRecord(record: NewSearchRecord, expectedHead: string | undefined, grid: GridSpec) {
  const db = await openRecords()
  return new Promise<SearchRecord[]>((resolve, reject) => {
    const transaction = db.transaction('approved', 'readwrite')
    const store = transaction.objectStore('approved')
    const read = store.index('case').getAll(record.caseKey)
    let saved: SearchRecord[] = []
    let failure = ''
    read.onsuccess = () => {
      try {
        const previous = readSearchRecords(read.result, grid, record.caseKey)
        if (previous.some(item => item.duplicateKey === record.duplicateKey)) throw new Error('같은 시각과 원문의 보고가 이미 승인됐습니다.')
        let next: SearchRecord
        if (record.kind === 'searched') {
          const latest = latestSearchRecord(previous, record.runKey, record.stepSeconds)
          if (latest?.id !== expectedHead) throw new Error('다른 창의 보고가 먼저 반영됐습니다. 기록을 확인한 뒤 다시 승인해 주세요.')
          next = { ...record, sequence: (latest?.sequence ?? 0) + 1 }
        } else {
          next = record
        }
        saved = readSearchRecords([...previous, next], grid, record.caseKey)
        store.add(next)
      } catch (error) {
        failure = error instanceof Error ? error.message : '기록을 저장하지 못했습니다.'
        transaction.abort()
      }
    }
    transaction.oncomplete = () => resolve(saved)
    transaction.onabort = () => reject(new Error(failure || '수색 기록을 저장하지 못했습니다. 브라우저 저장 공간을 확인해 주세요.'))
  })
}

const empty: SearchRecord[] = []
export function useSearchRecords(caseKey: string, grid: GridSpec) {
  const [revision, refresh] = useState(0)
  const [loaded, setLoaded] = useState<{ key: string; records: SearchRecord[]; error: string } | null>(null)
  useEffect(() => {
    if (!caseKey) return
    let active = true
    void loadRecords(caseKey, grid).then(records => {
      if (active) setLoaded({ key: caseKey, records, error: '' })
    }, () => {
      if (active) setLoaded({ key: caseKey, records: [], error: '수색 기록을 읽지 못했습니다. 브라우저 저장소를 확인해 주세요.' })
    })
    return () => { active = false }
  }, [caseKey, grid, revision])
  const current = loaded?.key === caseKey ? loaded : null
  return {
    records: current?.records ?? empty,
    ready: Boolean(current && !current.error),
    error: current?.error ?? '',
    refresh: () => refresh(previous => previous + 1),
    acceptSaved: (key: string, records: SearchRecord[]) => setLoaded(previous =>
      previous?.key === key ? { key, records, error: '' } : previous),
  }
}

type MarkerChange = { id: string; marker?: IncidentMarker; existing: boolean } | { attachUnassigned: string }

async function updateMarkers(caseKey: string, change?: MarkerChange) {
  const db = await openRecords()
  return new Promise<IncidentMarker[]>((resolve, reject) => {
    const transaction = db.transaction('markers', change ? 'readwrite' : 'readonly')
    const store = transaction.objectStore('markers')
    const read = store.index('case').getAll(caseKey)
    let markers: IncidentMarker[] = []
    let failure: unknown
    function abort(error: unknown) {
      failure = error
      transaction.abort()
    }
    read.onsuccess = () => {
      try {
        markers = read.result.map(item => readIncidentMarker(item, caseKey))
        if (!change) return
        if ('attachUnassigned' in change) {
          const unassignedKey = change.attachUnassigned
          const pending = store.index('case').getAll(unassignedKey)
          pending.onsuccess = () => {
            try {
              for (const item of pending.result) {
                const marker = readIncidentMarker(item, unassignedKey)
                const attached = { ...marker, caseKey }
                store.add(attached)
                store.delete([unassignedKey, marker.id])
                markers.push(attached)
              }
            } catch (error) { abort(error) }
          }
          return
        }
        const exists = markers.some(marker => marker.id === change.id)
        if (change.existing !== exists) throw new Error('마커 목록이 바뀌었습니다. 화면을 새로고침해 주세요.')
        markers = markers.filter(marker => marker.id !== change.id)
        if (change.marker) {
          const marker = readIncidentMarker(change.marker, caseKey)
          store.put(marker)
          markers.push(marker)
        } else store.delete([caseKey, change.id])
      } catch (error) { abort(error) }
    }
    transaction.oncomplete = () => resolve(markers)
    transaction.onabort = () => reject(failure ?? transaction.error ?? new Error('지도 마커를 저장하지 못했습니다.'))
  })
}

const emptyMarkers: IncidentMarker[] = []
export function useIncidentMarkers(caseKey: string) {
  const [revision, setRevision] = useState(0)
  const [loaded, setLoaded] = useState<{ key: string; markers: IncidentMarker[]; error: string } | null>(null)
  useEffect(() => {
    if (!caseKey) return
    let active = true
    void updateMarkers(caseKey).then(markers => {
      if (active) setLoaded({ key: caseKey, markers, error: '' })
    }, error => {
      if (active) setLoaded({ key: caseKey, markers: [], error: error instanceof Error ? error.message : '지도 마커를 읽지 못했습니다.' })
    })
    return () => { active = false }
  }, [caseKey, revision])

  const current = loaded?.key === caseKey ? loaded : null
  async function save(change: MarkerChange) {
    const markers = await updateMarkers(caseKey, change)
    setLoaded(previous => previous?.key === caseKey ? { key: caseKey, markers, error: '' } : previous)
  }
  return {
    markers: current?.markers ?? emptyMarkers,
    ready: Boolean(current && !current.error),
    error: current?.error ?? '',
    refresh: () => setRevision(previous => previous + 1),
    save,
  }
}
