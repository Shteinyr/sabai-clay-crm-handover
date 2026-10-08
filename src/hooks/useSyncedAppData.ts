import { useCallback, useEffect, useRef, useState } from 'react'
import { isSupabaseConfigured, supabase } from '../data/supabaseClient'

type SyncStatus = 'local' | 'loading' | 'synced' | 'saving' | 'error'

type SyncMeta = {
  error?: string
  isRemoteEnabled: boolean
  refresh: () => Promise<void>
  status: SyncStatus
}

type SyncOptions<T> = {
  canSaveRemote?: boolean
  mergeRemote?: (localValue: T, remoteValue: T) => T
  remoteStore?: {
    load: () => Promise<T | null>
    save: (value: T) => Promise<T>
  }
  shouldKeepLocal?: (localValue: T, remoteValue: T) => boolean
}

const remoteStateId = 'main'

function readLocal<T>(key: string, initialValue: T) {
  try {
    const item = window.localStorage.getItem(key)
    return item
      ? { found: true, value: JSON.parse(item) as T }
      : { found: false, value: initialValue }
  } catch {
    return { found: false, value: initialValue }
  }
}

function writeLocal<T>(key: string, value: T) {
  window.localStorage.setItem(key, JSON.stringify(value))
}

function writeLocalPrevious<T>(key: string, value: T) {
  try {
    window.localStorage.setItem(`${key}:previous`, JSON.stringify(value))
  } catch {
    // Best-effort local recovery copy only.
  }
}

export function useSyncedAppData<T>(key: string, initialValue: T, options: SyncOptions<T> = {}) {
  const [localSnapshot] = useState(() => readLocal(key, initialValue))
  const [storedValue, setStoredValue] = useState<T>(localSnapshot.value)
  const [status, setStatus] = useState<SyncStatus>(isSupabaseConfigured ? 'loading' : 'local')
  const [error, setError] = useState<string>()
  const latestValueRef = useRef(storedValue)
  const hasLocalValueRef = useRef(localSnapshot.found)
  const remoteLoadedRef = useRef(!isSupabaseConfigured)
  const saveTimerRef = useRef<number | undefined>(undefined)
  const mergeRemote = options.mergeRemote
  const remoteStore = options.remoteStore
  const shouldKeepLocal = options.shouldKeepLocal
  const canSaveRemote = options.canSaveRemote ?? true

  const loadFromDefaultRemote = useCallback(async () => {
    if (!supabase) return null

    const { data, error: loadError } = await supabase
      .from('app_state')
      .select('data')
      .eq('id', remoteStateId)
      .maybeSingle()

    if (loadError) throw loadError
    return data?.data ? (data.data as T) : null
  }, [])

  const saveToDefaultRemote = useCallback(
    async (value: T) => {
      if (!supabase) return value

      const { data: currentRemote, error: currentRemoteError } = await supabase
        .from('app_state')
        .select('data')
        .eq('id', remoteStateId)
        .maybeSingle()

      if (currentRemoteError) throw currentRemoteError

      if (currentRemote?.data) {
        const remoteData = currentRemote.data as T
        if (shouldKeepLocal?.(remoteData, value)) return remoteData
      }

      const { error: saveError } = await supabase
        .from('app_state')
        .upsert({
          data: value,
          id: remoteStateId,
          updated_at: new Date().toISOString(),
        })

      if (saveError) throw saveError
      return value
    },
    [shouldKeepLocal],
  )

  const saveRemote = useCallback(
    async (value: T) => {
      if (!supabase || !canSaveRemote) return
      setStatus('saving')
      setError(undefined)

      try {
        const currentRemote = remoteStore ? await remoteStore.load() : await loadFromDefaultRemote()
        let nextValue = value
        if (currentRemote && mergeRemote) nextValue = mergeRemote(value, currentRemote)
        const savedValue = remoteStore ? await remoteStore.save(nextValue) : await saveToDefaultRemote(nextValue)

        latestValueRef.current = savedValue
        setStoredValue(savedValue)
        writeLocal(key, savedValue)
        setStatus('synced')
      } catch (remoteError) {
        setError(remoteError instanceof Error ? remoteError.message : 'Ошибка синхронизации')
        setStatus('error')
      }
    },
    [canSaveRemote, key, loadFromDefaultRemote, mergeRemote, remoteStore, saveToDefaultRemote],
  )

  const scheduleRemoteSave = useCallback(
    (value: T) => {
      if (!supabase || !canSaveRemote) return
      window.clearTimeout(saveTimerRef.current)
      saveTimerRef.current = window.setTimeout(() => {
        void saveRemote(value)
      }, 700)
    },
    [canSaveRemote, saveRemote],
  )

  const loadRemote = useCallback(async () => {
    if (!supabase) return
    setStatus('loading')
    setError(undefined)

    let remoteData: T | null
    try {
      remoteData = remoteStore ? await remoteStore.load() : await loadFromDefaultRemote()
    } catch (remoteError) {
      setError(remoteError instanceof Error ? remoteError.message : 'Ошибка загрузки данных')
      setStatus('error')
      return
    }

    if (remoteData) {
      const localData = latestValueRef.current
      remoteLoadedRef.current = true
      if (hasLocalValueRef.current && mergeRemote && canSaveRemote) {
        const mergedData = mergeRemote(localData, remoteData)
        const mergedJson = JSON.stringify(mergedData)

        if (mergedJson !== JSON.stringify(remoteData)) {
          latestValueRef.current = mergedData
          setStoredValue(mergedData)
          writeLocal(key, mergedData)
          await saveRemote(mergedData)
          return
        }
      }

      if (canSaveRemote && shouldKeepLocal?.(localData, remoteData)) {
        setStoredValue(localData)
        writeLocal(key, localData)
        await saveRemote(localData)
        return
      }

      if (JSON.stringify(localData) !== JSON.stringify(remoteData)) writeLocalPrevious(key, localData)
      latestValueRef.current = remoteData
      setStoredValue(remoteData)
      writeLocal(key, remoteData)
      hasLocalValueRef.current = true
      setStatus('synced')
      return
    }

    remoteLoadedRef.current = true
    if (canSaveRemote) await saveRemote(latestValueRef.current)
    else setStatus('synced')
  }, [canSaveRemote, key, loadFromDefaultRemote, mergeRemote, remoteStore, saveRemote, shouldKeepLocal])

  useEffect(() => {
    latestValueRef.current = storedValue
  }, [storedValue])

  useEffect(() => {
    if (!supabase) return
    const loadTimer = window.setTimeout(() => {
      void loadRemote()
    }, 0)

    return () => {
      window.clearTimeout(loadTimer)
      window.clearTimeout(saveTimerRef.current)
    }
  }, [loadRemote])

  const setValue = useCallback(
    (value: T | ((current: T) => T)) => {
      setStoredValue((current) => {
        const nextValue =
          typeof value === 'function' ? (value as (current: T) => T)(current) : value
        latestValueRef.current = nextValue
        writeLocal(key, nextValue)
        hasLocalValueRef.current = true
        if (remoteLoadedRef.current) scheduleRemoteSave(nextValue)
        return nextValue
      })
    },
    [key, scheduleRemoteSave],
  )

  const meta: SyncMeta = {
    error,
    isRemoteEnabled: isSupabaseConfigured,
    refresh: loadRemote,
    status,
  }

  return [storedValue, setValue, meta] as const
}
