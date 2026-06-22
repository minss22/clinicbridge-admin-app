import { supabase } from './supabase'

const BASE = import.meta.env.VITE_API_BASE_URL as string

async function authHeaders(extra: Record<string, string> = {}) {
  const { data } = await supabase.auth.getSession()
  return { Authorization: `Bearer ${data.session?.access_token ?? ''}`, ...extra }
}

async function unwrap(res: Response) {
  const json = await res.json()
  if (json.status !== 200) throw new Error(json.data?.error || '요청 실패')
  return json.data
}

export async function adminGet(path: string, params: Record<string, string> = {}) {
  const q = new URLSearchParams({ path, ...params }).toString()
  const res = await fetch(`${BASE}?${q}`, { headers: await authHeaders() })
  return unwrap(res)
}

export async function adminPost(path: string, body: Record<string, unknown>) {
  const res = await fetch(`${BASE}?path=${path}`, {
    method: 'POST',
    headers: await authHeaders({ 'Content-Type': 'text/plain' }),
    body: JSON.stringify(body),
  })
  return unwrap(res)
}

// ── 타입 ──────────────────────────────────────────────────────
export type Person = {
  id: string
  batchId: string
  status: string
  name: string
  nameKo: string
  displayName: string
  birthDate: string | null
  gender: string | null
  visitType: 'first' | 'return'
  treatmentRequest: string
  budget: string
  surgeryHistory: string
}
export type Booking = {
  groupId: string
  branchId: string
  branchName: string
  date: string
  time: string
  createdAt: string
  requestedDate: string | null
  requestedTime: string | null
  proposedBy: 'customer' | 'clinic' | null
  proposedTimes: string[]
  booker: Person
  companions: Person[]
}
export type Branch = { branchId: string; name: string; nameJa?: string }

export type AdminBranch = {
  branchId: string; name: string; nameJa: string; address: string; addressJa: string
  openTime: string; closeTime: string; lunchStart: string; lunchEnd: string
  closedDays: number[]; noLunchDays: number[]; holidayDates: string[]
  lineNotifyId: string; channelAccessToken: string
}
export type Customer = {
  lineUserId: string; name: string; nameKo: string; displayName: string
  birthDate: string | null; gender: string | null; createdAt: string
}
export type ManagerProposeInfo = {
  ok: boolean; reason?: string
  branchId?: string; branchName?: string; nameKo?: string
  currentDate?: string; currentTime?: string
  requestedDate?: string | null; requestedTime?: string | null
  targetDate?: string
}

export const adminApi = {
  getBranches: (): Promise<Branch[]> => adminGet('admin-branches'),
  getReservations: (branchId?: string): Promise<Booking[]> =>
    adminGet('admin-reservations', branchId ? { branchId } : {}),
  confirm: (reservationId: string) => adminPost('admin-confirm', { reservationId }),
  reject: (reservationId: string) => adminPost('admin-reject', { reservationId }),
  propose: (reservationId: string, date: string, times: string[]) =>
    adminPost('admin-propose', { reservationId, date, times }),
  // 슬롯 조회(공개 엔드포인트) — 제안 시간 선택용
  getSlots: (branchId: string, date: string): Promise<{ time: string; available: boolean }[]> =>
    adminGet('available-slots', { branchId, date }),

  // 병원 관리
  getAdminBranches: (): Promise<AdminBranch[]> => adminGet('admin-branches-full'),
  saveBranch: (branch: AdminBranch) => adminPost('admin-branch-save', { branch }),
  deleteBranch: (branchId: string) => adminPost('admin-branch-delete', { branchId }),

  // 고객 관리
  getCustomers: (): Promise<Customer[]> => adminGet('admin-customers'),
  getCustomerReservations: (lineUserId: string): Promise<Booking[]> =>
    adminGet('admin-customer-reservations', { lineUserId }),

  // 매니저 시간제안 (로그인 없음 · 알림 링크로 진입)
  getManagerProposeInfo: (reservationId: string): Promise<ManagerProposeInfo> =>
    adminGet('manager-propose-info', { reservationId }),
  managerPropose: (reservationId: string, date: string, times: string[]) =>
    adminPost('manager-propose', { reservationId, date, times }),
}
