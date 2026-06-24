import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'
import { adminApi } from './api'
import type { Booking, Branch, Person, AdminBranch, Customer, ManagerProposeInfo } from './api'

const STATUS_KO: Record<string, string> = {
  pending: '접수', confirmed: '확정', rejected: '거절', cancelled: '취소', completed: '완료',
  reschedule_req: '일시변경 요청', rescheduling: '시간 조정 중',
}
const STATUS_COLOR: Record<string, { bg: string; fg: string; border: string }> = {
  pending:        { bg: '#FEF3C7', fg: '#92400E', border: '#FCD34D' },
  confirmed:      { bg: '#D1FAE5', fg: '#065F46', border: '#6EE7B7' },
  rejected:       { bg: '#FEE2E2', fg: '#991B1B', border: '#FCA5A5' },
  cancelled:      { bg: '#F3F4F6', fg: '#6B7280', border: '#E5E7EB' },
  completed:      { bg: '#E0E7FF', fg: '#3730A3', border: '#C7D2FE' },
  reschedule_req: { bg: '#DBEAFE', fg: '#1E40AF', border: '#93C5FD' },
  rescheduling:   { bg: '#FFEDD5', fg: '#9A3412', border: '#FDBA74' },
}
const visitKo = (v: string) => (v === 'first' ? '초진' : v === 'return' ? '재진' : v)
const dot = (d?: string | null) => (d ? d.replace(/-/g, '.') : '')

// 개발용: true면 로그인 없이 바로 대시보드 (백엔드 ADMIN_AUTH_DISABLED와 함께 사용)
const NO_AUTH = (import.meta.env.VITE_ADMIN_NO_AUTH as string) === 'true'
// 예약 앱(LIFF) URL 생성용 — 비밀 아님
const LIFF_ID = (import.meta.env.VITE_LIFF_ID as string) || '2010411582-Duzo9BLZ'

