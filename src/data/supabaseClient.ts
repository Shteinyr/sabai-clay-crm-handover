import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseKey =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  import.meta.env.VITE_SUPABASE_ANON_KEY

function configurationError() {
  if (!supabaseUrl && !supabaseKey && !import.meta.env.PROD) return undefined
  if (!supabaseUrl || !supabaseKey) return 'Не настроено подключение к облачной базе. Укажите VITE_SUPABASE_URL и VITE_SUPABASE_PUBLISHABLE_KEY и пересоберите приложение.'
  try {
    const url = new URL(supabaseUrl)
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) {
      return 'Некорректный адрес облачной базы. Требуется HTTPS или локальный Supabase.'
    }
  } catch {
    return 'Некорректный адрес облачной базы.'
  }
  if (supabaseKey.startsWith('sb_secret_')) return 'Секретный ключ нельзя использовать в браузере. Укажите publishable key.'
  if (supabaseKey.startsWith('eyJ')) {
    try {
      const payload = JSON.parse(atob(supabaseKey.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
      if (payload.role !== 'anon') return 'В браузере допустим только anon или publishable key.'
    } catch {
      return 'Некорректный публичный ключ облачной базы.'
    }
  }
  return undefined
}

export const supabaseConfigurationError = configurationError()

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseKey && !supabaseConfigurationError)

// A new cloud must never inherit another project's writable browser cache.
export const appDataStorageKey = supabaseUrl
  ? `sabai-clay-crm-data-v2:${supabaseUrl.replace(/\/$/, '')}`
  : 'sabai-clay-crm-data-v2'

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseKey)
  : null
