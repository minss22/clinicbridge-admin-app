import { createClient } from '@supabase/supabase-js'

// 로그인 미사용(개발) 모드에선 값이 없어도 import-time 오류가 안 나도록 placeholder 폴백
const url = (import.meta.env.VITE_SUPABASE_URL as string) || 'https://placeholder.supabase.co'
const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string) || 'placeholder-anon-key'

export const supabase = createClient(url, anonKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
})
