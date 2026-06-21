import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'
import { adminApi } from './api'
import type { Booking, Branch, Person, AdminBranch, Customer } from './api'

const STATUS_KO: Record<string, string> = {
  pending: '대기', confirmed: '확정', rejected: '거절', cancelled: '취소', completed: '완료',
}
const STATUS_COLOR: Record<string, { bg: string; fg: string }> = {
  pending: { bg: '#FEF3C7', fg: '#92400E' },
  confirmed: { bg: '#D1FAE5', fg: '#065F46' },
  rejected: { bg: '#FEE2E2', fg: '#991B1B' },
  cancelled: { bg: '#F3F4F6', fg: '#6B7280' },
  completed: { bg: '#E0E7FF', fg: '#3730A3' },
}
const visitKo = (v: string) => (v === 'first' ? '초진' : v === 'return' ? '재진' : v)
const dot = (d?: string | null) => (d ? d.replace(/-/g, '.') : '')

// 개발용: true면 로그인 없이 바로 대시보드 (백엔드 ADMIN_AUTH_DISABLED와 함께 사용)
const NO_AUTH = (import.meta.env.VITE_ADMIN_NO_AUTH as string) === 'true'

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined)

  useEffect(() => {
    if (NO_AUTH) return
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  if (NO_AUTH) return <AdminShell session={null} />
  if (session === undefined) return <Center>불러오는 중…</Center>
  if (!session) return <Login />
  return <AdminShell session={session} />
}

// ── 셸: 상단 네비 + 권한 게이트 ───────────────────────────────
type View = 'reservations' | 'branches' | 'customers'
const NAV: { key: View; label: string }[] = [
  { key: 'reservations', label: '예약 관리' },
  { key: 'branches', label: '병원 관리' },
  { key: 'customers', label: '고객 관리' },
]
function AdminShell({ session }: { session: Session | null }) {
  const [view, setView] = useState<View>('reservations')
  const [access, setAccess] = useState<'checking' | 'ok' | 'forbidden'>('checking')
  useEffect(() => {
    adminApi.getBranches()
      .then(() => setAccess('ok'))
      .catch((e: any) => setAccess(String(e?.message || '').includes('승인') ? 'forbidden' : 'ok'))
  }, [])

  if (access === 'checking') return <Center>불러오는 중…</Center>
  if (access === 'forbidden') return (
    <Center>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>🚫</div>
        <h2 style={{ fontSize: 18 }}>승인되지 않은 계정입니다</h2>
        <p style={{ color: '#888', fontSize: 14, margin: '8px 0 24px' }}>{session?.user.email}</p>
        <button onClick={() => supabase.auth.signOut()} style={logoutBtn}>로그아웃</button>
      </div>
    </Center>
  )

  return (
    <div style={{ maxWidth: 880, margin: '0 auto', padding: '0 16px 60px' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '14px 0', position: 'sticky', top: 0, background: '#fff', borderBottom: '1px solid #EEE', zIndex: 20 }}>
        <div style={{ display: 'flex', gap: 6 }}>
          {NAV.map(n => (
            <button key={n.key} onClick={() => setView(n.key)} style={{
              padding: '8px 14px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 14, fontWeight: 700,
              background: view === n.key ? '#111' : 'transparent', color: view === n.key ? '#fff' : '#888',
            }}>{n.label}</button>
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 12, color: '#aaa' }}>{session?.user.email ?? '개발 모드'}</span>
          {session && <button onClick={() => supabase.auth.signOut()} style={{ ...logoutBtn, padding: '6px 12px', fontSize: 12.5 }}>로그아웃</button>}
        </div>
      </header>

      {view === 'reservations' && <ReservationsView />}
      {view === 'branches' && <BranchesView />}
      {view === 'customers' && <CustomersView />}
    </div>
  )
}

// ── 로그인 ────────────────────────────────────────────────────
function Login() {
  const signIn = () =>
    supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin } })
  return (
    <Center>
      <div style={{ textAlign: 'center' }}>
        <h1 style={{ fontSize: 22, marginBottom: 8 }}>예약 관리자 대시보드</h1>
        <p style={{ color: '#888', fontSize: 14, marginBottom: 28 }}>승인된 관리자만 접근할 수 있습니다.</p>
        <button onClick={signIn} style={{
          padding: '12px 24px', borderRadius: 10, border: '1px solid #DADCE0', background: '#fff',
          fontSize: 15, fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 10,
        }}>
          <span style={{ fontSize: 18 }}>🔑</span> Google로 로그인
        </button>
      </div>
    </Center>
  )
}

