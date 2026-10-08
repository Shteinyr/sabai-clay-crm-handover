import { useCallback, useState } from 'react'

export function useLocalStorage<T>(key: string, initialValue: T) {
  const [storedValue, setStoredValue] = useState<T>(() => {
    try {
      const item = window.localStorage.getItem(key)
      return item ? (JSON.parse(item) as T) : initialValue
    } catch {
      return initialValue
    }
  })

  const setValue = useCallback(
    (value: T | ((current: T) => T)) => {
      setStoredValue((current) => {
        const nextValue =
          typeof value === 'function' ? (value as (current: T) => T)(current) : value
        window.localStorage.setItem(key, JSON.stringify(nextValue))
        return nextValue
      })
    },
    [key],
  )

  return [storedValue, setValue] as const
}
