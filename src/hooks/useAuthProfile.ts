import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { supabase } from '../data/supabaseClient'
import type { StaffProfile, StaffRole, Teacher } from '../data/types'

type StaffProfileRow = {
  id: string
  email: string
  display_name: string
  teacher: Teacher
  role: StaffRole
  is_active: boolean
}

type AuthState = {
  canEdit: boolean
  defaultTeacher: Teacher
  error?: string
  isAdmin: boolean
  isKnownStaff: boolean
  isLoading: boolean
  profile?: StaffProfile
  signInWithGoogle: () => Promise<void>
  signOut: () => Promise<void>
  user: User | null
}

function profileFromRow(row: StaffProfileRow): StaffProfile {
  return {
    displayName: row.display_name,
    email: row.email,
    id: row.id,
    isActive: row.is_active,
    role: row.role,
    teacher: row.teacher,
  }
}

async function loadStaffProfile(email?: string | null) {
  if (!supabase || !email) return undefined

  const { data, error } = await supabase
    .from('staff_profiles')
    .select('id,email,display_name,teacher,role,is_active')
    .eq('email_normalized', email.trim().toLowerCase())
    .maybeSingle()

  if (error) throw error
  return data ? profileFromRow(data as StaffProfileRow) : undefined
}

export function useAuthProfile(): AuthState {
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<StaffProfile>()
  const [isLoading, setIsLoading] = useState(Boolean(supabase))
  const [error, setError] = useState<string>()
  const profileRequest = useRef(0)

  const hydrate = useCallback(async (nextUser: User | null) => {
    const request = ++profileRequest.current
    setUser(nextUser)
    setProfile(undefined)
    setError(undefined)

    if (!supabase || !nextUser?.email) {
      setIsLoading(false)
      return
    }

    try {
      const nextProfile = await loadStaffProfile(nextUser.email)
      if (request === profileRequest.current) setProfile(nextProfile)
    } catch (profileError) {
      if (request === profileRequest.current) {
        setError(profileError instanceof Error ? profileError.message : 'Не удалось загрузить профиль')
      }
    } finally {
      if (request === profileRequest.current) setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!supabase) return

    let active = true
    void supabase.auth.getUser().then(({ data, error: userError }) => {
      if (active && userError) setError(userError.message)
      if (active) void hydrate(data.user)
    }).catch(() => {
      if (active) {
        setError('Не удалось проверить вход. Повторите попытку после восстановления сети.')
        setIsLoading(false)
      }
    })

    let hydrationTimer: number | undefined
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      window.clearTimeout(hydrationTimer)
      hydrationTimer = window.setTimeout(() => {
        if (active) void hydrate(session?.user ?? null)
      }, 0)
    })

    return () => {
      active = false
      profileRequest.current += 1
      window.clearTimeout(hydrationTimer)
      listener.subscription.unsubscribe()
    }
  }, [hydrate])

  const signInWithGoogle = useCallback(async () => {
    if (!supabase) return
    setError(undefined)
    const { error: signInError } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin,
        scopes: 'https://www.googleapis.com/auth/userinfo.email',
      },
    })
    if (signInError) setError(signInError.message)
  }, [])

  const signOut = useCallback(async () => {
    if (!supabase) return
    setError(undefined)
    const { error: signOutError } = await supabase.auth.signOut()
    if (signOutError) setError(signOutError.message)
  }, [])

  return useMemo(() => {
    const isKnownStaff = Boolean(profile?.isActive)
    const isAdmin = profile?.role === 'admin' && profile.isActive
    const canEdit = !supabase || isKnownStaff

    return {
      canEdit,
      defaultTeacher: profile?.teacher ?? (supabase ? 'Другое' : 'Настя'),
      error,
      isAdmin,
      isKnownStaff,
      isLoading,
      profile,
      signInWithGoogle,
      signOut,
      user,
    }
  }, [error, isLoading, profile, signInWithGoogle, signOut, user])
}