// ── 대시보드 ──────────────────────────────────────────────────
type Tab = 'action' | 'confirmed' | 'rejected' | 'cancelled' | 'all'
const TABS: { key: Tab; label: string }[] = [
  { key: 'action', label: '처리 대기' },
  { key: 'confirmed', label: '확정' },
  { key: 'rejected', label: '거절' },
  { key: 'cancelled', label: '취소' },
  { key: 'all', label: '전체' },
]

function pendingCompanionBatches(b: Booking): Person[][] {
  const map: Record<string, Person[]> = {}
  for (const c of b.companions) {
    if (c.status === 'pending' && c.batchId !== b.groupId) (map[c.batchId] ??= []).push(c)
  }
  return Object.values(map)
}
const isClinicProposed = (b: Booking) => !!b.requestedDate && b.proposedBy === 'clinic'  // 고객 응답 대기
const isReschedulePending = (b: Booking) => !!b.requestedDate && b.proposedBy !== 'clinic'  // 고객 변경요청 → 병원 처리
const isNewPending = (b: Booking) => b.booker.status === 'pending' && !b.requestedDate
const needsAction = (b: Booking) =>
  isNewPending(b) || isReschedulePending(b) || isClinicProposed(b) ||
  (b.booker.status === 'confirmed' && pendingCompanionBatches(b).length > 0)

function ReservationsView() {
  const [branches, setBranches] = useState<Branch[]>([])
  const [branchId, setBranchId] = useState('')
  const [bookings, setBookings] = useState<Booking[]>([])
  const [tab, setTab] = useState<Tab>('action')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)

  const load = async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const [bs, rs] = await Promise.all([
        adminApi.getBranches(),
        adminApi.getReservations(branchId || undefined),
      ])
      setBranches(bs)
      setBookings(rs)
    } catch (e: any) {
      if (!silent) alert(e?.message || '불러오기에 실패했습니다')
    } finally {
      if (!silent) setLoading(false)
    }
  }
  useEffect(() => { load() }, [branchId])

  // 자동 새로고침: 탭 복귀 시 즉시 + 15초마다 (조용히)
  useEffect(() => {
    const tick = () => { if (document.visibilityState === 'visible') load(true) }
    const iv = setInterval(tick, 15000)
    window.addEventListener('focus', tick)
    document.addEventListener('visibilitychange', tick)
    return () => { clearInterval(iv); window.removeEventListener('focus', tick); document.removeEventListener('visibilitychange', tick) }
  }, [branchId])

  const act = async (kind: 'confirm' | 'reject', reservationId: string) => {
    if (!confirm(kind === 'confirm' ? '확정하시겠습니까? (고객에게 알림이 갑니다)' : '거절하시겠습니까? (고객에게 알림이 갑니다)')) return
    setBusy(reservationId)
    try {
      await (kind === 'confirm' ? adminApi.confirm(reservationId) : adminApi.reject(reservationId))
      await load()
    } catch (e: any) {
      alert(e?.message || '처리에 실패했습니다')
    } finally {
      setBusy(null)
    }
  }

  const filtered = bookings.filter(b => {
    if (tab === 'action') return needsAction(b)
    if (tab === 'all') return true
    return b.booker.status === tab
  })

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', margin: '16px 0' }}>
        <select value={branchId} onChange={e => setBranchId(e.target.value)} style={{ padding: '9px 12px', borderRadius: 8, border: '1px solid #DDD', fontSize: 14 }}>
          <option value="">전체 병원</option>
          {branches.map(b => <option key={b.branchId} value={b.branchId}>{b.name}</option>)}
        </select>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {TABS.map(t => {
            const count = bookings.filter(b => t.key === 'action' ? needsAction(b) : t.key === 'all' ? true : b.booker.status === t.key).length
            const active = tab === t.key
            return (
              <button key={t.key} onClick={() => setTab(t.key)} style={{
                padding: '8px 14px', borderRadius: 999, border: `1px solid ${active ? '#1D9E75' : '#DDD'}`,
                background: active ? '#1D9E75' : '#fff', color: active ? '#fff' : '#555',
                fontSize: 13, fontWeight: 600, cursor: 'pointer',
              }}>
                {t.label} {count > 0 && <span style={{ opacity: 0.8 }}>({count})</span>}
              </button>
            )
          })}
        </div>
        <button onClick={() => load()} style={{ marginLeft: 'auto', padding: '8px 12px', borderRadius: 8, border: '1px solid #DDD', background: '#fff', fontSize: 13, cursor: 'pointer' }}>↻ 새로고침</button>
      </div>

      {loading ? (
        <Center small>불러오는 중…</Center>
      ) : filtered.length === 0 ? (
        <p style={{ textAlign: 'center', color: '#999', padding: '40px 0', fontSize: 14 }}>해당 예약이 없습니다.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {filtered.map(b => <BookingCard key={b.groupId} b={b} busy={busy} act={act} reload={() => load(true)} />)}
        </div>
      )}
    </div>
  )
}

