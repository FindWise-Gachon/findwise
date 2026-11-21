import { useEffect, useRef, useState } from 'react'
import { analysisGrid, region } from './config'
import { readTerrainDocument, type TerrainDocument } from './terrainDocument'
import { loadTerrain, saveTerrain } from './terrainStorage'

export function useTerrain() {
  const [document, setDocument] = useState<TerrainDocument | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [message, setMessage] = useState('')
  const [savedRevision, setSavedRevision] = useState('')
  const [saveError, setSaveError] = useState('')
  const [retry, setRetry] = useState(0)
  const request = useRef(0)
  const persistedRevision = useRef<string | null>(null)
  const queue = useRef(Promise.resolve())

  useEffect(() => {
    let active = true
    const token = ++request.current
    const controller = new AbortController()
    async function start() {
      setStatus('loading')
      try {
        let cached: unknown
        try { cached = await loadTerrain(analysisGrid.id) }
        catch { if (active) setSaveError('이 브라우저의 저장소를 읽지 못했습니다. 백업 저장을 사용해 주세요.') }
        if (!active || request.current !== token) return
        if (cached) {
          const restored = readTerrainDocument(cached, analysisGrid)
          persistedRevision.current = restored.revision
          setDocument(restored); setSavedRevision(restored.revision); setStatus('ready')
          return
        }
        const response = await fetch(`${import.meta.env.BASE_URL}terrain/${region.terrainAsset}`, { signal: controller.signal })
        if (!response.ok) throw new Error('기본 지형을 준비하지 못했습니다. 다시 시도하거나 고급 설정에서 자료를 추가해 주세요.')
        const next = readTerrainDocument(await response.json(), analysisGrid)
        if (active && request.current === token) { setDocument(next); setStatus('ready'); setMessage('기본 지형 연결됨') }
      } catch (error) {
        if (active && request.current === token) {
          setStatus('error')
          setMessage(error instanceof Error ? error.message : '지형을 불러오지 못했습니다.')
        }
      }
    }
    void start()
    return () => { active = false; controller.abort() }
  }, [retry])

  useEffect(() => {
    if (!document) return
    let active = true
    queue.current = queue.current.catch(() => {}).then(async () => {
      await saveTerrain(document, persistedRevision.current)
      persistedRevision.current = document.revision
    })
    void queue.current.then(() => {
      if (active) { setSavedRevision(document.revision); setSaveError('') }
    }).catch(error => {
      if (active) setSaveError(error instanceof Error && error.message.includes('다른 창') ? error.message : '저장 실패 · 이 화면의 수정은 유지됩니다. 백업을 저장해 주세요.')
    })
    return () => { active = false }
  }, [document])

  async function importFile(file: File) {
    const token = ++request.current
    try {
      if (file.size > 16 * 1024 * 1024) throw new Error('16MB 이하의 파일을 선택해 주세요.')
      const next = readTerrainDocument(JSON.parse(await file.text()), analysisGrid)
      if (request.current === token) { setDocument(next); setStatus('ready'); setMessage('사용자 자료 연결됨') }
    } catch (error) {
      if (request.current === token) setMessage(error instanceof Error ? error.message : '자료를 확인해 주세요.')
    }
  }

  return {
    document, setDocument, status, message, saveError,
    saveLabel: saveError || (document && savedRevision === document.revision ? '이 기기에 저장됨' : '저장 중…'),
    retry: () => setRetry(value => value + 1),
    importFile,
  }
}
