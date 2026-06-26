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
  memo?: string          // 예약 단위 고객 메모(한국어 번역)
  booker: Person
  companions: Person[]
}
export type Branch = { branchId: string; name: string; nameJa?: string }

export type AdminBranch = {
  branchId: string; name: string; nameJa: string; address: string; addressJa: string
  openTime: string; closeTime: string; lunchStart: string; lunchEnd: string
  closedDays: number[]; noLunchDays: number[]; holidayDates: string[]
  closeBufferMin: number; lunchBufferMin: number; blockedSlots: string[]
  lineNotifyId: string; channelAccessToken: string
}
export type Customer = {
  lineUserId: string; name: string; nameKo: string; displayName: string
  birthDate: string | null; gender: string | null; createdAt: string
}
export type ManagerProposeInfo = {
  ok: boolean; reason?: string
  state?: 'actionable' | 'confirmed' | 'rejected' | 'cancelled' | 'proposed_waiting'
  branchId?: string; branchName?: string; nameKo?: string
  status?: string; canPropose?: boolean; proposedTimes?: string[]
  currentDate?: string; currentTime?: string
  requestedDate?: string | null; requestedTime?: string | null
  targetDate?: string; memo?: string
}

export type AdminMe = { role: 'super' | 'branch'; branchId: string | null }
export type AdminUser = { email: string; branchId: string | null; createdAt?: string }
export type Cursor = { created: string; id: string } | null
export type Page<T> = { items: T[]; nextCursor: Cursor; counts?: Record<string, number> | null }

// 빈 값 제거 후 쿼리 파라미터로 (cursor는 cursorCreated/cursorId로 펼침)
const pageParams = (o: Record<string, any>): Record<string, string> => {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(o)) {
    if (k === 'cursor') { if (v) { out.cursorCreated = v.created; out.cursorId = v.id } continue }
    if (v !== undefined && v !== null && v !== '') out[k] = String(v)
  }
  return out
}

export const adminApi = {
  getMe: (): Promise<AdminMe> => adminGet('admin-me'),
  getBranches: (): Promise<Branch[]> => adminGet('admin-branches'),
  getReservations: (branchId?: string): Promise<Booking[]> =>
    adminGet('admin-reservations', branchId ? { branchId } : {}),
  // keyset 무한 스크롤(예약 관리)
  getReservationsPage: (o: { branchId?: string; status: string; q?: string; dateField?: string; from?: string; to?: string; fromTime?: string; toTime?: string; cursor?: Cursor; limit?: number }): Promise<Page<Booking>> =>
    adminGet('admin-reservations-page', pageParams(o)),
  // 캘린더 뷰 — 그 달 예약만
  getReservationsMonth: (month: string, branchId?: string): Promise<Booking[]> =>
    adminGet('admin-reservations', branchId ? { month, branchId } : { month }),
  // keyset 무한 스크롤(고객 관리)
  getCustomersPage: (o: { branchId?: string; cursor?: Cursor; limit?: number }): Promise<Page<Customer>> =>
    adminGet('admin-customers-page', pageParams(o)),
  confirm: (reservationId: string) => adminPost('admin-confirm', { reservationId }),
  reject: (reservationId: string, message?: string) => adminPost('admin-reject', { reservationId, message }),
  propose: (reservationId: string, date: string, times: string[]) =>
    adminPost('admin-propose', { reservationId, date, times }),
  // 슬롯 조회(공개 엔드포인트) — 제안 시간 선택용
  getSlots: (branchId: string, date: string): Promise<{ time: string; available: boolean }[]> =>
    adminGet('available-slots', { branchId, date }),

  // 병원 관리
  getAdminBranches: (): Promise<AdminBranch[]> => adminGet('admin-branches-full'),
  getHolidays: (): Promise<{ date: string; name: string }[]> => adminGet('admin-holidays'),
  saveBranch: (branch: AdminBranch) => adminPost('admin-branch-save', { branch }),
  deleteBranch: (branchId: string) => adminPost('admin-branch-delete', { branchId }),

  // 고객 관리
  getCustomers: (branchId?: string): Promise<Customer[]> => adminGet('admin-customers', branchId ? { branchId } : {}),
  getCustomerReservations: (lineUserId: string): Promise<Booking[]> =>
    adminGet('admin-customer-reservations', { lineUserId }),
  updateCustomerNameKo: (lineUserId: string, nameKo: string) =>
    adminPost('admin-customer-update', { lineUserId, nameKo }),

  // 관리자 관리 (슈퍼 전용)
  listAdmins: (): Promise<AdminUser[]> => adminGet('admin-admins'),
  saveAdmin: (email: string, branchId: string | null) => adminPost('admin-admin-save', { email, branchId }),
  deleteAdmin: (email: string) => adminPost('admin-admin-delete', { email }),

  // 매니저 예약 처리 (로그인 없음 · 알림 링크로 진입)
  getManagerProposeInfo: (reservationId: string): Promise<ManagerProposeInfo> =>
    adminGet('manager-propose-info', { reservationId }),
  managerPropose: (reservationId: string, date: string, times: string[]) =>
    adminPost('manager-propose', { reservationId, date, times }),
  managerConfirm: (reservationId: string) => adminPost('manager-confirm', { reservationId }),
  managerReject: (reservationId: string, message?: string) => adminPost('manager-reject', { reservationId, message }),
}