export default function App() {
  // 매니저 예약 처리 페이지(로그인 없음) — 알림 단일 버튼 링크 ?manage=<id>
  const manageId = new URLSearchParams(window.location.search).get('manage')
  if (manageId) return <ManagerActionPage reservationId={manageId} />

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
    <div style={{ display: 'flex', minHeight: '100dvh', fontFamily: 'system-ui, sans-serif' }}>
      <aside style={{ width: 180, flexShrink: 0, background: '#fff', borderRight: '1px solid #EEE', padding: '20px 12px', display: 'flex', flexDirection: 'column', gap: 4, position: 'sticky', top: 0, height: '100dvh', boxSizing: 'border-box' }}>
        <div style={{ fontSize: 16, fontWeight: 800, padding: '4px 10px 16px' }}>관리자</div>
        {NAV.map(n => (
          <button key={n.key} onClick={() => setView(n.key)} style={{
            textAlign: 'left', padding: '10px 12px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 14, fontWeight: 600,
            background: view === n.key ? '#111' : 'transparent', color: view === n.key ? '#fff' : '#555',
          }}>{n.label}</button>
        ))}
        <div style={{ marginTop: 'auto', fontSize: 11.5, color: '#aaa', padding: '0 10px' }}>
          <div style={{ wordBreak: 'break-all', marginBottom: 8 }}>{session?.user.email ?? '개발 모드'}</div>
          {session && <button onClick={() => supabase.auth.signOut()} style={{ ...logoutBtn, padding: '6px 10px', fontSize: 12 }}>로그아웃</button>}
        </div>
      </aside>
      <main style={{ flex: 1, minWidth: 0, padding: '0 20px 60px', background: '#F7F8FA' }}>
        <div style={{ maxWidth: view === 'reservations' ? '100%' : 760, margin: '0 auto' }}>
          {view === 'reservations' && <ReservationsView />}
          {view === 'branches' && <BranchesView />}
          {view === 'customers' && <CustomersView />}
        </div>
      </main>
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
type Tab = 'action' | 'pending' | 'proposed' | 'reschedule' | 'confirmed' | 'rejected' | 'cancelled' | 'all'
const TABS: { key: Tab; label: string }[] = [
  { key: 'action', label: '처리 대기' },          // 예약 접수+시간조정중+일시변경요청 묶음
  { key: 'pending', label: '예약 접수' },
  { key: 'proposed', label: '시간 조정 중' },
  { key: 'reschedule', label: '일시변경 요청' },
  { key: 'confirmed', label: '확정' },
  { key: 'rejected', label: '거절' },
  { key: 'cancelled', label: '취소' },
  { key: 'all', label: '전체' },
]
// 탭별 색 (배경=연한 색 / 글씨=상태 색). 전체=초록 배경+흰 글씨(활성).
const TAB_COLOR: Record<Tab, { bg: string; fg: string }> = {
  action: { bg: '#EAB308', fg: '#fff' },   // 활성 시 노란 배경 + 흰 글씨
  pending: STATUS_COLOR.pending,
  proposed: STATUS_COLOR.rescheduling,
  reschedule: STATUS_COLOR.reschedule_req,
  confirmed: STATUS_COLOR.confirmed,
  rejected: STATUS_COLOR.rejected,
  cancelled: STATUS_COLOR.cancelled,
  all: { bg: '#1D9E75', fg: '#fff' },
}

function pendingCompanionBatches(b: Booking): Person[][] {
  const map: Record<string, Person[]> = {}
  for (const c of b.companions) {
    if (c.status === 'pending' && c.batchId !== b.groupId) (map[c.batchId] ??= []).push(c)
  }
  return Object.values(map)
}
// 제안/변경요청은 '활성(pending)'일 때만 인정 — 취소/거절된 건의 잔여 제안필드로 잘못 표시되지 않도록
const isClinicProposed = (b: Booking) => b.booker.status === 'pending' && !!b.requestedDate && b.proposedBy === 'clinic'  // 병원이 시간 제안 → 고객 응답 대기
const isReschedulePending = (b: Booking) => b.booker.status === 'pending' && !!b.requestedDate && b.proposedBy !== 'clinic'  // 고객 일시변경 요청 → 병원 처리
const isNewPending = (b: Booking) => b.booker.status === 'pending' && !b.requestedDate
// 예약자 배지 상태: 고객 일시변경 요청='일시변경 요청', 병원 제안 대기='시간 조정 중'
const bookerDisplayStatus = (b: Booking) =>
  isReschedulePending(b) ? 'reschedule_req' : isClinicProposed(b) ? 'rescheduling' : b.booker.status

// 매니저 예약 처리 페이지 (로그인 없음 · LINE 알림의 단일 버튼으로 진입)
// 한 화면에서 확정 / 거절 / 다른 시간 제안.
function ManagerActionPage({ reservationId }: { reservationId: string }) {
  const [info, setInfo] = useState<ManagerProposeInfo | null>(null)
  const [slots, setSlots] = useState<{ time: string; available: boolean }[]>([])
  const [picked, setPicked] = useState<string[]>([])
  const [proposing, setProposing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<'' | 'confirmed' | 'rejected' | 'proposed'>('')
  const [err, setErr] = useState('')
  const [confirmAction, setConfirmAction] = useState<null | { result: 'confirmed' | 'rejected' | 'proposed'; fn: () => Promise<unknown> }>(null)
  const [rejectMsg, setRejectMsg] = useState('')

  useEffect(() => {
    adminApi.getManagerProposeInfo(reservationId)
      .then(i => {
        setInfo(i)
        if (i.ok && i.branchId && i.targetDate) {
          adminApi.getSlots(i.branchId, i.targetDate).then(setSlots).catch(() => setSlots([]))
        }
      })
      .catch(e => setErr(e?.message || '불러오기에 실패했습니다'))
  }, [reservationId])

  const toggle = (t: string) => setPicked(p => p.includes(t) ? p.filter(x => x !== t) : [...p, t])
  const run = async (fn: () => Promise<unknown>, result: 'confirmed' | 'rejected' | 'proposed') => {
    setBusy(true); setErr('')
    try { await fn(); setDone(result) }
    catch (e: any) { setErr(e?.message || '처리에 실패했습니다') }
    finally { setBusy(false) }
  }
  const proceed = async () => {
    if (!confirmAction) return
    const { fn, result } = confirmAction
    setConfirmAction(null)
    // 거절은 최신 메시지를 함께 전송
    await run(result === 'rejected' ? () => adminApi.managerReject(reservationId, rejectMsg.trim() || undefined) : fn, result)
  }

  const wrap = (children: React.ReactNode) => (
    <div style={{ minHeight: '100dvh', background: '#F5F6F8', display: 'flex', justifyContent: 'center', alignItems: 'flex-start', padding: '24px 16px', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ width: '100%', maxWidth: 440, background: '#fff', borderRadius: 16, padding: 20, boxShadow: '0 2px 12px rgba(0,0,0,0.06)' }}>{children}</div>
    </div>
  )
  const btn = (bg: string, color: string, border?: string): React.CSSProperties => ({
    flex: 1, padding: '13px', borderRadius: 10, border: border ? `1.5px solid ${border}` : 'none',
    background: bg, color, fontSize: 15, fontWeight: 700, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1,
  })

  if (err && !info) return wrap(<p style={{ color: '#E53E3E', fontSize: 14 }}>{err}</p>)
  if (!info) return wrap(<p style={{ color: '#888', fontSize: 14 }}>불러오는 중…</p>)
  if (!info.ok) return wrap(<p style={{ color: '#888', fontSize: 14 }}>예약을 찾을 수 없습니다.</p>)
  if (done) {
    const [icon, title] = done === 'confirmed' ? ['✅', '예약을 확정했습니다'] : done === 'rejected' ? ['❌', '예약을 거절했습니다'] : ['🕒', '시간을 제안했습니다']
    return wrap(
      <div style={{ textAlign: 'center', padding: '20px 0' }}>
        <div style={{ fontSize: 44 }}>{icon}</div>
        <p style={{ fontWeight: 700, fontSize: 16, margin: '10px 0 6px' }}>{title}</p>
        <p style={{ color: '#888', fontSize: 13, lineHeight: 1.6 }}>고객에게 알림이 발송되었습니다.<br />이 창은 닫으셔도 됩니다.</p>
      </div>
    )
  }
  // 이미 처리된 예약 — 재진입 시 버튼 대신 정보 + 상태 표시
  if (info.state && info.state !== 'actionable') {
    const [icon, label] = info.state === 'confirmed' ? ['✅', '확정된 예약입니다']
      : info.state === 'rejected' ? ['❌', '거절된 예약입니다']
      : info.state === 'cancelled' ? ['🚫', '취소된 예약입니다']
      : ['🕒', '시간 제안 후 고객 응답 대기 중입니다']
    return wrap(
      <>
        <h2 style={{ margin: '0 0 4px', fontSize: 18 }}>🔔 예약 처리</h2>
        <p style={{ color: '#888', fontSize: 13, margin: '0 0 14px' }}>{info.branchName} · {info.nameKo}님</p>
        <div style={{ background: '#F8F9FB', borderRadius: 10, padding: '10px 12px', fontSize: 13, color: '#555', marginBottom: 16, lineHeight: 1.7 }}>
          <div>예약 일시: {dot(info.currentDate)} {info.currentTime}</div>
          {info.state === 'proposed_waiting' && <div style={{ color: '#9A3412' }}>제안한 시간: {dot(info.targetDate)} · {(info.proposedTimes ?? []).join(', ')}</div>}
        </div>
        <div style={{ textAlign: 'center', padding: '8px 0 4px' }}>
          <div style={{ fontSize: 40 }}>{icon}</div>
          <p style={{ fontWeight: 700, fontSize: 16, margin: '8px 0 4px' }}>{label}</p>
          <p style={{ color: '#888', fontSize: 13 }}>이미 처리된 예약입니다. 이 창은 닫으셔도 됩니다.</p>
        </div>
      </>
    )
  }

  return wrap(
    <>
      <h2 style={{ margin: '0 0 4px', fontSize: 18 }}>🔔 예약 처리</h2>
      <p style={{ color: '#888', fontSize: 13, margin: '0 0 14px' }}>{info.branchName} · {info.nameKo}님</p>
      <div style={{ background: '#F8F9FB', borderRadius: 10, padding: '10px 12px', fontSize: 13, color: '#555', marginBottom: 16, lineHeight: 1.7 }}>
        <div>현재 예약: {dot(info.currentDate)} {info.currentTime}</div>
        {info.requestedDate && <div style={{ color: '#9A3412', fontWeight: 700 }}>고객 변경요청: {dot(info.requestedDate)} {info.requestedTime}</div>}
      </div>

      {err && <p style={{ color: '#E53E3E', fontSize: 13, marginBottom: 10 }}>{err}</p>}

      {!proposing ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', gap: 10 }}>
            <button disabled={busy} onClick={() => setConfirmAction({ result: 'confirmed', fn: () => adminApi.managerConfirm(reservationId) })} style={btn('#1D9E75', '#fff')}>✅ 확정</button>
            <button disabled={busy} onClick={() => { setRejectMsg(''); setConfirmAction({ result: 'rejected', fn: () => adminApi.managerReject(reservationId) }) }} style={btn('#fff', '#E53E3E', '#E53E3E')}>❌ 거절</button>
          </div>
          {info.canPropose && (
            <button disabled={busy} onClick={() => setProposing(true)} style={{ ...btn('#FFFBEB', '#B45309', '#F6A623'), borderStyle: 'dashed' }}>🕒 다른 시간 제안</button>
          )}
        </div>
      ) : (
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#444', marginBottom: 8 }}>제안 날짜 {dot(info.targetDate)} · 시간 선택 (여러 개)</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {slots.length === 0 && <span style={{ color: '#999', fontSize: 13 }}>가능한 시간이 없습니다.</span>}
            {slots.map(s => {
              const on = picked.includes(s.time)
              return (
                <button key={s.time} disabled={!s.available} onClick={() => toggle(s.time)} style={{
                  padding: '9px 14px', borderRadius: 999, fontSize: 14, fontWeight: 600, cursor: s.available ? 'pointer' : 'not-allowed',
                  border: `1.5px solid ${on ? '#1D9E75' : '#DDD'}`, background: on ? '#1D9E75' : '#fff', color: on ? '#fff' : s.available ? '#333' : '#CCC',
                }}>{s.time}</button>
              )
            })}
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
            <button disabled={busy} onClick={() => { setProposing(false); setPicked([]) }} style={btn('#fff', '#666', '#DDD')}>뒤로</button>
            <button disabled={busy || !picked.length} onClick={() => setConfirmAction({ result: 'proposed', fn: () => adminApi.managerPropose(reservationId, info.targetDate!, picked) })} style={{ ...btn(picked.length ? '#F6A623' : '#E5E7EB', '#fff'), flex: 2 }}>{busy ? '제안 중…' : `이 시간들 제안 (${picked.length})`}</button>
          </div>
        </div>
      )}

      {confirmAction && (
        <div onClick={() => !busy && setConfirmAction(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 20 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, padding: '22px 20px', width: '100%', maxWidth: 320, textAlign: 'center' }}>
            <p style={{ fontSize: 15, fontWeight: 600, color: '#222', whiteSpace: 'pre-line', lineHeight: 1.6, margin: '0 0 14px' }}>
              {confirmAction.result === 'confirmed' ? '이 예약을 확정하시겠습니까?'
                : confirmAction.result === 'rejected' ? '이 예약을 거절하시겠습니까?'
                : `다음 시간을 제안하시겠습니까?\n${dot(info.targetDate)} · ${picked.join(', ')}`}
            </p>
            {confirmAction.result === 'rejected' && (
              <textarea value={rejectMsg} onChange={e => setRejectMsg(e.target.value)} rows={3} placeholder="고객에게 보낼 메시지 (선택, 일본어로 번역되어 전달)" style={{ width: '100%', boxSizing: 'border-box', padding: '10px 12px', borderRadius: 8, border: '1px solid #DDD', fontSize: 14, resize: 'vertical', fontFamily: 'inherit', marginBottom: 14, textAlign: 'left' }} />
            )}
            <div style={{ display: 'flex', gap: 10 }}>
              <button disabled={busy} onClick={() => setConfirmAction(null)} style={btn('#fff', '#666', '#DDD')}>취소</button>
              <button disabled={busy} onClick={proceed} style={btn(confirmAction.result === 'rejected' ? '#E53E3E' : '#1D9E75', '#fff')}>예</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// 날짜 범위 선택 — 시작일 클릭 → 종료일 이어서 클릭. 한쪽 비우면 개방형(이전/이후 전체).
function RangeCalendar({ from, to, onChange, dateField, onDateField }: {
  from: string; to: string; onChange: (from: string, to: string) => void
  dateField: 'created' | 'reserved'; onDateField: (f: 'created' | 'reserved') => void
}) {
  const [open, setOpen] = useState(false)
  const base = from || to || new Date().toISOString().slice(0, 10)
  const [ym, setYm] = useState(base.slice(0, 7))
  const [anchor, setAnchor] = useState<string | null>(null)  // 첫 클릭 기준일(범위 확정 대기)
  const [y, m] = ym.split('-').map(Number)
  const startDow = new Date(y, m - 1, 1).getDay()
  const daysInMonth = new Date(y, m, 0).getDate()
  const cells: (string | null)[] = []
  for (let i = 0; i < startDow; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(`${ym}-${String(d).padStart(2, '0')}`)

  const shiftMonth = (delta: number) => {
    const nd = new Date(y, m - 1 + delta, 1)
    setYm(`${nd.getFullYear()}-${String(nd.getMonth() + 1).padStart(2, '0')}`)
  }
  const clickDay = (ds: string) => {
    if (anchor === null) { setAnchor(ds); onChange(ds, ds) }    // 처음 클릭: 시작=종료
    else { ds >= anchor ? onChange(anchor, ds) : onChange(ds, anchor); setAnchor(null) }  // 두번째: 범위 확정
  }
  const fieldLabel = dateField === 'created' ? '접수일' : '예약일'
  const label = (!from && !to) ? '전체 기간' : `${from ? dot(from) : '처음'} ~ ${to ? dot(to) : '끝'}`
  const navBtn: React.CSSProperties = { background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: '#555', padding: '0 8px' }

  return (
    <div style={{ position: 'relative' }}>
      <button onClick={() => setOpen(o => !o)} style={{
        height: 38, boxSizing: 'border-box', display: 'inline-flex', alignItems: 'center',
        padding: '0 12px', borderRadius: 8, border: '1px solid #DDD',
        background: '#fff', fontSize: 14, cursor: 'pointer', color: (from || to) ? '#111' : '#777',
        whiteSpace: 'nowrap', lineHeight: 1,
      }}>
        {/* 보이지 않는 최대 길이 라벨로 폭을 고정 — 선택 상태와 무관하게 너비 불변 */}
        <span style={{ display: 'inline-grid', textAlign: 'left' }}>
          <span style={{ gridArea: '1 / 1', visibility: 'hidden', whiteSpace: 'nowrap' }} aria-hidden>📅 예약일 · 2026.06.01 ~ 2026.06.30</span>
          <span style={{ gridArea: '1 / 1', whiteSpace: 'nowrap' }}>📅 {fieldLabel} · {label}</span>
        </span>
      </button>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 10 }} />
          <div style={{ position: 'absolute', top: '110%', left: 0, zIndex: 11, background: '#fff', border: '1px solid #DDD', borderRadius: 12, padding: 12, boxShadow: '0 8px 24px rgba(0,0,0,0.12)', width: 280 }}>
            <div style={{ display: 'flex', marginBottom: 10, border: '1px solid #E5E7EB', borderRadius: 8, overflow: 'hidden' }}>
              {([['created', '접수일'], ['reserved', '예약일']] as const).map(([k, lbl]) => (
                <button key={k} onClick={() => onDateField(k)} style={{
                  flex: 1, padding: '7px 0', border: 'none', cursor: 'pointer', fontSize: 12.5, fontWeight: 700,
                  background: dateField === k ? '#1D9E75' : '#fff', color: dateField === k ? '#fff' : '#666',
                }}>{lbl}</button>
              ))}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <button onClick={() => shiftMonth(-1)} style={navBtn}>‹</button>
              <b style={{ fontSize: 14 }}>{y}년 {m}월</b>
              <button onClick={() => shiftMonth(1)} style={navBtn}>›</button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 2, marginBottom: 4 }}>
              {['일', '월', '화', '수', '목', '금', '토'].map((d, i) => (
                <div key={i} style={{ textAlign: 'center', fontSize: 11, color: i === 0 ? '#E53E3E' : i === 6 ? '#3B82F6' : '#999' }}>{d}</div>
              ))}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 2 }}>
              {cells.map((ds, i) => {
                if (!ds) return <div key={i} />
                const sel = ds === from || ds === to
                const inR = !!(from && to && ds > from && ds < to)
                return (
                  <button key={i} onClick={() => clickDay(ds)} style={{
                    padding: '6px 0', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 12.5,
                    background: sel ? '#1D9E75' : inR ? '#E1F5EE' : 'transparent',
                    color: sel ? '#fff' : '#333', fontWeight: sel ? 700 : 400,
                  }}>{Number(ds.slice(8))}</button>
                )
              })}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              {([['시작일', from, () => { onChange('', to); setAnchor(null) }],
                 ['종료일', to, () => { onChange(from, ''); setAnchor(null) }]] as const).map(([lbl, val, clear]) => (
                <div key={lbl} style={{ position: 'relative', flex: 1, border: '1px solid #E5E7EB', borderRadius: 8, padding: '7px 10px', background: '#FAFAFA' }}>
                  <div style={{ fontSize: 10.5, color: '#999', marginBottom: 2 }}>{lbl}</div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: val ? '#111' : '#BBB' }}>{val ? dot(val) : '제한 없음'}</div>
                  {val && <span onClick={clear} style={{ position: 'absolute', top: 3, right: 6, fontSize: 12, color: '#999', cursor: 'pointer', fontWeight: 700, lineHeight: 1 }}>✕</span>}
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10 }}>
              <button onClick={() => onChange('', '')} style={{ background: 'none', border: 'none', color: '#888', fontSize: 13, cursor: 'pointer', padding: 0 }}>전체 기간</button>
              <button onClick={() => setOpen(false)} style={{ background: 'none', border: 'none', color: '#1D9E75', fontSize: 13, fontWeight: 700, cursor: 'pointer', padding: 0 }}>닫기</button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function ReservationsView() {
  const [branches, setBranches] = useState<Branch[]>([])
  const [branchId, setBranchId] = useState('')
  const [bookings, setBookings] = useState<Booking[]>([])
  const [tab, setTab] = useState<Tab>('action')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [rejectTarget, setRejectTarget] = useState<string | null>(null)  // 거절 대상(메시지 모달)
  const [rejectMsg, setRejectMsg] = useState('')
  const [query, setQuery] = useState('')      // 이름 검색
  const [from, setFrom] = useState('')         // 날짜 범위 시작 (빈값=제한없음)
  const [to, setTo] = useState('')             // 날짜 범위 종료 (빈값=제한없음)
  const [dateField, setDateField] = useState<'created' | 'reserved'>('created')  // 접수일/예약일 중 무엇으로 검색 (기본=접수일)
  const [sortKey, setSortKey] = useState<'created' | 'reserved'>('created')        // 정렬 기준
  const [sortDir, setSortDir] = useState<'desc' | 'asc'>('desc')                    // 정렬 방향

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
    if (kind === 'reject') { setRejectTarget(reservationId); setRejectMsg(''); return }  // 거절은 메시지 모달로
    if (!confirm('확정하시겠습니까? (고객에게 알림이 갑니다)')) return
    setBusy(reservationId)
    try {
      await adminApi.confirm(reservationId)
      await load()
    } catch (e: any) {
      alert(e?.message || '처리에 실패했습니다')
    } finally {
      setBusy(null)
    }
  }
  const doReject = async () => {
    if (!rejectTarget) return
    setBusy(rejectTarget)
    try {
      await adminApi.reject(rejectTarget, rejectMsg.trim() || undefined)
      setRejectTarget(null)
      await load()
    } catch (e: any) {
      alert(e?.message || '거절 처리에 실패했습니다')
    } finally {
      setBusy(null)
    }
  }

  const matchTab = (b: Booking, key: Tab) => {
    const hasCompanionPending = b.booker.status === 'confirmed' && pendingCompanionBatches(b).length > 0
    if (key === 'action') return isNewPending(b) || isReschedulePending(b) || isClinicProposed(b) || hasCompanionPending
    if (key === 'pending') return isNewPending(b) || hasCompanionPending
    if (key === 'reschedule') return isReschedulePending(b)
    if (key === 'proposed') return isClinicProposed(b)
    if (key === 'all') return true
    return b.booker.status === key  // confirmed / rejected / cancelled
  }
  // 이름(LINE 프로필명·로마자·한국식) 검색 — 예약자/동반자 전원 대상
  const matchName = (b: Booking) => {
    const needle = query.trim().toLowerCase()
    if (!needle) return true
    const hay = [b.booker, ...b.companions]
      .flatMap(p => [p.displayName, p.name, p.nameKo]).join(' ').toLowerCase()
    return hay.includes(needle)
  }
  // 날짜 범위 — 선택한 기준일(접수일/예약일)이 [from, to] 안이면 일치. 한쪽 빈값=개방형.
  const matchDate = (b: Booking) => {
    if (!from && !to) return true
    const d = (dateField === 'created' ? b.createdAt : b.date)
    if (!d) return false
    const day = d.slice(0, 10)
    if (from && day < from) return false
    if (to && day > to) return false
    return true
  }
  const filtered = bookings.filter(b => matchTab(b, tab) && matchName(b) && matchDate(b))
  // 정렬: 접수일(createdAt) 또는 예약일(date+time), 오름/내림
  const sortVal = (b: Booking) => sortKey === 'created' ? (b.createdAt || '') : `${b.date} ${b.time}`
  const sorted = [...filtered].sort((a, b) => {
    const va = sortVal(a), vb = sortVal(b)
    const c = va < vb ? -1 : va > vb ? 1 : 0
    return sortDir === 'asc' ? c : -c
  })

  return (
    <div>
      {/* 1줄: 병원 · 날짜 범위 · 이름 검색 · 새로고침 */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', margin: '16px 0 12px' }}>
        <select value={branchId} onChange={e => setBranchId(e.target.value)} style={{ height: 38, boxSizing: 'border-box', padding: '0 12px', borderRadius: 8, border: '1px solid #DDD', fontSize: 14 }}>
          <option value="">전체 병원</option>
          {branches.map(b => <option key={b.branchId} value={b.branchId}>{b.name}</option>)}
        </select>
        <RangeCalendar from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t) }} dateField={dateField} onDateField={setDateField} />
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="이름 검색 (LINE·로마자·한국식)"
          style={{ flex: '1 1 200px', minWidth: 160, height: 38, boxSizing: 'border-box', padding: '0 12px', borderRadius: 8, border: '1px solid #DDD', fontSize: 14 }}
        />
        <button onClick={() => load()} title="새로고침" style={{ height: 38, boxSizing: 'border-box', padding: '0 12px', borderRadius: 8, border: '1px solid #DDD', background: '#fff', fontSize: 15, cursor: 'pointer' }}>↻</button>
      </div>
      {/* 2줄: 상태 탭 + 정렬 (한 줄) */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {TABS.map(t => {
            const count = bookings.filter(b => matchTab(b, t.key)).length
            const active = tab === t.key
            const c = TAB_COLOR[t.key]
            const actionActive = t.key === 'action' && active   // 처리 대기 활성: 테두리 없이 흰 글씨
            return (
              <button key={t.key} onClick={() => setTab(t.key)} style={{
                padding: '8px 14px', borderRadius: 999,
                border: actionActive ? 'none' : `1.5px solid ${active ? c.fg : '#E5E7EB'}`,
                background: active ? c.bg : 'transparent', color: active ? c.fg : '#333',
                fontSize: 13, fontWeight: active ? 700 : 600, cursor: 'pointer',
              }}>
                {t.label} {count > 0 && <span style={{ opacity: 0.75 }}>({count})</span>}
              </button>
            )
          })}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12.5, color: '#888' }}>정렬</span>
          <select value={sortKey} onChange={e => setSortKey(e.target.value as 'created' | 'reserved')} style={{ height: 34, boxSizing: 'border-box', padding: '0 10px', borderRadius: 8, border: '1px solid #DDD', fontSize: 13 }}>
            <option value="created">접수일</option>
            <option value="reserved">예약일</option>
          </select>
          <button onClick={() => setSortDir(d => d === 'asc' ? 'desc' : 'asc')} style={{ height: 34, boxSizing: 'border-box', padding: '0 12px', borderRadius: 8, border: '1px solid #DDD', background: '#fff', fontSize: 13, cursor: 'pointer' }}>
            {sortDir === 'desc' ? '내림차순 ↓' : '오름차순 ↑'}
          </button>
        </div>
      </div>

      {loading ? (
        <Center small>불러오는 중…</Center>
      ) : filtered.length === 0 ? (
        <p style={{ textAlign: 'center', color: '#999', padding: '40px 0', fontSize: 14 }}>해당 예약이 없습니다.</p>
      ) : (
        <div>
          {/* 컬럼 헤더 */}
          <div style={{ display: 'grid', gridTemplateColumns: RES_GRID, gap: '0 12px', padding: '6px 17px 10px', borderBottom: '1px solid #E5E7EB' }}>
            {RES_HEADERS.map((h, i) => <div key={h} style={{ ...headCell, textAlign: RES_ALIGN[i] }}>{h}</div>)}
          </div>
          {/* 카드 목록 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 10 }}>
            {sorted.map(b => <BookingRows key={b.groupId} b={b} busy={busy} act={act} reload={() => load(true)} />)}
          </div>
        </div>
      )}

      {rejectTarget && (
        <div onClick={() => { if (!busy) setRejectTarget(null) }} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 20 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, padding: 20, width: '100%', maxWidth: 380, fontFamily: 'system-ui, sans-serif' }}>
            <h3 style={{ margin: '0 0 6px', fontSize: 16 }}>예약 거절</h3>
            <p style={{ margin: '0 0 12px', fontSize: 13, color: '#888', lineHeight: 1.6 }}>고객에게 거절 알림이 발송됩니다. 아래 메시지를 적으면 알림 뒤에 함께 보냅니다(일본어로 번역되어 전달).</p>
            <textarea value={rejectMsg} onChange={e => setRejectMsg(e.target.value)} rows={4} placeholder="고객에게 보낼 메시지 (선택)" style={{ width: '100%', boxSizing: 'border-box', padding: '10px 12px', borderRadius: 8, border: '1px solid #DDD', fontSize: 14, resize: 'vertical', fontFamily: 'inherit' }} />
            <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
              <button disabled={!!busy} onClick={() => setRejectTarget(null)} style={{ flex: 1, padding: '11px', borderRadius: 8, border: '1px solid #DDD', background: '#fff', color: '#666', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>취소</button>
              <button disabled={!!busy} onClick={doReject} style={{ flex: 1, padding: '11px', borderRadius: 8, border: 'none', background: '#E53E3E', color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer', opacity: busy ? 0.6 : 1 }}>{busy ? '처리 중…' : '거절하기'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const genderKo = (g?: string | null) => (g === 'male' ? '남성' : g === 'female' ? '여성' : (g || '-'))
const kStyle: React.CSSProperties = { color: '#999', fontSize: 11.5, marginRight: 4 }

// 예약 "표처럼 보이는 카드" 레이아웃 — 헤더와 카드가 같은 그리드 컬럼을 공유
const RES_HEADERS = ['예약 일시', '병원', '예약자', '생년월일', '성별', '구분', '희망 시술', '희망 예산', '시술이력', '상태', '접수일자']
const RES_GRID = '128px 92px minmax(110px,1.3fr) 104px 52px 62px minmax(120px,1.3fr) 100px minmax(96px,1fr) 96px 96px'
// 자유 텍스트(희망시술/희망예산/시술이력)만 좌측, 나머지는 중앙 정렬
const RES_ALIGN: Array<React.CSSProperties['textAlign']> = ['center', 'center', 'center', 'center', 'center', 'center', 'left', 'left', 'left', 'center', 'center']
const headCell: React.CSSProperties = { fontSize: 12, fontWeight: 700, color: '#888', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }
const cellBase: React.CSSProperties = { fontSize: 13, color: '#333', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }
// 카드 안 액션 줄(중첩 카드 X, 카드 폭에 꽉 찬 색 줄)
const actionBar = (bg: string): React.CSSProperties => ({ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px', background: bg, borderTop: '1px solid #EEE' })
const confirmBtn: React.CSSProperties = { padding: '7px 14px', borderRadius: 8, border: 'none', background: '#1D9E75', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer' }
const rejectBtn: React.CSSProperties = { padding: '7px 14px', borderRadius: 8, border: '1px solid #E53E3E', background: '#fff', color: '#E53E3E', fontSize: 13, fontWeight: 700, cursor: 'pointer' }
const proposeBtn: React.CSSProperties = { padding: '7px 12px', borderRadius: 8, border: '1px dashed #F6A623', background: '#fff', color: '#B45309', fontSize: 13, fontWeight: 600, cursor: 'pointer' }
function VisitPill({ v }: { v: string }) {
  const isFirst = v === 'first'
  return <span style={{
    fontSize: 11.5, fontWeight: 700, padding: '2px 9px', borderRadius: 999, border: '1px solid', whiteSpace: 'nowrap',
    ...(isFirst ? { color: '#1D4ED8', background: '#EFF6FF', borderColor: '#BFDBFE' } : { color: '#9333EA', background: '#FAF5FF', borderColor: '#E9D5FF' }),
  }}>{visitKo(v)}</span>
}

function PersonDetail({ label, p, showStatus, displayStatus }: { label: string; p: Person; showStatus?: boolean; displayStatus?: string }) {
  const [more, setMore] = useState(false)
  const st = displayStatus ?? p.status
  const sc = STATUS_COLOR[st] ?? STATUS_COLOR.pending
  const moreBtn: React.CSSProperties = { background: 'none', border: 'none', color: '#1D9E75', fontSize: 12, fontWeight: 600, cursor: 'pointer', padding: 0, flexShrink: 0, whiteSpace: 'nowrap' }
  const isFirst = p.visitType === 'first'
  const visitPill: React.CSSProperties = {
    fontSize: 11.5, fontWeight: 700, padding: '2px 11px', borderRadius: 999, border: '1px solid', flexShrink: 0,
    ...(isFirst
      ? { color: '#1D4ED8', background: '#EFF6FF', borderColor: '#BFDBFE' }    // 초진
      : { color: '#9333EA', background: '#FAF5FF', borderColor: '#E9D5FF' }),  // 재진
  }
  return (
    <div style={{ border: '1px solid #EFEFEF', borderLeft: `5px solid ${sc.border}`, borderRadius: 10, padding: '10px 12px', marginTop: 8, background: '#FCFCFC', display: 'flex', flexDirection: 'column', gap: 6 }}>
      {/* 1줄: 이름 · 생년월일 · 성별  +  상태 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
        <div style={{ fontSize: 13, color: '#555', lineHeight: 1.5 }}>
          <span style={{ fontSize: 11, color: '#777', background: '#EEE', borderRadius: 6, padding: '1px 6px', marginRight: 6 }}>{label}</span>
          <b style={{ fontSize: 14, color: '#111' }}>{p.nameKo || p.name}</b>
          {p.nameKo && p.name && <span style={{ color: '#aaa', fontSize: 12 }}>({p.name})</span>}
          {' · '}{p.birthDate || '-'}{' · '}{genderKo(p.gender)}
        </div>
        {showStatus && <StatusBadge status={st} />}
      </div>

      {/* 2줄: 초진/재진(동그라미) + 희망시술  +  더보기(오른쪽 끝) */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: 1 }}>
          <span style={visitPill}>{visitKo(p.visitType)}</span>
          <span style={{ fontSize: 13, color: '#333', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            <span style={kStyle}>희망시술</span>{p.treatmentRequest || '-'}
          </span>
        </div>
        <button onClick={() => setMore(v => !v)} style={moreBtn}>{more ? '접기 ▴' : '더보기 ▾'}</button>
      </div>

      {/* 더보기: 희망예산 · 시술이력 */}
      {more && (
        <div style={{ borderTop: '1px dashed #EEE', paddingTop: 6, display: 'flex', flexDirection: 'column', gap: 3 }}>
          <div style={{ fontSize: 13, color: '#333' }}><span style={kStyle}>희망예산</span>{p.budget || '-'}</div>
          <div style={{ fontSize: 13, color: '#333' }}><span style={kStyle}>시술이력</span>{p.surgeryHistory || '-'}</div>
        </div>
      )}
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const c = STATUS_COLOR[status] ?? STATUS_COLOR.pending
  return <span style={{ padding: '3px 10px', borderRadius: 10, background: c.bg, color: c.fg, fontSize: 12, fontWeight: 700 }}>{STATUS_KO[status] ?? status}</span>
}

function BookingRows({ b, busy, act, reload }: { b: Booking; busy: string | null; act: (k: 'confirm' | 'reject', id: string) => void; reload: () => void }) {
  const compBatches = pendingCompanionBatches(b)
  const [proposing, setProposing] = useState(false)
  const [slots, setSlots] = useState<{ time: string; available: boolean }[]>([])
  const [picked, setPicked] = useState<string[]>([])
  const [pBusy, setPBusy] = useState(false)
  const targetDate = isReschedulePending(b) ? (b.requestedDate || b.date) : b.date

  useEffect(() => {
    if (!proposing) return
    adminApi.getSlots(b.branchId, targetDate).then(setSlots).catch(() => setSlots([]))
  }, [proposing])

  const toggle = (t: string) => setPicked(prev => prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t])
  const submitPropose = async () => {
    if (!picked.length) { alert('제안할 시간을 1개 이상 선택하세요'); return }
    setPBusy(true)
    try { await adminApi.propose(b.booker.id, targetDate, picked); setProposing(false); setPicked([]); reload() }
    catch (e: any) { alert(e?.message || '제안 실패') }
    finally { setPBusy(false) }
  }

  const disabled = busy === b.booker.id
  const cell = (v: React.ReactNode, extra?: React.CSSProperties) => <div style={{ ...cellBase, ...extra }}>{v}</div>

  // 한 사람(예약자/동반자)을 그리드 한 줄로 — 헤더와 컬럼 정렬 일치
  const personRow = (p: Person, isComp: boolean, idx = 0) => (
    <div key={p.id} style={{ display: 'grid', gridTemplateColumns: RES_GRID, gap: '0 12px', alignItems: 'center', padding: '12px 16px', ...(isComp ? { background: '#FBFBFB', borderTop: '1px solid #F2F2F2' } : {}) }}>
      {cell(isComp ? <span style={{ color: '#888', fontWeight: 700, fontSize: 12 }}>동반자 {idx + 1}</span> : <b>{dot(b.date)} {b.time}</b>, { textAlign: 'center' })}
      {cell(isComp ? '' : b.branchName, { color: '#555', textAlign: 'center' })}
      {cell(<span><b style={{ color: isComp ? '#222' : '#111' }}>{p.nameKo || p.name}</b> {p.nameKo && p.name && <span style={{ color: '#aaa', fontSize: 12 }}>({p.name})</span>}</span>, { textAlign: 'center' })}
      {cell(p.birthDate || '-', { color: '#555', textAlign: 'center' })}
      {cell(genderKo(p.gender), { color: '#555', textAlign: 'center' })}
      {cell(<VisitPill v={p.visitType} />, { overflow: 'visible', textAlign: 'center' })}
      {cell(p.treatmentRequest || '-', { whiteSpace: 'normal' })}
      {cell(p.budget || '-', { color: '#555', whiteSpace: 'normal' })}
      {cell(p.surgeryHistory || '-', { color: '#555', whiteSpace: 'normal' })}
      {cell(<StatusBadge status={isComp ? p.status : bookerDisplayStatus(b)} />, { overflow: 'visible', textAlign: 'center' })}
      {cell(isComp ? '' : dot((b.createdAt || '').slice(0, 10)), { color: '#888', textAlign: 'center' })}
    </div>
  )

  return (
    <div style={{ background: '#fff', border: '1px solid #EAEAEA', borderRadius: 12, overflow: 'hidden' }}>
      {personRow(b.booker, false)}
      {b.companions.map((c, i) => personRow(c, true, i))}

      {/* 병원이 제안함 — 고객 응답 대기 */}
      {isClinicProposed(b) && (
        <div style={actionBar('#FFF7ED')}>
          <span style={{ flex: 1, fontSize: 13, fontWeight: 700, color: '#9A3412' }}>🕒 시간 제안함 · 고객 응답 대기 → {dot(b.requestedDate)} ({b.proposedTimes.join(', ')})</span>
          <button disabled={disabled} onClick={() => act('reject', b.booker.id)} style={rejectBtn}>제안 취소(거절)</button>
        </div>
      )}

      {/* 신규 예약 / 시간변경 요청 — 확정 / 거절 / 다른 시간 제안 */}
      {(isReschedulePending(b) || isNewPending(b)) && (
        <>
          <div style={actionBar(isReschedulePending(b) ? '#EFF6FF' : '#FFFBEB')}>
            <span style={{ flex: 1, fontSize: 13, fontWeight: 700, color: isReschedulePending(b) ? '#1E40AF' : '#92400E' }}>{isReschedulePending(b) ? `🔁 일시변경 요청 → ${dot(b.requestedDate)} ${b.requestedTime}` : '🆕 신규 예약 승인 대기'}</span>
            {!proposing ? (
              <>
                <button disabled={disabled} onClick={() => act('confirm', b.booker.id)} style={confirmBtn}>확정</button>
                <button disabled={disabled} onClick={() => act('reject', b.booker.id)} style={rejectBtn}>거절</button>
                <button onClick={() => setProposing(true)} style={proposeBtn}>🕒 다른 시간 제안</button>
              </>
            ) : (
              <>
                <button disabled={pBusy} onClick={submitPropose} style={{ padding: '7px 14px', borderRadius: 8, border: 'none', background: '#F6A623', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer', opacity: pBusy ? 0.5 : 1, whiteSpace: 'nowrap' }}>{pBusy ? '제안 중…' : `이 시간들 제안 (${picked.length})`}</button>
                <button disabled={pBusy} onClick={() => { setProposing(false); setPicked([]) }} style={{ padding: '7px 14px', borderRadius: 8, border: '1px solid #DDD', background: '#fff', color: '#666', fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap' }}>취소</button>
              </>
            )}
          </div>
          {proposing && (
            <div style={{ ...actionBar('#FFF7ED'), flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: '#9A3412' }}>{dot(targetDate)} · 제안할 시간 선택 (여러 개)</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {slots.length === 0 && <span style={{ fontSize: 12.5, color: '#999' }}>가능한 시간이 없습니다.</span>}
                {slots.map(s => {
                  const on = picked.includes(s.time)
                  const isOrig = targetDate === b.date && s.time === b.time   // 원래 접수받은 시간
                  const dis = !s.available || isOrig
                  return (
                    <button key={s.time} disabled={dis} onClick={() => !dis && toggle(s.time)} style={{
                      padding: '7px 12px', borderRadius: 999, fontSize: 13, fontWeight: 600,
                      cursor: dis ? 'not-allowed' : 'pointer',
                      border: `1.5px solid ${on ? '#1D9E75' : dis ? '#EEE' : '#DDD'}`,
                      background: on ? '#1D9E75' : dis ? '#F3F4F6' : '#fff',
                      color: on ? '#fff' : dis ? '#BBB' : '#555',
                    }}>{s.time}</button>
                  )
                })}
              </div>
            </div>
          )}
        </>
      )}

      {/* 동반자 추가 승인 (예약 확정 상태에서만) */}
      {b.booker.status === 'confirmed' && compBatches.map((batch, i) => (
        <div key={i} style={actionBar('#ECFDF5')}>
          <span style={{ flex: 1, fontSize: 13, fontWeight: 700, color: '#065F46' }}>➕ 동반자 추가 승인 대기: {batch.map(c => c.nameKo || c.name).join(', ')}</span>
          <button disabled={busy === batch[0].id} onClick={() => act('confirm', batch[0].id)} style={confirmBtn}>확정</button>
          <button disabled={busy === batch[0].id} onClick={() => act('reject', batch[0].id)} style={rejectBtn}>거절</button>
        </div>
      ))}
    </div>
  )
}

// ── 병원 관리 ─────────────────────────────────────────────────
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토']
const emptyBranch = (): AdminBranch => ({
  branchId: '', name: '', nameJa: '', address: '', addressJa: '',
  openTime: '', closeTime: '', lunchStart: '', lunchEnd: '',
  closedDays: [], noLunchDays: [], holidayDates: [], closeBufferMin: 90, lunchBufferMin: 90, blockedSlots: [],
  lineNotifyId: '', channelAccessToken: '',
})
// 폼 값으로 특정 날짜의 시간 슬롯 계산 (백엔드 computeSlots와 동일 규칙)
const toMinC = (t?: string) => { if (!t) return null; const [h, m] = t.split(':').map(Number); return h * 60 + m }
const minToHHMMc = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`
function computeSlotsClient(b: AdminBranch, date: string): string[] {
  const dow = new Date(date + 'T00:00:00Z').getUTCDay()
  if (b.closedDays.includes(dow)) return []
  const open = toMinC(b.openTime), close = toMinC(b.closeTime)
  if (open == null || close == null) return []
  const closeBuf = b.closeBufferMin ?? 90, lunchBuf = b.lunchBufferMin ?? 90
  const ls = toMinC(b.lunchStart), le = toMinC(b.lunchEnd)
  const noLunch = b.noLunchDays.includes(dow)
  const times: string[] = []
  const add = (from: number, to: number) => { for (let t = from; t <= to; t += 30) times.push(minToHHMMc(t)) }
  if (ls != null && le != null && !noLunch) { add(open, ls - lunchBuf); add(le, close - closeBuf) }
  else add(open, close - closeBuf)
  return times
}
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
  const [selected, setSelected] = useState<AdminBranch | null>(null)        // 상세(보기)
  const [editing, setEditing] = useState<{ b: AdminBranch; isNew: boolean } | null>(null)  // 수정/생성

  const load = () => { setLoading(true); adminApi.getAdminBranches().then(setList).catch((e: any) => alert(e?.message)).finally(() => setLoading(false)) }
  useEffect(() => { load() }, [])

  if (editing) return <BranchForm init={editing.b} isNew={editing.isNew}
    onClose={() => setEditing(null)} onSaved={(saved) => { setEditing(null); setSelected(saved); load() }} />
  if (selected) return <BranchDetail b={selected} onBack={() => setSelected(null)} onEdit={() => setEditing({ b: selected, isNew: false })} onChanged={(nb) => { setSelected(nb); load() }} />
  if (loading) return <Center small>불러오는 중…</Center>
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '16px 0' }}>
        <h2 style={{ fontSize: 16, margin: 0 }}>병원 ({list.length})</h2>
        <button onClick={() => setEditing({ b: emptyBranch(), isNew: true })} style={primaryBtn}>+ 새 병원</button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {list.map(b => (
          <button key={b.branchId} onClick={() => setSelected(b)} style={listRow}>
            <div style={{ fontSize: 15, fontWeight: 700 }}>{b.name} <span style={{ color: '#aaa', fontSize: 12, fontWeight: 400 }}>{b.nameJa}</span></div>
            <div style={{ fontSize: 12.5, color: '#888', marginTop: 3 }}>ID {b.branchId} · 영업 {b.openTime || '-'}~{b.closeTime || '-'} · 점심 {b.lunchStart || '-'}~{b.lunchEnd || '-'}</div>
          </button>
        ))}
        {list.length === 0 && <p style={{ color: '#999', fontSize: 14 }}>병원이 없습니다.</p>}
      </div>
    </div>
  )
}

function BranchDetail({ b, onBack, onEdit, onChanged }: { b: AdminBranch; onBack: () => void; onEdit: () => void; onChanged: (b: AdminBranch) => void }) {
  const [copied, setCopied] = useState(false)
  const [holidays, setHolidays] = useState<Map<string, string>>(new Map())
  // 일정(휴무 요일/점심 없는 요일/휴무일/마감시간)은 상세에서 바로 편집
  const [sched, setSched] = useState({ closedDays: b.closedDays, noLunchDays: b.noLunchDays, holidayDates: b.holidayDates, blockedSlots: b.blockedSlots })
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  useEffect(() => { adminApi.getHolidays().then(h => setHolidays(new Map(h.map(x => [x.date, x.name])))).catch(() => {}) }, [])

  const url = `https://liff.line.me/${LIFF_ID}?branch=${b.branchId}`
  const copy = async () => {
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1500) }
    catch { prompt('URL 복사', url) }
  }
  const bCal = { ...b, ...sched }   // 캘린더 슬롯 계산 + 표시용
  const toggleDay = (key: 'closedDays' | 'noLunchDays', d: number) => { setSched(p => ({ ...p, [key]: p[key].includes(d) ? p[key].filter(x => x !== d) : [...p[key], d] })); setDirty(true) }
  const toggleHoliday = (date: string) => { setSched(p => ({ ...p, holidayDates: p.holidayDates.includes(date) ? p.holidayDates.filter(x => x !== date) : [...p.holidayDates, date] })); setDirty(true) }
  const toggleBlocked = (date: string, time: string) => { const key = `${date} ${time}`; setSched(p => ({ ...p, blockedSlots: p.blockedSlots.includes(key) ? p.blockedSlots.filter(x => x !== key) : [...p.blockedSlots, key] })); setDirty(true) }
  const saveSched = async () => {
    setBusy(true)
    try { const merged = { ...b, ...sched }; await adminApi.saveBranch(merged); setDirty(false); onChanged(merged) }
    catch (e: any) { alert(e?.message || '저장 실패') } finally { setBusy(false) }
  }

  return (
    <div style={{ margin: '16px 0' }}>
      <button onClick={onBack} style={ghostBtn}>← 목록</button>
      <div style={{ margin: '10px 0 16px' }}>
        <h2 style={{ fontSize: 20, margin: 0 }}>{b.name}</h2>
        <div style={{ color: '#888', fontSize: 13, marginTop: 2 }}>{b.nameJa}</div>
      </div>

      <div style={cardStyle}>
        <div style={sectionTitle}>📱 예약 앱 URL</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input readOnly value={url} onFocus={e => e.currentTarget.select()} style={{ ...inputStyle, flex: 1, color: '#555' }} />
          <button onClick={copy} style={{ ...primaryBtn, whiteSpace: 'nowrap', background: copied ? '#888' : '#1D9E75' }}>{copied ? '복사됨 ✓' : '복사'}</button>
        </div>
      </div>

      <div style={cardStyle}>
        <div style={{ ...sectionTitle, display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <span>기본 정보</span>
          <button onClick={onEdit} style={{ padding: '6px 14px', borderRadius: 8, border: '1px solid #1D9E75', background: '#fff', color: '#1D9E75', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>수정</button>
        </div>
        <Row k="병원 ID" v={b.branchId} />
        <Row k="주소 (한국어)" v={b.address} />
        <Row k="주소 (일본어)" v={b.addressJa} />
        <Row k="영업시간" v={`${b.openTime || '-'} ~ ${b.closeTime || '-'}`} />
        <Row k="점심시간" v={b.lunchStart ? `${b.lunchStart} ~ ${b.lunchEnd || '-'}` : '없음'} />
        <Row k="예약 마감 버퍼" v={`마감 ${b.closeBufferMin ?? 90}분 · 점심 ${b.lunchBufferMin ?? 90}분 전까지`} />
      </div>

      <div style={cardStyle}>
        <div style={{ ...sectionTitle, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>휴무 / 마감 시간 설정</span>
          <button disabled={!dirty || busy} onClick={saveSched} style={{ padding: '6px 14px', borderRadius: 8, border: 'none', fontSize: 13, fontWeight: 700, cursor: dirty ? 'pointer' : 'default', background: dirty ? '#1D9E75' : '#E5E7EB', color: '#fff' }}>{busy ? '저장 중…' : '저장'}</button>
        </div>
        <Lbl>휴무 요일</Lbl><DayRow value={sched.closedDays} onToggle={d => toggleDay('closedDays', d)} />
        <Lbl>점심 없는 요일</Lbl><DayRow value={sched.noLunchDays} onToggle={d => toggleDay('noLunchDays', d)} />
        <Lbl>휴무일 / 마감 시간 (캘린더)</Lbl>
        <BranchCalendar b={bCal} holidays={holidays} onToggleHoliday={toggleHoliday} onToggleBlocked={toggleBlocked} />
      </div>
    </div>
  )
}

function Row({ k, v }: { k: string; v?: string | null }) {
  return (
    <div style={{ display: 'flex', padding: '7px 0', fontSize: 13.5, borderBottom: '1px solid #F5F5F5' }}>
      <span style={{ width: 120, color: '#999', flexShrink: 0 }}>{k}</span>
      <span style={{ color: '#222', wordBreak: 'break-all' }}>{v || '-'}</span>
    </div>
  )
}

const navBtnB: React.CSSProperties = { background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: '#555', padding: '0 8px' }
function DayRow({ value, onToggle }: { value: number[]; onToggle: (d: number) => void }) {
  return (
    <div style={{ display: 'flex', gap: 6 }}>
      {WEEKDAYS.map((w, d) => {
        const on = value.includes(d)
        return <button type="button" key={d} onClick={() => onToggle(d)} style={{ flex: 1, minWidth: 0, height: 38, borderRadius: 8, cursor: 'pointer', border: `1.5px solid ${on ? '#1D9E75' : '#DDD'}`, background: on ? '#1D9E75' : '#fff', color: on ? '#fff' : '#666', fontSize: 13, fontWeight: 600 }}>{w}</button>
      })}
    </div>
  )
}
// 휴무일(전체) + 마감 시간(개별)을 캘린더로 설정. 공휴일은 표시만(자동 휴무 X).
function BranchCalendar({ b, holidays, onToggleHoliday, onToggleBlocked }: {
  b: AdminBranch
  holidays: Map<string, string>
  onToggleHoliday: (date: string) => void
  onToggleBlocked: (date: string, time: string) => void
}) {
  const [ym, setYm] = useState(new Date().toISOString().slice(0, 7))
  const [sel, setSel] = useState<string | null>(null)
  const [y, m] = ym.split('-').map(Number)
  const startDow = new Date(y, m - 1, 1).getDay()
  const daysInMonth = new Date(y, m, 0).getDate()
  const cells: (string | null)[] = []
  for (let i = 0; i < startDow; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(`${ym}-${String(d).padStart(2, '0')}`)
  const shift = (delta: number) => { const nd = new Date(y, m - 1 + delta, 1); setYm(`${nd.getFullYear()}-${String(nd.getMonth() + 1).padStart(2, '0')}`) }
  const closedSet = new Set(b.holidayDates)
  const todayStr = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10)  // KST/JST 오늘
  const selSlots = sel ? computeSlotsClient(b, sel) : []

  return (
    <div style={{ border: '1px solid #E5E7EB', borderRadius: 12, padding: 12, marginTop: 4 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <button type="button" onClick={() => shift(-1)} style={navBtnB}>‹</button>
        <b style={{ fontSize: 14 }}>{y}년 {m}월</b>
        <button type="button" onClick={() => shift(1)} style={navBtnB}>›</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 2, marginBottom: 4 }}>
        {['일', '월', '화', '수', '목', '금', '토'].map((d, i) => <div key={i} style={{ textAlign: 'center', fontSize: 11, color: i === 0 ? '#E53E3E' : i === 6 ? '#3B82F6' : '#999' }}>{d}</div>)}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 2 }}>
        {cells.map((ds, i) => {
          if (!ds) return <div key={i} />
          const closed = closedSet.has(ds)
          const holName = holidays.get(ds)
          const hasBlocked = b.blockedSlots.some(s => s.startsWith(ds + ' '))
          const selected = sel === ds
          const isToday = ds === todayStr
          return (
            <button type="button" key={i} onClick={() => setSel(ds)} style={{
              position: 'relative', minHeight: 46, borderRadius: 8, cursor: 'pointer', fontSize: 12.5,
              border: `1.5px solid ${selected ? '#111' : isToday ? '#1D9E75' : 'transparent'}`,
              background: closed ? '#FEE2E2' : 'transparent',
              color: closed ? '#B91C1C' : holName ? '#E53E3E' : '#333', fontWeight: closed ? 700 : 400,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <span>{Number(ds.slice(8))}</span>
              {holName && <span style={{ position: 'absolute', bottom: 2, left: 0, right: 0, textAlign: 'center', fontSize: 8.5, lineHeight: 1, color: '#E53E3E', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', padding: '0 2px' }}>{holName}</span>}
              {hasBlocked && !closed && <span style={{ position: 'absolute', top: 4, right: 4, width: 5, height: 5, borderRadius: 999, background: '#F6A623' }} />}
            </button>
          )
        })}
      </div>
      <div style={{ fontSize: 11, color: '#999', marginTop: 6 }}><span style={{ color: '#E53E3E' }}>빨강</span> 공휴일(표시만) &nbsp; <span style={{ color: '#F6A623' }}>●</span> 일부 시간 마감 &nbsp; <span style={{ background: '#FEE2E2', color: '#B91C1C', padding: '0 4px', borderRadius: 4 }}>휴무</span></div>

      {sel && (
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid #EEE' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <b style={{ fontSize: 13.5 }}>{sel.replace(/-/g, '.')}{holidays.get(sel) && <span style={{ color: '#E53E3E', fontSize: 12, marginLeft: 6 }}>{holidays.get(sel)}</span>}</b>
            <button type="button" onClick={() => onToggleHoliday(sel)} style={{ padding: '6px 12px', borderRadius: 8, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', border: `1.5px solid ${closedSet.has(sel) ? '#E53E3E' : '#DDD'}`, background: closedSet.has(sel) ? '#E53E3E' : '#fff', color: closedSet.has(sel) ? '#fff' : '#666' }}>
              {closedSet.has(sel) ? '휴무 해제' : '이 날 휴무'}
            </button>
          </div>
          {closedSet.has(sel) ? (
            <p style={{ fontSize: 12.5, color: '#B91C1C', margin: 0 }}>이 날은 전체 휴무입니다.</p>
          ) : selSlots.length === 0 ? (
            <p style={{ fontSize: 12.5, color: '#999', margin: 0 }}>영업시간을 설정하면 시간이 표시됩니다.</p>
          ) : (
            <>
              <div style={{ fontSize: 12, color: '#888', marginBottom: 6 }}>마감할 시간을 선택하세요 (회색 = 마감)</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {selSlots.map(t => {
                  const blocked = b.blockedSlots.includes(`${sel} ${t}`)
                  return <button type="button" key={t} onClick={() => onToggleBlocked(sel, t)} style={{ padding: '7px 12px', borderRadius: 999, fontSize: 13, fontWeight: 600, cursor: 'pointer', border: `1.5px solid ${blocked ? '#DDD' : '#1D9E75'}`, background: blocked ? '#F3F4F6' : '#fff', color: blocked ? '#BBB' : '#1D9E75', textDecoration: blocked ? 'line-through' : 'none' }}>{t}</button>
                })}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function BranchForm({ init, isNew, onClose, onSaved }: { init: AdminBranch; isNew: boolean; onClose: () => void; onSaved: (saved: AdminBranch | null) => void }) {
  const [b, setB] = useState<AdminBranch>(init)
  const [busy, setBusy] = useState(false)
  const set = (k: keyof AdminBranch, v: any) => setB(prev => ({ ...prev, [k]: v }))

  const save = async () => {
    if (!b.branchId.trim()) { alert('병원 ID를 입력하세요'); return }
    setBusy(true)
    try {
      await adminApi.saveBranch(b)
      onSaved(b)
    } catch (e: any) { alert(e?.message || '저장 실패') } finally { setBusy(false) }
  }
  const del = async () => {
    if (!confirm('이 병원을 삭제하시겠습니까?')) return
    setBusy(true)
    try { await adminApi.deleteBranch(b.branchId); onSaved(null) } catch (e: any) { alert(e?.message || '삭제 실패') } finally { setBusy(false) }
  }

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
        <div style={{ flex: 0.8 }}><Lbl>마감 버퍼(분)</Lbl><Txt type="number" value={String(b.closeBufferMin)} onChange={v => set('closeBufferMin', Number(v) || 0)} placeholder="90" /></div>
      </div>
      <div style={{ display: 'flex', gap: 10 }}>
        <div style={{ flex: 1 }}><Lbl>점심 시작</Lbl><Txt type="time" value={b.lunchStart} onChange={v => set('lunchStart', v)} /></div>
        <div style={{ flex: 1 }}><Lbl>점심 종료</Lbl><Txt type="time" value={b.lunchEnd} onChange={v => set('lunchEnd', v)} /></div>
        <div style={{ flex: 0.8 }}><Lbl>점심 버퍼(분)</Lbl><Txt type="number" value={String(b.lunchBufferMin)} onChange={v => set('lunchBufferMin', Number(v) || 0)} placeholder="90" /></div>
      </div>
      <div style={{ fontSize: 11.5, color: '#888', marginTop: 4 }}>마감 {b.closeBufferMin || 0}분 · 점심 시작 {b.lunchBufferMin || 0}분 전까지 예약 가능 (기본 90 = 1시간 30분)</div>
      <div style={{ fontSize: 11.5, color: '#1D9E75', marginTop: 10 }}>※ 휴무 요일·휴무일·마감 시간은 병원 상세 페이지에서 바로 설정할 수 있습니다.</div>
      <Lbl>매니저 LINE ID <span style={{ fontWeight: 400, color: '#1D9E75', fontSize: 11.5, marginLeft: 6 }}>예약 알림을 받을 LINE userId</span></Lbl>
      <Txt value={b.lineNotifyId} onChange={v => set('lineNotifyId', v)} />
      <Lbl>채널 액세스 토큰 <span style={{ fontWeight: 400, color: '#1D9E75', fontSize: 11.5, marginLeft: 6 }}>이 병원 LINE 공식계정의 Messaging API 토큰</span></Lbl>
      <Txt value={b.channelAccessToken} onChange={v => set('channelAccessToken', v)} placeholder="비우면 전역 토큰 사용" />

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
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => { adminApi.getCustomers().then(setList).catch((e: any) => alert(e?.message)).finally(() => setLoading(false)) }, [])
  const open = async (c: Customer) => {
    setSel(c); setResv(null); setEditing(false)
    try { setResv(await adminApi.getCustomerReservations(c.lineUserId)) } catch { setResv([]) }
  }
  const saveNameKo = async () => {
    if (!sel) return
    setSaving(true)
    try {
      await adminApi.updateCustomerNameKo(sel.lineUserId, draft)
      const v = draft.trim()
      setSel({ ...sel, nameKo: v })
      setList(prev => prev.map(c => c.lineUserId === sel.lineUserId ? { ...c, nameKo: v } : c))
      try { setResv(await adminApi.getCustomerReservations(sel.lineUserId)) } catch { /* 예약 카드 갱신 실패는 무시 */ }
      setEditing(false)
    } catch (e: any) { alert(e?.message || '수정에 실패했습니다') }
    finally { setSaving(false) }
  }

  if (sel) return (
    <div style={{ margin: '16px 0' }}>
      <button onClick={() => { setSel(null); setEditing(false) }} style={ghostBtn}>← 목록</button>
      {editing ? (
        <div style={{ margin: '12px 0' }}>
          <label style={{ fontSize: 12.5, color: '#666', fontWeight: 600 }}>한국식 이름</label>
          <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
            <input value={draft} onChange={e => setDraft(e.target.value)} autoFocus style={{ flex: 1, height: 38, boxSizing: 'border-box', padding: '0 12px', borderRadius: 8, border: '1px solid #DDD', fontSize: 14 }} />
            <button disabled={saving} onClick={saveNameKo} style={{ ...primaryBtn, opacity: saving ? 0.6 : 1 }}>{saving ? '저장 중…' : '저장'}</button>
            <button disabled={saving} onClick={() => setEditing(false)} style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid #DDD', background: '#fff', fontSize: 13, cursor: 'pointer' }}>취소</button>
          </div>
          <div style={{ fontSize: 11.5, color: '#aaa', marginTop: 4 }}>로마자: {sel.name || '-'} (수정 불가)</div>
        </div>
      ) : (
        <h2 style={{ fontSize: 17, margin: '10px 0 2px', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {sel.nameKo || sel.name || '(이름없음)'} <span style={{ fontSize: 13, color: '#aaa', fontWeight: 400 }}>{sel.name}</span>
          <button onClick={() => { setDraft(sel.nameKo || ''); setEditing(true) }} style={{ fontSize: 12, fontWeight: 600, color: '#1D9E75', background: 'none', border: '1px solid #1D9E75', borderRadius: 8, padding: '3px 10px', cursor: 'pointer' }}>한국식 이름 수정</button>
        </h2>
      )}
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
      <div style={{ fontSize: 13.5, fontWeight: 700, color: '#444', marginBottom: 4 }}>{b.branchName} · {dot(b.date)} {b.time}</div>
      <PersonDetail label="예약자" p={b.booker} showStatus displayStatus={bookerDisplayStatus(b)} />
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
const cardStyle: React.CSSProperties = { background: '#fff', border: '1px solid #EEE', borderRadius: 12, padding: '14px 16px', marginBottom: 12 }
const sectionTitle: React.CSSProperties = { fontSize: 12.5, fontWeight: 700, color: '#999', marginBottom: 8 }