const genderKo = (g?: string | null) => (g === 'male' ? '남성' : g === 'female' ? '여성' : (g || '-'))
const kStyle: React.CSSProperties = { color: '#999', fontSize: 11.5, marginRight: 4 }

function PersonDetail({ label, p, showStatus }: { label: string; p: Person; showStatus?: boolean }) {
  const [more, setMore] = useState(false)
  const moreBtn: React.CSSProperties = { background: 'none', border: 'none', color: '#1D9E75', fontSize: 12, fontWeight: 600, cursor: 'pointer', padding: '4px 0 0', alignSelf: 'flex-start' }
  return (
    <div style={{ border: '1px solid #EFEFEF', borderRadius: 10, padding: '10px 12px', marginTop: 8, background: '#FCFCFC', display: 'flex', flexDirection: 'column' }}>
      {/* 필수 정보 + 희망시술 한 줄 + 상태 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
        <div style={{ fontSize: 13, color: '#555', lineHeight: 1.6 }}>
          <span style={{ fontSize: 11, color: '#777', background: '#EEE', borderRadius: 6, padding: '1px 6px', marginRight: 6 }}>{label}</span>
          <b style={{ fontSize: 14, color: '#111' }}>{p.nameKo || p.name}</b>
          {p.nameKo && p.name && <span style={{ color: '#aaa', fontSize: 12 }}>({p.name})</span>}
          {' · '}{p.birthDate || '-'}{' · '}{genderKo(p.gender)}{' · '}{visitKo(p.visitType)}
          {'　'}<span style={kStyle}>희망시술</span>{p.treatmentRequest || '-'}
        </div>
        {showStatus && <StatusBadge status={p.status} />}
      </div>

      {/* 희망예산 · 시술이력 (더보기) */}
      {more && (
        <>
          <div style={{ fontSize: 13, color: '#333', marginTop: 5 }}><span style={kStyle}>희망예산</span>{p.budget || '-'}</div>
          <div style={{ fontSize: 13, color: '#333', marginTop: 3 }}><span style={kStyle}>시술이력</span>{p.surgeryHistory || '-'}</div>
        </>
      )}
      <button onClick={() => setMore(v => !v)} style={moreBtn}>{more ? '접기 ▴' : '더보기 ▾'}</button>
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const c = STATUS_COLOR[status] ?? STATUS_COLOR.pending
  return <span style={{ padding: '3px 10px', borderRadius: 10, background: c.bg, color: c.fg, fontSize: 12, fontWeight: 700 }}>{STATUS_KO[status] ?? status}</span>
}

function ActionRow({ label, accent, reservationId, busy, act }: {
  label: string; accent: string; reservationId: string; busy: string | null; act: (k: 'confirm' | 'reject', id: string) => void
}) {
  const disabled = busy === reservationId
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 10, marginTop: 8 }}>
      <span style={{ flex: 1, fontSize: 13, fontWeight: 700, color: accent }}>{label}</span>
      <button disabled={disabled} onClick={() => act('confirm', reservationId)} style={{ padding: '7px 14px', borderRadius: 8, border: 'none', background: '#1D9E75', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer', opacity: disabled ? 0.5 : 1 }}>확정</button>
      <button disabled={disabled} onClick={() => act('reject', reservationId)} style={{ padding: '7px 14px', borderRadius: 8, border: '1px solid #E53E3E', background: '#fff', color: '#E53E3E', fontSize: 13, fontWeight: 700, cursor: 'pointer', opacity: disabled ? 0.5 : 1 }}>거절</button>
    </div>
  )
}

function BookingCard({ b, busy, act, reload }: { b: Booking; busy: string | null; act: (k: 'confirm' | 'reject', id: string) => void; reload: () => void }) {
  const compBatches = pendingCompanionBatches(b)
  const [proposing, setProposing] = useState(false)
  const [slots, setSlots] = useState<{ time: string; available: boolean }[]>([])
  const [picked, setPicked] = useState<string[]>([])
  const [pBusy, setPBusy] = useState(false)

  // 제안 대상 날짜: 시간변경 요청이면 고객이 원한 날짜, 아니면 기존 예약 날짜
  const targetDate = isReschedulePending(b) ? (b.requestedDate || b.date) : b.date

  useEffect(() => {
    if (!proposing) return
    adminApi.getSlots(b.branchId, targetDate).then(setSlots).catch(() => setSlots([]))
  }, [proposing])

  const toggle = (t: string) => setPicked(prev => prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t])

  const submitPropose = async () => {
    if (!picked.length) { alert('제안할 시간을 1개 이상 선택하세요'); return }
    setPBusy(true)
    try {
      await adminApi.propose(b.booker.id, targetDate, picked)
      setProposing(false); setPicked([])
      reload()
    } catch (e: any) {
      alert(e?.message || '제안 실패')
    } finally {
      setPBusy(false)
    }
  }

  const proposePanel = (
    !proposing ? (
      <button onClick={() => setProposing(true)} style={{ marginTop: 6, width: '100%', padding: '8px', borderRadius: 8, border: '1px dashed #F6A623', background: '#FFFBEB', color: '#B45309', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
        🕒 다른 시간 제안
      </button>
    ) : (
      <div style={{ marginTop: 6, padding: 12, border: '1px solid #FED7AA', borderRadius: 10, background: '#FFF7ED', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ fontSize: 12.5, fontWeight: 700, color: '#9A3412' }}>{dot(targetDate)} · 제안할 시간 선택 (여러 개 가능)</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {slots.length === 0 && <span style={{ fontSize: 12.5, color: '#999' }}>해당 날짜에 가능한 시간이 없습니다.</span>}
          {slots.map(s => {
            const on = picked.includes(s.time)
            return (
              <button key={s.time} onClick={() => toggle(s.time)} style={{
                padding: '7px 12px', borderRadius: 999, fontSize: 13, fontWeight: 600, cursor: 'pointer',
                border: `1.5px solid ${on ? '#1D9E75' : '#DDD'}`, background: on ? '#1D9E75' : '#fff', color: on ? '#fff' : '#555',
              }}>{s.time}</button>
            )
          })}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button disabled={pBusy} onClick={submitPropose} style={{ flex: 1, padding: '8px', borderRadius: 8, border: 'none', background: '#F6A623', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer', opacity: pBusy ? 0.5 : 1 }}>{pBusy ? '제안 중…' : `이 시간들 제안 (${picked.length})`}</button>
          <button disabled={pBusy} onClick={() => { setProposing(false); setPicked([]) }} style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid #DDD', background: '#fff', color: '#666', fontSize: 13, cursor: 'pointer' }}>취소</button>
        </div>
      </div>
    )
  )

  return (
    <div style={{ background: '#fff', border: '1px solid #EEE', borderRadius: 14, padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <div style={{ fontSize: 13.5, fontWeight: 700, color: '#444' }}>{b.branchName} · {dot(b.date)} {b.time}</div>
        <StatusBadge status={b.booker.status} />
      </div>

      <PersonDetail label="예약자" p={b.booker} />
      {b.companions.map((c, i) => <PersonDetail key={c.id} label={`동반자 ${i + 1}`} p={c} showStatus />)}

      {/* 병원이 제안함 — 고객 응답 대기 */}
      {isClinicProposed(b) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', background: '#FFF7ED', border: '1px solid #FED7AA', borderRadius: 10, marginTop: 8 }}>
          <span style={{ flex: 1, fontSize: 13, fontWeight: 700, color: '#9A3412' }}>🕒 시간 제안함 · 고객 응답 대기 → {dot(b.requestedDate)} ({b.proposedTimes.join(', ')})</span>
          <button disabled={busy === b.booker.id} onClick={() => act('reject', b.booker.id)} style={{ padding: '7px 12px', borderRadius: 8, border: '1px solid #E53E3E', background: '#fff', color: '#E53E3E', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>제안 취소(거절)</button>
        </div>
      )}

      {/* 고객 시간변경 요청 → 병원 확정/거절 + 다른 시간 제안 */}
      {isReschedulePending(b) && (
        <>
          <ActionRow label={`🔁 시간변경 요청 → ${dot(b.requestedDate)} ${b.requestedTime}`} accent="#92400E" reservationId={b.booker.id} busy={busy} act={act} />
          {proposePanel}
        </>
      )}

      {/* 신규 예약 — 확정/거절 + 다른 시간 제안 */}
      {isNewPending(b) && (
        <>
          <ActionRow label="🆕 신규 예약 승인 대기" accent="#92400E" reservationId={b.booker.id} busy={busy} act={act} />
          {proposePanel}
        </>
      )}

      {/* 동반자 추가 승인은 '예약 확정' 상태에서만 (대기중이면 예약 확정 시 함께 처리됨) */}
      {b.booker.status === 'confirmed' && compBatches.map((batch, i) => (
        <ActionRow key={i} label={`➕ 동반자 추가 승인 대기: ${batch.map(c => c.nameKo || c.name).join(', ')}`} accent="#065F46" reservationId={batch[0].id} busy={busy} act={act} />
      ))}
    </div>
  )
}

// ── 병원 관리 ─────────────────────────────────────────────────
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토']
const emptyBranch = (): AdminBranch => ({
  branchId: '', name: '', nameJa: '', address: '', addressJa: '',
  openTime: '', closeTime: '', lunchStart: '', lunchEnd: '',
  closedDays: [], noLunchDays: [], holidayDates: [], lineNotifyId: '', channelAccessToken: '',
})
function Lbl({ children }: { children: React.ReactNode }) {
  return <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#666', margin: '12px 0 4px' }}>{children}</label>
}
const inputStyle: React.CSSProperties = { width: '100%', padding: '9px 11px', borderRadius: 8, border: '1px solid #DDD', fontSize: 14, boxSizing: 'border-box' }
function Txt({ value, onChange, disabled, placeholder, type }: { value: string; onChange: (v: string) => void; disabled?: boolean; placeholder?: string; type?: string }) {
  return <input type={type || 'text'} value={value} disabled={disabled} placeholder={placeholder} onChange={e => onChange(e.target.value)} style={{ ...inputStyle, background: disabled ? '#F3F4F6' : '#fff' }} />
}

function BranchesView() {
  const [list, setList] = useState<AdminBranch[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<{ b: AdminBranch; isNew: boolean } | null>(null)

  const load = () => { setLoading(true); adminApi.getAdminBranches().then(setList).catch((e: any) => alert(e?.message)).finally(() => setLoading(false)) }
  useEffect(() => { load() }, [])

  if (editing) return <BranchForm init={editing.b} isNew={editing.isNew} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load() }} />
  if (loading) return <Center small>불러오는 중…</Center>
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '16px 0' }}>
        <h2 style={{ fontSize: 16, margin: 0 }}>병원 ({list.length})</h2>
        <button onClick={() => setEditing({ b: emptyBranch(), isNew: true })} style={primaryBtn}>+ 새 병원</button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {list.map(b => (
          <button key={b.branchId} onClick={() => setEditing({ b, isNew: false })} style={listRow}>
            <div style={{ fontSize: 15, fontWeight: 700 }}>{b.name} <span style={{ color: '#aaa', fontSize: 12, fontWeight: 400 }}>{b.nameJa}</span></div>
            <div style={{ fontSize: 12.5, color: '#888', marginTop: 3 }}>ID {b.branchId} · 영업 {b.openTime || '-'}~{b.closeTime || '-'} · 점심 {b.lunchStart || '-'}~{b.lunchEnd || '-'}</div>
          </button>
        ))}
        {list.length === 0 && <p style={{ color: '#999', fontSize: 14 }}>병원이 없습니다.</p>}
      </div>
    </div>
  )
}

function BranchForm({ init, isNew, onClose, onSaved }: { init: AdminBranch; isNew: boolean; onClose: () => void; onSaved: () => void }) {
  const [b, setB] = useState<AdminBranch>(init)
  const [holidayText, setHolidayText] = useState((init.holidayDates || []).join(', '))
  const [busy, setBusy] = useState(false)
  const set = (k: keyof AdminBranch, v: any) => setB(prev => ({ ...prev, [k]: v }))
  const toggleDay = (key: 'closedDays' | 'noLunchDays', d: number) =>
    setB(prev => ({ ...prev, [key]: prev[key].includes(d) ? prev[key].filter(x => x !== d) : [...prev[key], d] }))

  const save = async () => {
    if (!b.branchId.trim()) { alert('병원 ID를 입력하세요'); return }
    setBusy(true)
    try {
      await adminApi.saveBranch({ ...b, holidayDates: holidayText.split(',').map(s => s.trim()).filter(Boolean) })
      onSaved()
    } catch (e: any) { alert(e?.message || '저장 실패') } finally { setBusy(false) }
  }
  const del = async () => {
    if (!confirm('이 병원을 삭제하시겠습니까?')) return
    setBusy(true)
    try { await adminApi.deleteBranch(b.branchId); onSaved() } catch (e: any) { alert(e?.message || '삭제 실패') } finally { setBusy(false) }
  }
  const dayRow = (key: 'closedDays' | 'noLunchDays') => (
    <div style={{ display: 'flex', gap: 6 }}>
      {WEEKDAYS.map((w, d) => {
        const on = b[key].includes(d)
        return <button key={d} onClick={() => toggleDay(key, d)} style={{ width: 38, height: 38, borderRadius: 8, cursor: 'pointer', border: `1.5px solid ${on ? '#1D9E75' : '#DDD'}`, background: on ? '#1D9E75' : '#fff', color: on ? '#fff' : '#666', fontSize: 13, fontWeight: 600 }}>{w}</button>
      })}
    </div>
  )

  return (
    <div style={{ margin: '16px 0' }}>
      <button onClick={onClose} style={ghostBtn}>← 목록</button>
      <h2 style={{ fontSize: 17, margin: '10px 0 4px' }}>{isNew ? '새 병원 추가' : '병원 수정'}</h2>

      <Lbl>병원 ID (LINE 채널 ID{isNew ? '' : ', 변경 불가'})</Lbl>
      <Txt value={b.branchId} onChange={v => set('branchId', v)} disabled={!isNew} placeholder="2008835257" />
      <Lbl>이름 (한국어)</Lbl><Txt value={b.name} onChange={v => set('name', v)} />
      <Lbl>이름 (일본어)</Lbl><Txt value={b.nameJa} onChange={v => set('nameJa', v)} />
      <Lbl>주소 (한국어)</Lbl><Txt value={b.address} onChange={v => set('address', v)} />
      <Lbl>주소 (일본어)</Lbl><Txt value={b.addressJa} onChange={v => set('addressJa', v)} />

      <div style={{ display: 'flex', gap: 10 }}>
        <div style={{ flex: 1 }}><Lbl>영업 시작</Lbl><Txt type="time" value={b.openTime} onChange={v => set('openTime', v)} /></div>
        <div style={{ flex: 1 }}><Lbl>영업 마감</Lbl><Txt type="time" value={b.closeTime} onChange={v => set('closeTime', v)} /></div>
      </div>
      <div style={{ display: 'flex', gap: 10 }}>
        <div style={{ flex: 1 }}><Lbl>점심 시작</Lbl><Txt type="time" value={b.lunchStart} onChange={v => set('lunchStart', v)} /></div>
        <div style={{ flex: 1 }}><Lbl>점심 종료</Lbl><Txt type="time" value={b.lunchEnd} onChange={v => set('lunchEnd', v)} /></div>
      </div>

      <Lbl>휴무 요일</Lbl>{dayRow('closedDays')}
      <Lbl>점심 없는 요일</Lbl>{dayRow('noLunchDays')}
      <Lbl>공휴일 (쉼표 구분, YYYY-MM-DD)</Lbl><Txt value={holidayText} onChange={setHolidayText} placeholder="2026-01-01, 2026-12-25" />
      <Lbl>매니저 LINE ID (알림 수신)</Lbl><Txt value={b.lineNotifyId} onChange={v => set('lineNotifyId', v)} />
      <Lbl>채널 액세스 토큰 (병원별 푸시)</Lbl><Txt value={b.channelAccessToken} onChange={v => set('channelAccessToken', v)} placeholder="비우면 전역 토큰 사용" />

      <div style={{ display: 'flex', gap: 8, marginTop: 22 }}>
        <button disabled={busy} onClick={save} style={{ ...primaryBtn, flex: 1, padding: '12px' }}>{busy ? '저장 중…' : '저장'}</button>
        {!isNew && <button disabled={busy} onClick={del} style={{ padding: '12px 18px', borderRadius: 8, border: '1px solid #E53E3E', background: '#fff', color: '#E53E3E', fontWeight: 700, cursor: 'pointer' }}>삭제</button>}
      </div>
    </div>
  )
}

// ── 고객 관리 ─────────────────────────────────────────────────
function CustomersView() {
  const [list, setList] = useState<Customer[]>([])
  const [loading, setLoading] = useState(true)
  const [sel, setSel] = useState<Customer | null>(null)
  const [resv, setResv] = useState<Booking[] | null>(null)

  useEffect(() => { adminApi.getCustomers().then(setList).catch((e: any) => alert(e?.message)).finally(() => setLoading(false)) }, [])
  const open = async (c: Customer) => {
    setSel(c); setResv(null)
    try { setResv(await adminApi.getCustomerReservations(c.lineUserId)) } catch { setResv([]) }
  }

  if (sel) return (
    <div style={{ margin: '16px 0' }}>
      <button onClick={() => setSel(null)} style={ghostBtn}>← 목록</button>
      <h2 style={{ fontSize: 17, margin: '10px 0 2px' }}>{sel.nameKo || sel.name || '(이름없음)'} <span style={{ fontSize: 13, color: '#aaa', fontWeight: 400 }}>{sel.name}</span></h2>
      <div style={{ fontSize: 12.5, color: '#888', marginBottom: 14 }}>{sel.birthDate || '-'} · {genderKo(sel.gender)} · 등록 {dot((sel.createdAt || '').slice(0, 10))}</div>
      {resv === null ? <Center small>불러오는 중…</Center>
        : resv.length === 0 ? <p style={{ color: '#999', fontSize: 14 }}>예약 내역이 없습니다.</p>
          : <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>{resv.map(b => <ReadonlyBooking key={b.groupId} b={b} />)}</div>}
    </div>
  )

  if (loading) return <Center small>불러오는 중…</Center>
  return (
    <div>
      <h2 style={{ fontSize: 16, margin: '16px 0' }}>고객 ({list.length}) · 등록순</h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {list.map(c => (
          <button key={c.lineUserId} onClick={() => open(c)} style={listRow}>
            <div style={{ fontSize: 15, fontWeight: 700 }}>{c.nameKo || c.name || '(이름없음)'} <span style={{ color: '#aaa', fontSize: 12, fontWeight: 400 }}>{c.name}</span></div>
            <div style={{ fontSize: 12.5, color: '#888', marginTop: 3 }}>{c.birthDate || '-'} · {genderKo(c.gender)} · 등록 {dot((c.createdAt || '').slice(0, 10))}</div>
          </button>
        ))}
        {list.length === 0 && <p style={{ color: '#999', fontSize: 14 }}>고객이 없습니다.</p>}
      </div>
    </div>
  )
}

function ReadonlyBooking({ b }: { b: Booking }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #EEE', borderRadius: 14, padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <div style={{ fontSize: 13.5, fontWeight: 700, color: '#444' }}>{b.branchName} · {dot(b.date)} {b.time}</div>
        <StatusBadge status={b.booker.status} />
      </div>
      <PersonDetail label="예약자" p={b.booker} />
      {b.companions.map((c, i) => <PersonDetail key={c.id} label={`동반자 ${i + 1}`} p={c} showStatus />)}
    </div>
  )
}

// ── 공통 ──────────────────────────────────────────────────────
function Center({ children, small }: { children: React.ReactNode; small?: boolean }) {
  return (
    <div style={{ minHeight: small ? '40vh' : '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'system-ui, sans-serif', color: '#444' }}>
      {children}
    </div>
  )
}
const logoutBtn: React.CSSProperties = { padding: '10px 18px', borderRadius: 8, border: '1px solid #DDD', background: '#fff', fontSize: 14, cursor: 'pointer' }
const primaryBtn: React.CSSProperties = { padding: '8px 14px', borderRadius: 8, border: 'none', background: '#1D9E75', color: '#fff', fontSize: 13.5, fontWeight: 700, cursor: 'pointer' }
const ghostBtn: React.CSSProperties = { background: 'none', border: 'none', color: '#888', fontSize: 13, cursor: 'pointer', padding: 0 }
const listRow: React.CSSProperties = { textAlign: 'left', width: '100%', background: '#fff', border: '1px solid #EEE', borderRadius: 12, padding: '14px 16px', cursor: 'pointer' }
