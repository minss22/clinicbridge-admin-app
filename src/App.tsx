import { useEffect, useState, useRef, useCallback } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'
import { adminApi } from './api'
import type { Booking, Branch, Person, AdminBranch, Customer, ManagerProposeInfo, AdminMe, AdminUser, Cursor } from './api'
import { pushSupported, isSubscribed, enablePush, disablePush, syncPush, clearBadge } from './push'

const STATUS_KO: Record<string, string> = {
  pending: '접수', confirmed: '확정', rejected: '거절', cancelled: '취소', completed: '완료',
  reschedule_req: '일시변경 요청', rescheduling: '시간 조정 중', companion_add: '동반자 추가 접수',
}
const STATUS_COLOR: Record<string, { bg: string; fg: string; border: string }> = {
  pending:        { bg: '#FEF3C7', fg: '#92400E', border: '#FCD34D' },
  confirmed:      { bg: '#D1FAE5', fg: '#065F46', border: '#6EE7B7' },
  rejected:       { bg: '#FEE2E2', fg: '#991B1B', border: '#FCA5A5' },
  cancelled:      { bg: '#F3F4F6', fg: '#6B7280', border: '#E5E7EB' },
  completed:      { bg: '#E0E7FF', fg: '#3730A3', border: '#C7D2FE' },
  reschedule_req: { bg: '#DBEAFE', fg: '#1E40AF', border: '#93C5FD' },
  rescheduling:   { bg: '#FFEDD5', fg: '#9A3412', border: '#FDBA74' },
  companion_add:  { bg: '#E0F2FE', fg: '#075985', border: '#7DD3FC' },
}
const visitKo = (v: string) => (v === 'first' ? '초진' : v === 'return' ? '재진' : v)
const dot = (d?: string | null) => (d ? d.replace(/-/g, '.') : '')
// 이번 달 1일 ~ 말일 (YYYY-MM-DD) — 예약관리 날짜 검색 기본값
const thisMonthRange = (): [string, string] => {
  const d = new Date(); const y = d.getFullYear(), m = d.getMonth()
  const pad = (n: number) => String(n).padStart(2, '0')
  const last = new Date(y, m + 1, 0)
  return [`${y}-${pad(m + 1)}-01`, `${last.getFullYear()}-${pad(last.getMonth() + 1)}-${pad(last.getDate())}`]
}
const todayRange = (): [string, string] => {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const s = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  return [s, s]
}
const thisWeekRange = (): [string, string] => {
  const d = new Date()
  const day = d.getDay()
  const mondayOffset = day === 0 ? -6 : 1 - day
  const start = new Date(d); start.setDate(d.getDate() + mondayOffset)
  const end = new Date(start); end.setDate(start.getDate() + 6)
  const fmt = (x: Date) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`
  return [fmt(start), fmt(end)]
}

// 개발용: true면 로그인 없이 바로 대시보드 (백엔드 ADMIN_AUTH_DISABLED와 함께 사용)
const NO_AUTH = (import.meta.env.VITE_ADMIN_NO_AUTH as string) === 'true'
// 예약 앱(LIFF) URL 생성용 — 비밀 아님
const LIFF_ID = (import.meta.env.VITE_LIFF_ID as string) || '2010411582-Duzo9BLZ'

export default function App() {
  // 매니저 예약 처리 페이지(로그인 없음, LINE 알림 버튼) — ?manage=<id>
  const sp = new URLSearchParams(window.location.search)
  const manageId = sp.get('manage')
  if (manageId) return <ManagerActionPage reservationId={manageId} />
  // PWA 푸시 알림 클릭 — 대시보드에서 해당 예약 상세 드로어 열기
  const openId = sp.get('open') || undefined

  const [session, setSession] = useState<Session | null | undefined>(undefined)

  useEffect(() => {
    if (NO_AUTH) return
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  if (NO_AUTH) return <AdminShell session={null} openId={openId} />
  if (session === undefined) return <Center>불러오는 중…</Center>
  if (!session) return <Login />
  return <AdminShell session={session} openId={openId} />
}

// ── 셸: 상단 네비 + 권한 게이트 ───────────────────────────────
type View = 'reservations' | 'branches' | 'customers' | 'admins'
const NAV: { key: View; label: string; superOnly?: boolean }[] = [
  { key: 'reservations', label: '예약 관리' },
  { key: 'branches', label: '병원 관리' },
  { key: 'customers', label: '고객 관리' },
  { key: 'admins', label: '관리자 관리', superOnly: true },   // 슈퍼 관리자만
]
function AdminShell({ session, openId }: { session: Session | null; openId?: string }) {
  const [view, setView] = useState<View>('reservations')
  const [access, setAccess] = useState<'checking' | 'ok' | 'forbidden'>('checking')
  const [me, setMe] = useState<AdminMe | null>(null)
  useEffect(() => {
    adminApi.getMe()
      .then((m) => { setMe(m); setAccess('ok') })
      .catch((e: any) => setAccess(String(e?.message || '').includes('승인') ? 'forbidden' : 'ok'))
  }, [])
  const isBranch = me?.role === 'branch'

  // 앱이 다시 보이면 배지/안읽음 초기화 (열어서 확인 = 읽음 처리)
  useEffect(() => {
    clearBadge()
    const onVis = () => { if (document.visibilityState === 'visible') clearBadge() }
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('focus', clearBadge)
    // 서비스워커 신호 → 화면 이벤트로 변환 (새로고침 / 알림 클릭 시 상세 열기)
    const onSw = (e: MessageEvent) => {
      const d = e.data as any
      if (d?.type === 'cb:refresh') window.dispatchEvent(new Event('cb:refresh'))
      else if (d?.type === 'cb:open' && d.id) { setView('reservations'); window.dispatchEvent(new CustomEvent('cb:open', { detail: d.id })) }
    }
    navigator.serviceWorker?.addEventListener('message', onSw)
    return () => { document.removeEventListener('visibilitychange', onVis); window.removeEventListener('focus', clearBadge); navigator.serviceWorker?.removeEventListener('message', onSw) }
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
        {NAV.filter(n => !n.superOnly || me?.role === 'super').map(n => (
          <button key={n.key} onClick={() => setView(n.key)} style={{
            textAlign: 'left', padding: '10px 12px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 14, fontWeight: 600,
            background: view === n.key ? '#111' : 'transparent', color: view === n.key ? '#fff' : '#555',
          }}>{n.label}</button>
        ))}
        <div style={{ marginTop: 'auto', fontSize: 11.5, color: '#aaa', padding: '0 10px' }}>
          <NotifyButton />
          <div style={{ wordBreak: 'break-all', marginBottom: 8 }}>{session?.user.email ?? '개발 모드'}</div>
          {session && <button onClick={() => supabase.auth.signOut()} style={{ ...logoutBtn, padding: '6px 10px', fontSize: 12 }}>로그아웃</button>}
        </div>
      </aside>
      <main style={{ flex: 1, minWidth: 0, padding: '0 20px 60px', background: '#F7F8FA' }}>
        <div style={{ maxWidth: (view === 'reservations' || view === 'customers') ? '100%' : 760, margin: '0 auto' }}>
          {view === 'reservations' && <ReservationsView isBranch={isBranch} openId={openId} />}
          {view === 'branches' && <BranchesView isBranch={isBranch} />}
          {view === 'customers' && <CustomersView isBranch={isBranch} />}
          {view === 'admins' && me?.role === 'super' && <AdminsView myEmail={session?.user.email ?? undefined} />}
        </div>
      </main>
    </div>
  )
}

// 사이드바 알림 켜기 버튼 — 권한 요청 + 푸시 구독
function NotifyButton() {
  const [state, setState] = useState<'unknown' | 'on' | 'off' | 'denied' | 'working'>('unknown')
  useEffect(() => {
    if (!pushSupported()) { setState('unknown'); return }
    if (Notification.permission === 'denied') { setState('denied'); return }
    isSubscribed().then(s => {
      setState(s ? 'on' : 'off')
      if (s) syncPush()   // 기존 구독을 백엔드에 재동기화(이전 저장 실패 복구)
    }).catch(() => setState('off'))
  }, [])
  if (!pushSupported() || state === 'unknown') return null

  const onClick = async () => {
    if (state === 'working') return
    if (state === 'on') {   // 켜짐 → 끄기 (토글)
      setState('working')
      const ok = await disablePush()
      setState(ok ? 'off' : 'on')
      return
    }
    // 꺼짐 → 켜기
    setState('working')
    const r = await enablePush()
    if (r.ok) { setState('on'); return }
    if (r.reason === 'denied') { setState('denied'); alert('브라우저 설정에서 이 사이트의 알림을 허용해 주세요.') }
    else if (r.reason === 'unsupported') { setState('off'); alert('이 브라우저/환경은 알림을 지원하지 않습니다. 설치된 앱(홈 화면 추가)에서 다시 시도해 주세요.') }
    else { setState('off'); alert('알림 설정 실패\n원인: ' + (r.reason || '알 수 없음')) }
  }
  const label = state === 'on' ? '🔔 알림 켜짐' : state === 'denied' ? '🔕 알림 차단됨' : state === 'working' ? '처리 중…' : '🔕 알림 꺼짐'
  const disabled = state === 'denied' || state === 'working'
  return (
    <button onClick={onClick} disabled={disabled} title={state === 'denied' ? '브라우저 설정에서 알림을 허용해야 합니다' : ''}
      style={{
        width: '100%', marginBottom: 8, padding: '7px 10px', borderRadius: 8, fontSize: 12, fontWeight: 700, boxSizing: 'border-box',
        cursor: disabled ? 'default' : 'pointer',
        border: `1px solid ${state === 'on' ? '#1D9E75' : state === 'denied' ? '#E5E7EB' : '#1D9E75'}`,
        background: state === 'on' ? '#E7F5EE' : '#fff',
        color: state === 'on' ? '#0F7A57' : state === 'denied' ? '#aaa' : '#1D9E75',
      }}>{label}</button>
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
type TopTab = 'action' | 'waiting' | 'confirmed' | 'closed' | 'all'
type DetailStatus = 'new' | 'companion_add' | 'reschedule' | 'proposed' | 'confirmed' | 'rejected' | 'cancelled' | 'completed'
type SortKey = 'createdAt' | 'dateTime' | 'branchName' | 'bookerName' | 'birthDate' | 'gender' | 'visitType' | 'treatment' | 'status'
type SortDir = 'asc' | 'desc'
const TOP_TABS: { key: TopTab; label: string; details: DetailStatus[] }[] = [
  { key: 'action', label: '처리 필요', details: ['new', 'companion_add', 'reschedule'] },
  { key: 'waiting', label: '고객 응답 대기', details: ['proposed'] },
  { key: 'confirmed', label: '확정', details: ['confirmed'] },
  { key: 'closed', label: '종료', details: ['rejected', 'cancelled'] },
  { key: 'all', label: '전체', details: ['new', 'companion_add', 'reschedule', 'proposed', 'confirmed', 'rejected', 'cancelled', 'completed'] },
]
const DETAIL_LABEL: Record<DetailStatus, string> = {
  new: '신규 접수',
  companion_add: '동반자 추가 접수',
  reschedule: '일시변경 요청',
  proposed: '시간 조정 중',
  confirmed: '확정',
  rejected: '거절',
  cancelled: '취소',
  completed: '완료',
}
const TOP_COLOR: Record<TopTab, { bg: string; fg: string }> = {
  action: { bg: '#EAB308', fg: '#fff' },
  waiting: { bg: '#F97316', fg: '#fff' },
  confirmed: STATUS_COLOR.confirmed,
  closed: { bg: '#6B7280', fg: '#fff' },
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
// 동반자 배지 상태: 그룹 전체가 일시변경/제안 중이면(=같은 group_id로 함께 묶여 대기)
// 대기(pending) 동반자도 예약자와 동일하게 표시. 단, 확정 예약에 나중에 추가돼 승인 대기 중인
// 동반자(예약자는 확정 상태)는 별개 건이므로 자기 status('접수') 그대로 표시.
const companionDisplayStatus = (b: Booking, p: Person) =>
  p.status === 'pending' && b.booker.status === 'confirmed' && p.batchId !== b.groupId
    ? 'companion_add'
    :
  p.status === 'pending' && (isReschedulePending(b) || isClinicProposed(b))
    ? bookerDisplayStatus(b)
    : p.status

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
        {info.memo && <div style={{ marginTop: 4, color: '#92400E', whiteSpace: 'pre-wrap' }}>📝 메모: {info.memo}</div>}
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

function ReservationsView({ isBranch, openId }: { isBranch?: boolean; openId?: string }) {
  const [branches, setBranches] = useState<Branch[]>([])
  const [branchId, setBranchId] = useState('')
  const [items, setItems] = useState<Booking[]>([])
  const [counts, setCounts] = useState<Record<string, number> | null>(null)  // 탭별 건수(서버)
  const [tab, setTab] = useState<TopTab>('action')
  const [detailFilters, setDetailFilters] = useState<DetailStatus[]>(TOP_TABS[0].details)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [rejectTarget, setRejectTarget] = useState<string | null>(null)  // 거절 대상(메시지 모달)
  const [rejectMsg, setRejectMsg] = useState('')
  const [proposeTarget, setProposeTarget] = useState<Booking | null>(null)   // 시간 제안 모달
  const [drawerTarget, setDrawerTarget] = useState<Booking | null>(null)     // 예약 상세 드로어
  const [query, setQuery] = useState('')      // 이름 검색(입력값)
  const [debouncedQuery, setDebouncedQuery] = useState('')    // 디바운스된 검색어(서버 전송)
  const [from, setFrom] = useState(thisMonthRange()[0])   // 날짜 범위 시작 (기본=이번 달 1일, 빈값=제한없음)
  const [to, setTo] = useState(thisMonthRange()[1])       // 날짜 범위 종료 (기본=이번 달 말일)
  const [fromTime, setFromTime] = useState(''); const [toTime, setToTime] = useState('')  // 예약 시간 범위
  const [dateField, setDateField] = useState<'created' | 'reserved'>('created')  // 접수일/예약일 중 무엇으로 검색 (기본=접수일)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [sortKey, setSortKey] = useState<SortKey>('createdAt')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [viewMode, setViewMode] = useState<'list' | 'calendar'>('list')
  const [dayDrawer, setDayDrawer] = useState<{ date: string; bookings: Booking[] } | null>(null)
  const [calMonth, setCalMonth] = useState(thisMonthRange()[0].slice(0, 7))   // 캘린더 표시 월(YYYY-MM)
  const [calBookings, setCalBookings] = useState<Booking[]>([])               // 그 달 예약(캘린더 전용)

  const reqRef = useRef(0)            // 최신 요청 식별 → 오래된 응답 무시

  // 병원 목록(드롭다운). 병원 관리자는 자기 병원만 반환됨.
  useEffect(() => { adminApi.getBranches().then(setBranches).catch(() => {}) }, [])
  // 이름 검색 디바운스(300ms)
  useEffect(() => { const t = setTimeout(() => setDebouncedQuery(query), 300); return () => clearTimeout(t) }, [query])

  const reqBody = () => ({
    branchId: branchId || undefined,
    status: tab,
    statusFilters: detailFilters,
    q: debouncedQuery || undefined,
    dateField,
    from: from || undefined,
    to: to || undefined,
    fromTime: fromTime || undefined,
    toTime: toTime || undefined,
    page,
    pageSize,
    sortKey,
    sortDir,
  })

  const fetchFirst = async (silent = false) => {
    const my = ++reqRef.current
    if (!silent) setLoading(true)
    try {
      const resPage = await adminApi.getReservationsPage(reqBody())
      if (my !== reqRef.current) return
      setItems(resPage.items)
      setTotal(resPage.total ?? resPage.items.length)
      setTotalPages(resPage.totalPages ?? 1)
      if (resPage.page && resPage.page !== page) setPage(resPage.page)
      if (resPage.counts) setCounts(resPage.counts)
      setDrawerTarget(dt => dt ? (resPage.items.find(x => x.groupId === dt.groupId) ?? dt) : null)
    } catch (e: any) { if (!silent && my === reqRef.current) alert(e?.message || '불러오기에 실패했습니다') }
    finally { if (!silent && my === reqRef.current) setLoading(false) }
  }
  // 필터(병원·탭·검색어·날짜·시간) 변경 시 첫 페이지 재조회 — 리스트 뷰일 때만
  const filterKey = `${branchId}|${tab}|${detailFilters.join(',')}|${debouncedQuery}|${dateField}|${from}|${to}|${fromTime}|${toTime}|${page}|${pageSize}|${sortKey}|${sortDir}`
  useEffect(() => { if (viewMode === 'list') fetchFirst() }, [filterKey, viewMode])

  // 캘린더 뷰: 그 달 예약만 별도 조회
  useEffect(() => {
    if (viewMode !== 'calendar') return
    adminApi.getReservationsMonth(calMonth, branchId || undefined).then(setCalBookings).catch(() => setCalBookings([]))
  }, [viewMode, calMonth, branchId])

  const refresh = (silent = false) => {
    if (viewMode === 'list') fetchFirst(silent)
    else adminApi.getReservationsMonth(calMonth, branchId || undefined).then(setCalBookings).catch(() => {})
  }
  // 앱이 다시 보일 때(알림 클릭/탭 복귀) + 푸시 수신 시 목록 자동 새로고침(로딩 깜빡임 없이)
  const refreshRef = useRef(refresh); refreshRef.current = refresh
  useEffect(() => {
    const fire = () => { if (document.visibilityState !== 'hidden') refreshRef.current(true) }
    window.addEventListener('focus', fire)
    window.addEventListener('cb:refresh', fire)
    document.addEventListener('visibilitychange', fire)
    return () => { window.removeEventListener('focus', fire); window.removeEventListener('cb:refresh', fire); document.removeEventListener('visibilitychange', fire) }
  }, [])

  // 푸시 알림 클릭 → 해당 예약 상세 드로어 열기.
  // 부팅 진입은 prop openId(?open=), 이미 열린 앱은 SW의 cb:open 메시지로 들어옴.
  const [pendingOpen, setPendingOpen] = useState<string | undefined>(openId)
  useEffect(() => {
    const onOpen = (e: Event) => {
      const id = (e as CustomEvent).detail as string
      if (id) { setPendingOpen(id); refreshRef.current(true) }   // 최신 목록에 포함되도록 새로고침
    }
    window.addEventListener('cb:open', onOpen)
    return () => window.removeEventListener('cb:open', onOpen)
  }, [])
  useEffect(() => {
    if (!pendingOpen) return
    const b = items.find(x => x.booker.id === pendingOpen || x.companions.some(c => c.id === pendingOpen))
    if (b) {
      setDrawerTarget(b); setPendingOpen(undefined)
      try { window.history.replaceState({}, '', window.location.pathname) } catch { /* noop */ }
    }
  }, [pendingOpen, items])

  const act = async (kind: 'confirm' | 'reject', reservationId: string) => {
    if (kind === 'reject') { setRejectTarget(reservationId); setRejectMsg(''); return }  // 거절은 메시지 모달로
    if (!confirm('확정하시겠습니까? (고객에게 알림이 갑니다)')) return
    setBusy(reservationId)
    try { await adminApi.confirm(reservationId); await fetchFirst() }
    catch (e: any) { alert(e?.message || '처리에 실패했습니다') }
    finally { setBusy(null) }
  }
  const doReject = async () => {
    if (!rejectTarget) return
    setBusy(rejectTarget)
    try { await adminApi.reject(rejectTarget, rejectMsg.trim() || undefined); setRejectTarget(null); await fetchFirst() }
    catch (e: any) { alert(e?.message || '거절 처리에 실패했습니다') }
    finally { setBusy(null) }
  }

  const tInput: React.CSSProperties = { height: 38, width: 112, boxSizing: 'border-box', padding: '0 8px', borderRadius: 8, border: '1px solid #DDD', fontSize: 13 }
  const currentTop = TOP_TABS.find(t => t.key === tab) ?? TOP_TABS[0]
  const setTopTab = (next: TopTab) => {
    const found = TOP_TABS.find(t => t.key === next) ?? TOP_TABS[0]
    setTab(found.key)
    setDetailFilters(found.details)
    setPage(1)
  }
  const toggleDetail = (key: DetailStatus) => {
    setDetailFilters(prev => {
      const allowed = currentTop.details
      const next = prev.includes(key) ? prev.filter(x => x !== key) : [...prev, key]
      const cleaned = next.filter(x => allowed.includes(x))
      return cleaned.length ? cleaned : [key]
    })
    setPage(1)
  }
  const applyRange = (range: [string, string]) => { setFrom(range[0]); setTo(range[1]); setPage(1) }
  const activeQuick = (() => {
    const same = (r: [string, string]) => from === r[0] && to === r[1]
    if (same(todayRange())) return 'today'
    if (same(thisWeekRange())) return 'week'
    if (same(thisMonthRange())) return 'month'
    return ''
  })()
  const changeSort = (key: SortKey) => {
    setSortKey(prev => {
      if (prev !== key) { setSortDir('desc'); return key }
      setSortDir(d => d === 'desc' ? 'asc' : 'desc')
      return prev
    })
    setPage(1)
  }

  // 거절 대상(reservationId)이 어떤 케이스인지 → 거절 시 동작 설명
  const rejectInfo = (id: string | null): { title: string; desc: string } => {
    const bk = id ? items.find(b => b.booker.id === id) : null
    if (bk) {
      if (isReschedulePending(bk)) return { title: '일시변경 요청 거절', desc: '고객의 일시변경 요청만 거절합니다. 기존 예약은 그대로 유지되며, 고객에게 "변경 불가 · 기존 예약 유효" 알림이 발송됩니다.' }
      if (isClinicProposed(bk)) return { title: '시간 제안 취소', desc: '병원이 제안한 시간을 취소하고 이 예약을 거절합니다. 예약자·동반자 전체가 거절 처리되며 고객에게 거절 알림이 발송됩니다.' }
      return { title: '예약 거절', desc: '이 예약을 거절합니다. 예약자와 동반자 전체가 거절 처리되며, 고객에게 거절 알림이 발송됩니다.' }
    }
    // 예약자 행이 아니면 = 확정 예약에 추가된 동반자 batch 거절
    return { title: '동반자 추가 거절', desc: '나중에 추가된 동반자만 거절합니다. 기존 확정 예약(예약자·기존 동반자)은 영향받지 않습니다.' }
  }

  return (
    <div>
      {/* 상단: 리스트/캘린더 전환 · 병원 · 새로고침 */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', margin: '16px 0 12px' }}>
        <div style={{ display: 'inline-flex', border: '1px solid #DDD', borderRadius: 8, overflow: 'hidden' }}>
          {(['list', 'calendar'] as const).map(m => (
            <button key={m} onClick={() => setViewMode(m)} style={{ padding: '0 16px', height: 38, border: 'none', cursor: 'pointer', fontSize: 13.5, fontWeight: 700, background: viewMode === m ? '#1D9E75' : '#fff', color: viewMode === m ? '#fff' : '#666' }}>{m === 'list' ? '리스트' : '캘린더'}</button>
          ))}
        </div>
        {!isBranch && (
          <select value={branchId} onChange={e => setBranchId(e.target.value)} style={{ height: 38, boxSizing: 'border-box', padding: '0 12px', borderRadius: 8, border: '1px solid #DDD', fontSize: 14 }}>
            <option value="">전체 병원</option>
            {branches.map(b => <option key={b.branchId} value={b.branchId}>{b.name}</option>)}
          </select>
        )}
        <div style={{ flex: 1 }} />
        <button onClick={() => refresh()} title="새로고침" style={{ height: 38, boxSizing: 'border-box', padding: '0 12px', borderRadius: 8, border: '1px solid #DDD', background: '#fff', fontSize: 15, cursor: 'pointer' }}>↻</button>
      </div>

      {viewMode === 'calendar' ? (
        <CalendarView bookings={calBookings} month={calMonth} onMonthChange={setCalMonth} onOpenDay={(date, list) => setDayDrawer({ date, bookings: list })} />
      ) : (
        <>
          {/* 검색: 날짜 범위 · 시간 범위 · 이름 */}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
            <div style={{ display: 'inline-flex', gap: 4, padding: 3, border: '1px solid #DDD', borderRadius: 9, background: '#fff' }}>
              {[
                ['today', '오늘', todayRange()],
                ['week', '이번 주', thisWeekRange()],
                ['month', '이번 달', thisMonthRange()],
              ].map(([key, label, range]) => {
                const active = activeQuick === key
                return (
                  <button key={key as string} onClick={() => applyRange(range as [string, string])} style={{
                    height: 30, padding: '0 10px', borderRadius: 7, border: 'none', cursor: 'pointer',
                    background: active ? '#111' : 'transparent', color: active ? '#fff' : '#555',
                    fontSize: 12.5, fontWeight: 700, whiteSpace: 'nowrap',
                  }}>{label as string}</button>
                )
              })}
            </div>
            <RangeCalendar from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); setPage(1) }} dateField={dateField} onDateField={(f) => { setDateField(f); setPage(1) }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }} title="예약 시간 범위">
              <span style={{ fontSize: 14 }}>🕐</span>
              <input type="time" value={fromTime} onChange={e => { setFromTime(e.target.value); setPage(1) }} style={tInput} />
              <span style={{ color: '#999' }}>~</span>
              <input type="time" value={toTime} onChange={e => { setToTime(e.target.value); setPage(1) }} style={tInput} />
              {(fromTime || toTime) && <button onClick={() => { setFromTime(''); setToTime(''); setPage(1) }} title="시간 초기화" style={{ height: 38, border: '1px solid #DDD', background: '#fff', borderRadius: 8, padding: '0 9px', cursor: 'pointer', color: '#888' }}>✕</button>}
            </div>
            <input value={query} onChange={e => { setQuery(e.target.value); setPage(1) }} placeholder="이름 검색 (LINE·로마자·한국식)" style={{ flex: '1 1 180px', minWidth: 150, height: 38, boxSizing: 'border-box', padding: '0 12px', borderRadius: 8, border: '1px solid #DDD', fontSize: 14 }} />
          </div>
          {/* 상태 탭 — 건수는 서버 집계(현재 날짜·시간·이름 검색 반영). */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
            {TOP_TABS.map(t => {
              const count = counts?.[t.key] ?? 0
              const active = tab === t.key
              const c = TOP_COLOR[t.key]
              const actionActive = t.key === 'action' && active
              return (
                <button key={t.key} onClick={() => setTopTab(t.key)} style={{ padding: '8px 14px', borderRadius: 999, border: actionActive ? 'none' : `1.5px solid ${active ? c.fg : '#E5E7EB'}`, background: active ? c.bg : 'transparent', color: active ? c.fg : '#333', fontSize: 13, fontWeight: active ? 700 : 600, cursor: 'pointer' }}>
                  {t.label} {count > 0 && <span style={{ opacity: 0.75 }}>({count})</span>}
                </button>
              )
            })}
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
            {currentTop.details.map(k => {
              const active = detailFilters.includes(k)
              const count = counts?.[k] ?? 0
              const c = STATUS_COLOR[k === 'new' ? 'pending' : k === 'proposed' ? 'rescheduling' : k === 'reschedule' ? 'reschedule_req' : k] ?? STATUS_COLOR.pending
              return (
                <button key={k} onClick={() => toggleDetail(k)} style={{
                  padding: '6px 11px', borderRadius: 999, border: `1.5px solid ${active ? c.border : '#E5E7EB'}`,
                  background: active ? c.bg : '#fff', color: active ? c.fg : '#555',
                  fontSize: 12.5, fontWeight: 700, cursor: 'pointer',
                }}>
                  {DETAIL_LABEL[k]} <span style={{ opacity: 0.72 }}>({count})</span>
                </button>
              )
            })}
          </div>
          {loading ? (
            <Center small>불러오는 중…</Center>
          ) : items.length === 0 ? (
            <p style={{ textAlign: 'center', color: '#999', padding: '40px 0', fontSize: 14 }}>해당 예약이 없습니다.</p>
          ) : (
            <>
              <div style={{ background: '#fff', border: '1px solid #EAEAEA', borderRadius: 12, overflow: 'hidden' }}>
                <div style={{ display: 'grid', gridTemplateColumns: RES_GRID, gap: '0 12px', padding: '11px 16px', background: '#FAFBFC', borderBottom: '1px solid #E5E7EB' }}>
                  {RES_COLUMNS.map((col, i) => (
                    <button key={col.key || i} disabled={!col.sortKey} onClick={() => col.sortKey && changeSort(col.sortKey)} style={{
                      ...headCell, textAlign: RES_ALIGN[i], color: col.sortKey ? '#555' : '#888',
                      border: 'none', background: 'transparent', padding: 0, cursor: col.sortKey ? 'pointer' : 'default',
                    }}>
                      {col.label}{col.sortKey && sortKey === col.sortKey && <span style={{ marginLeft: 3 }}>{sortDir === 'desc' ? '▼' : '▲'}</span>}
                    </button>
                  ))}
                </div>
                <div>
                  {items.map((b, i) => <BookingRow key={b.groupId} b={b} last={i === items.length - 1} busy={busy} act={act} onPropose={() => setProposeTarget(b)} onOpen={() => setDrawerTarget(b)} />)}
                </div>
              </div>
              <Pagination page={page} totalPages={totalPages} total={total} pageSize={pageSize} onPage={setPage} onPageSize={(n) => { setPageSize(n); setPage(1) }} />
            </>
          )}
        </>
      )}

      {proposeTarget && <ProposeModal booking={proposeTarget} onClose={() => setProposeTarget(null)} onDone={() => { setProposeTarget(null); fetchFirst() }} />}
      {/* 데이 드로어(타임라인)를 닫지 않고 그 위에 상세 드로어를 띄움 → 상세 닫으면 타임라인으로 복귀 */}
      {dayDrawer && <DayDrawer date={dayDrawer.date} bookings={dayDrawer.bookings} onClose={() => setDayDrawer(null)} onOpenBooking={(b) => setDrawerTarget(b)} />}
      {drawerTarget && <ReservationDrawer booking={drawerTarget} busy={busy} act={act} onPropose={() => setProposeTarget(drawerTarget)} onClose={() => setDrawerTarget(null)} backLabel={dayDrawer ? '← 타임라인' : undefined} />}

      {rejectTarget && (
        <div onClick={() => { if (!busy) setRejectTarget(null) }} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 20 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, padding: 20, width: '100%', maxWidth: 380, fontFamily: 'system-ui, sans-serif' }}>
            <h3 style={{ margin: '0 0 6px', fontSize: 16 }}>{rejectInfo(rejectTarget).title}</h3>
            <div style={{ margin: '0 0 10px', fontSize: 13, color: '#9A3412', background: '#FFF7ED', border: '1px solid #FED7AA', borderRadius: 8, padding: '9px 11px', lineHeight: 1.6 }}>{rejectInfo(rejectTarget).desc}</div>
            <p style={{ margin: '0 0 12px', fontSize: 12.5, color: '#888', lineHeight: 1.6 }}>아래 메시지를 적으면 거절 알림 뒤에 함께 보냅니다(일본어로 번역되어 전달).</p>
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

// 예약 "표처럼 보이는 카드" 레이아웃 — 헤더와 카드가 같은 그리드 컬럼을 공유. 마지막은 액션 열.
const RES_COLUMNS: { key: string; label: string; sortKey?: SortKey }[] = [
  { key: 'createdAt', label: '접수일자', sortKey: 'createdAt' },
  { key: 'dateTime', label: '예약 일시', sortKey: 'dateTime' },
  { key: 'branch', label: '병원', sortKey: 'branchName' },
  { key: 'booker', label: '예약자', sortKey: 'bookerName' },
  { key: 'birth', label: '생년월일', sortKey: 'birthDate' },
  { key: 'gender', label: '성별', sortKey: 'gender' },
  { key: 'visit', label: '구분', sortKey: 'visitType' },
  { key: 'treatment', label: '희망 시술', sortKey: 'treatment' },
  { key: 'status', label: '상태', sortKey: 'status' },
  { key: 'actions', label: '' },
]
const RES_GRID = '96px 142px 90px minmax(100px,1.2fr) 104px 52px 60px minmax(120px,1.4fr) 104px 200px'
// 자유 텍스트(희망시술)만 좌측, 나머지는 중앙 정렬
const RES_ALIGN: Array<React.CSSProperties['textAlign']> = ['center', 'center', 'center', 'center', 'center', 'center', 'center', 'left', 'center', 'center']
const headCell: React.CSSProperties = { fontSize: 12, fontWeight: 700, color: '#888', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }
const cellBase: React.CSSProperties = { fontSize: 13, color: '#333', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }
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

function PersonDetail({ label, p, showStatus, displayStatus, expanded }: { label: string; p: Person; showStatus?: boolean; displayStatus?: string; expanded?: boolean }) {
  const [more, setMore] = useState(false)
  const open = expanded || more   // expanded=항상 전체 정보 표시(더보기 없음)
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
      {/* 1줄: 이름(한국식 + 로마자 옆) / 생년월일·성별(라벨)  +  상태 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, lineHeight: 1.4 }}>
          <span>
            <span style={{ fontSize: 11, color: '#777', background: '#EEE', borderRadius: 6, padding: '1px 6px', marginRight: 6 }}>{label}</span>
            <b style={{ fontSize: 14, color: '#111' }}>{p.nameKo || p.name}</b>
            {p.nameKo && p.name && <span style={{ color: '#aaa', fontSize: 12, marginLeft: 5 }}>{p.name}</span>}
            <span style={{ ...visitPill, marginLeft: 8 }}>{visitKo(p.visitType)}</span>
          </span>
          <span style={{ fontSize: 12.5, color: '#666' }}>
            <span style={kStyle}>생년월일</span>{p.birthDate || '-'}
            <span style={{ ...kStyle, marginLeft: 10 }}>성별</span>{genderKo(p.gender)}
          </span>
        </div>
        {showStatus && <StatusBadge status={st} />}
      </div>

      {/* 2줄: 희망시술 + 더보기(오른쪽 끝, expanded면 숨김) */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: 1 }}>
          <span style={{ fontSize: 13, color: '#333', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: expanded ? 'normal' : 'nowrap' }}>
            <span style={kStyle}>희망시술</span>{p.treatmentRequest || '-'}
          </span>
        </div>
        {!expanded && <button onClick={() => setMore(v => !v)} style={moreBtn}>{more ? '접기 ▴' : '더보기 ▾'}</button>}
      </div>

      {/* 희망예산 · 시술이력 (expanded면 항상, 아니면 더보기 시) */}
      {open && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
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

// 예약 한 건 = 카드 한 줄(예약자) + 동반자 줄. 동반자가 있으면 한 그룹(연녹색)으로 묶어 표시. 행 클릭 → 상세 드로어.
function BookingRow({ b, last, busy, act, onPropose, onOpen }: { b: Booking; last?: boolean; busy: string | null; act: (k: 'confirm' | 'reject', id: string) => void; onPropose: () => void; onOpen: () => void }) {
  const disabled = busy === b.booker.id
  const cell = (v: React.ReactNode, extra?: React.CSSProperties) => <div style={{ ...cellBase, ...extra }}>{v}</div>
  const sbtn: React.CSSProperties = { padding: '5px 9px', borderRadius: 7, fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap' }
  const stop = (fn: () => void) => (e: React.MouseEvent) => { e.stopPropagation(); fn() }

  const bookerActionCol = () => {
    if (isReschedulePending(b) || isNewPending(b)) return (
      <div style={{ display: 'flex', gap: 5, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
        <button disabled={disabled} onClick={stop(() => act?.('confirm', b.booker.id))} style={{ ...sbtn, border: 'none', background: '#1D9E75', color: '#fff', cursor: 'pointer' }}>확정</button>
        <button disabled={disabled} onClick={stop(() => act?.('reject', b.booker.id))} style={{ ...sbtn, border: '1px solid #E53E3E', background: '#fff', color: '#E53E3E', cursor: 'pointer' }}>거절</button>
        <button onClick={stop(() => onPropose?.())} style={{ ...sbtn, border: '1px dashed #F6A623', background: '#fff', color: '#B45309', cursor: 'pointer' }}>시간조정</button>
      </div>
    )
    if (isClinicProposed(b)) return (
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button disabled={disabled} onClick={stop(() => act?.('reject', b.booker.id))} style={{ ...sbtn, border: '1px solid #E53E3E', background: '#fff', color: '#E53E3E', cursor: 'pointer' }}>제안 취소</button>
      </div>
    )
    return null
  }
  const companionActionCol = (p: Person) => {
    if (!(b.booker.status === 'confirmed' && p.status === 'pending' && p.batchId !== b.groupId)) return null
    return (
      <div style={{ display: 'flex', gap: 5, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
        <button disabled={busy === p.id} onClick={stop(() => act?.('confirm', p.id))} style={{ ...sbtn, border: 'none', background: '#1D9E75', color: '#fff', cursor: 'pointer' }}>확정</button>
        <button disabled={busy === p.id} onClick={stop(() => act?.('reject', p.id))} style={{ ...sbtn, border: '1px solid #E53E3E', background: '#fff', color: '#E53E3E', cursor: 'pointer' }}>거절</button>
      </div>
    )
  }

  const personRow = (p: Person, isComp: boolean) => (
    <div key={p.id} style={{ display: 'grid', gridTemplateColumns: RES_GRID, gap: '0 12px', alignItems: 'center', padding: '12px 16px', ...(isComp ? { background: '#F4FAF7', borderTop: '1px dashed #CDE9DC' } : {}) }}>
      {cell(isComp ? '' : dot((b.createdAt || '').slice(0, 10)), { color: '#888', textAlign: 'center' })}
      {cell(isComp
        ? ''
        : <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.35 }}>
            <b>{dot(b.date)} {b.time}</b>
            {isReschedulePending(b) && <b style={{ color: '#1E40AF' }}>🔁 {dot(b.requestedDate)} {b.requestedTime}</b>}
          </div>, { textAlign: 'center', whiteSpace: 'normal' })}
      {cell(isComp ? '' : b.branchName, { color: '#555', textAlign: 'center', whiteSpace: 'normal' })}
      {cell(
        <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.3 }}>
          <b style={{ color: isComp ? '#222' : '#111' }}>{isComp && <span style={{ color: '#7bbf9f', marginRight: 4 }}>↳</span>}{p.nameKo || p.name}</b>
          {p.nameKo && p.name && <span style={{ color: '#aaa', fontSize: 11.5 }}>{p.name}</span>}
          {!isComp && b.companions.length > 0 && <span style={{ alignSelf: 'center', marginTop: 3, background: '#1D9E75', color: '#fff', fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 10 }}>동반 {b.companions.length}명</span>}
        </div>, { textAlign: 'center', whiteSpace: 'normal' })}
      {cell(p.birthDate || '-', { color: '#555', textAlign: 'center' })}
      {cell(genderKo(p.gender), { color: '#555', textAlign: 'center' })}
      {cell(<VisitPill v={p.visitType} />, { overflow: 'visible', textAlign: 'center' })}
      {cell(p.treatmentRequest || '-', { whiteSpace: 'normal' })}
      {cell(<StatusBadge status={isComp ? companionDisplayStatus(b, p) : bookerDisplayStatus(b)} />, { overflow: 'visible', textAlign: 'center' })}
      {cell(isComp ? companionActionCol(p) : bookerActionCol(), { overflow: 'visible' })}
    </div>
  )

  // 동반자(함께 예약된 고객)가 있으면 예약자+동반자를 연녹색 배경으로 묶고,
  // 왼쪽 초록 띠는 위·아래를 살짝 띄워(inset) 연속된 그룹의 경계가 구분되게 한다.
  const grouped = b.companions.length > 0
  return (
    <div onClick={onOpen} style={{ position: 'relative', cursor: 'pointer', background: '#fff', ...(last ? {} : { borderBottom: '1px solid #EEE' }) }}>
      {grouped && <div style={{ position: 'absolute', left: 0, top: 6, bottom: 6, width: 3, borderRadius: 2, background: '#1D9E75' }} />}
      {personRow(b.booker, false)}
      {b.companions.map((c) => personRow(c, true))}
    </div>
  )
}

// 시간 제안 — 중앙 모달
function ProposeModal({ booking, onClose, onDone }: { booking: Booking; onClose: () => void; onDone: () => void }) {
  const [slots, setSlots] = useState<{ time: string; available: boolean }[]>([])
  const [picked, setPicked] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const targetDate = (isReschedulePending(booking) ? (booking.requestedDate || booking.date) : booking.date) as string
  useEffect(() => { adminApi.getSlots(booking.branchId, targetDate).then(setSlots).catch(() => setSlots([])) }, [])
  const toggle = (t: string) => setPicked(p => p.includes(t) ? p.filter(x => x !== t) : [...p, t])
  const submit = async () => {
    if (!picked.length) { alert('제안할 시간을 1개 이상 선택하세요'); return }
    setBusy(true)
    try { await adminApi.propose(booking.booker.id, targetDate, picked); onDone() }
    catch (e: any) { alert(e?.message || '제안 실패') }
    finally { setBusy(false) }
  }
  return (
    <div onClick={() => !busy && onClose()} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60, padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, padding: 20, width: '100%', maxWidth: 420, fontFamily: 'system-ui, sans-serif' }}>
        <h3 style={{ margin: '0 0 4px', fontSize: 16 }}>🕒 다른 시간 제안</h3>
        <p style={{ margin: '0 0 12px', fontSize: 13, color: '#888' }}>{dot(targetDate)} · 제안할 시간을 선택해 고객에게 보냅니다.</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 16 }}>
          {slots.length === 0 && <span style={{ fontSize: 13, color: '#999' }}>가능한 시간이 없습니다.</span>}
          {slots.map(s => {
            const on = picked.includes(s.time)
            const isOrig = targetDate === booking.date && s.time === booking.time
            const dis = !s.available || isOrig
            return <button key={s.time} disabled={dis} onClick={() => !dis && toggle(s.time)} style={{ padding: '8px 13px', borderRadius: 999, fontSize: 13, fontWeight: 600, cursor: dis ? 'not-allowed' : 'pointer', border: `1.5px solid ${on ? '#1D9E75' : dis ? '#EEE' : '#DDD'}`, background: on ? '#1D9E75' : dis ? '#F3F4F6' : '#fff', color: on ? '#fff' : dis ? '#BBB' : '#555' }}>{s.time}</button>
          })}
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button disabled={busy} onClick={onClose} style={{ flex: 1, padding: '11px', borderRadius: 8, border: '1px solid #DDD', background: '#fff', color: '#666', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>취소</button>
          <button disabled={busy || !picked.length} onClick={submit} style={{ flex: 1, padding: '11px', borderRadius: 8, border: 'none', background: picked.length ? '#F6A623' : '#E5E7EB', color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>{busy ? '제안 중…' : `제안 (${picked.length})`}</button>
        </div>
      </div>
    </div>
  )
}

// 예약 상세 — 우측 드로어. readOnly=고객 관리용: 처리 버튼(footer) 숨김.
function ReservationDrawer({ booking, busy = null, act, onPropose, onClose, readOnly, backLabel }: { booking: Booking; busy?: string | null; act?: (k: 'confirm' | 'reject', id: string) => void; onPropose?: () => void; onClose: () => void; readOnly?: boolean; backLabel?: string }) {
  const b = booking
  const compBatches = pendingCompanionBatches(b)
  const disabled = busy === b.booker.id
  const canAct = !readOnly && (isReschedulePending(b) || isNewPending(b))
  const hasCompPending = !readOnly && b.booker.status === 'confirmed' && compBatches.length > 0
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'flex', justifyContent: 'flex-end', zIndex: 55, fontFamily: 'system-ui, sans-serif' }}>
      <aside onClick={e => e.stopPropagation()} style={{ width: 'min(460px, 92vw)', height: '100dvh', background: '#fff', boxShadow: '-4px 0 20px rgba(0,0,0,0.1)', display: 'flex', flexDirection: 'column' }}>
        {backLabel && (
          <button onClick={onClose} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '10px 16px', border: 'none', borderBottom: '1px solid #F2F2F2', background: '#FAFBFC', color: '#1D9E75', fontSize: 13, fontWeight: 700, cursor: 'pointer', textAlign: 'left' }}>{backLabel}</button>
        )}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 18px', borderBottom: '1px solid #EEE' }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700 }}>{b.branchName}</div>
            <div style={{ marginTop: 6 }}>
              <span style={{ display: 'block', fontSize: 11.5, color: '#999', fontWeight: 700, marginBottom: 2 }}>예약 일시</span>
              <span style={{ fontSize: 20, color: '#111', fontWeight: 800 }}>{dot(b.date)} {b.time}</span>
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, color: '#888', cursor: 'pointer' }}>×</button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 18px 20px' }}>
          {isReschedulePending(b) && <div style={{ background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 10, padding: '10px 12px', fontSize: 13, fontWeight: 700, color: '#1E40AF', marginBottom: 8 }}>
            <div>🔁 일시변경 요청</div>
            <div style={{ marginTop: 4 }}>→ {dot(b.requestedDate)} {b.requestedTime}</div>
          </div>}
          {isClinicProposed(b) && <div style={{ background: '#FFF7ED', border: '1px solid #FED7AA', borderRadius: 10, padding: '10px 12px', fontSize: 13, fontWeight: 700, color: '#9A3412', marginBottom: 8 }}>
            <div>🕒 시간 제안 후 고객 응답 대기</div>
            <div style={{ marginTop: 4 }}>→ {dot(b.requestedDate)} ({(b.proposedTimes || []).join(', ')})</div>
          </div>}
          {b.memo && <div style={{ background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 10, padding: '10px 12px', marginBottom: 8 }}>
            <div style={{ fontSize: 11.5, fontWeight: 700, color: '#92400E', marginBottom: 3 }}>📝 고객 메모</div>
            <div style={{ fontSize: 13, color: '#444', whiteSpace: 'pre-wrap' }}>{b.memo}</div>
          </div>}
          <PersonDetail label="예약자" p={b.booker} showStatus displayStatus={bookerDisplayStatus(b)} expanded />
          {b.companions.map((c, i) => <PersonDetail key={c.id} label={`동반자 ${i + 1}`} p={c} showStatus displayStatus={companionDisplayStatus(b, c)} expanded />)}
        </div>
        {!readOnly && (canAct || isClinicProposed(b) || hasCompPending) && (
          <div style={{ borderTop: '1px solid #EEE', padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {canAct && (
              <div style={{ display: 'flex', gap: 8 }}>
                <button disabled={disabled} onClick={() => act?.('confirm', b.booker.id)} style={{ ...confirmBtn, flex: 1, padding: '11px' }}>확정</button>
                <button disabled={disabled} onClick={() => act?.('reject', b.booker.id)} style={{ ...rejectBtn, flex: 1, padding: '11px' }}>거절</button>
                <button onClick={() => onPropose?.()} style={{ ...proposeBtn, flex: 1, padding: '11px' }}>🕒 다른 시간 제안</button>
              </div>
            )}
            {isClinicProposed(b) && (
              <button disabled={disabled} onClick={() => act?.('reject', b.booker.id)} style={{ ...rejectBtn, padding: '11px' }}>제안 취소(거절)</button>
            )}
            {hasCompPending && compBatches.map((batch, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ flex: 1, fontSize: 12.5, color: '#065F46', fontWeight: 700 }}>➕ {batch.map(c => c.nameKo || c.name).join(', ')}</span>
                <button disabled={busy === batch[0].id} onClick={() => act?.('confirm', batch[0].id)} style={confirmBtn}>확정</button>
                <button disabled={busy === batch[0].id} onClick={() => act?.('reject', batch[0].id)} style={rejectBtn}>거절</button>
              </div>
            ))}
          </div>
        )}
      </aside>
    </div>
  )
}

function Pagination({ page, totalPages, total, pageSize, onPage, onPageSize }: {
  page: number; totalPages: number; total: number; pageSize: number
  onPage: (p: number) => void; onPageSize: (n: number) => void
}) {
  const safeTotal = Math.max(1, totalPages || 1)
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1
  const end = Math.min(total, page * pageSize)
  const pages = Array.from({ length: safeTotal }, (_, i) => i + 1)
    .filter(p => p === 1 || p === safeTotal || Math.abs(p - page) <= 2)
  const compact: Array<number | 'dots'> = []
  pages.forEach((p, i) => {
    if (i > 0 && p - (pages[i - 1] as number) > 1) compact.push('dots')
    compact.push(p)
  })
  const btn = (disabled = false): React.CSSProperties => ({
    minWidth: 34, height: 34, borderRadius: 8, border: '1px solid #DDD',
    background: '#fff', color: disabled ? '#BBB' : '#333', fontSize: 13, fontWeight: 700,
    cursor: disabled ? 'default' : 'pointer',
  })
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '14px 2px 0' }}>
      <div style={{ fontSize: 12.5, color: '#888' }}>{total ? `${start}-${end} / 총 ${total}건` : '총 0건'}</div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <select value={pageSize} onChange={e => onPageSize(Number(e.target.value))} style={{ height: 34, borderRadius: 8, border: '1px solid #DDD', padding: '0 8px', fontSize: 13 }}>
          {[10, 30, 50, 100].map(n => <option key={n} value={n}>{n}개</option>)}
        </select>
        <button disabled={page <= 1} onClick={() => onPage(Math.max(1, page - 1))} style={btn(page <= 1)}>‹</button>
        {compact.map((p, i) => p === 'dots'
          ? <span key={`d${i}`} style={{ color: '#AAA', padding: '0 2px' }}>…</span>
          : <button key={p} onClick={() => onPage(p)} style={{ ...btn(false), borderColor: p === page ? '#1D9E75' : '#DDD', background: p === page ? '#1D9E75' : '#fff', color: p === page ? '#fff' : '#333' }}>{p}</button>
        )}
        <button disabled={page >= safeTotal} onClick={() => onPage(Math.min(safeTotal, page + 1))} style={btn(page >= safeTotal)}>›</button>
      </div>
    </div>
  )
}

// 캘린더 셀/타임라인 상태 짧은 라벨
const STATUS_SHORT: Record<string, string> = { pending: '접수', confirmed: '확정', rejected: '거절', cancelled: '취소', completed: '완료', reschedule_req: '변경', rescheduling: '조정' }

// 예약 관리 — 캘린더 뷰 (예약일 기준, 날짜별 상태 건수)
function CalendarView({ bookings, month, onMonthChange, onOpenDay }: { bookings: Booking[]; month: string; onMonthChange: (m: string) => void; onOpenDay: (date: string, list: Booking[]) => void }) {
  const ym = month
  const [y, m] = ym.split('-').map(Number)
  const startDow = new Date(y, m - 1, 1).getDay()
  const daysInMonth = new Date(y, m, 0).getDate()
  const cells: (string | null)[] = []
  for (let i = 0; i < startDow; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(`${ym}-${String(d).padStart(2, '0')}`)
  const shift = (delta: number) => { const nd = new Date(y, m - 1 + delta, 1); onMonthChange(`${nd.getFullYear()}-${String(nd.getMonth() + 1).padStart(2, '0')}`) }
  const todayStr = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10)

  // 날짜 → 예약(예약일 기준), 취소·거절 제외하고 표시
  const byDate: Record<string, Booking[]> = {}
  for (const b of bookings) {
    if (b.booker.status === 'cancelled' || b.booker.status === 'rejected') continue
    ;(byDate[b.date] ??= []).push(b)
  }

  return (
    <div style={{ background: '#fff', border: '1px solid #EAEAEA', borderRadius: 12, padding: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <button onClick={() => shift(-1)} style={navBtnB}>‹</button>
        <b style={{ fontSize: 15 }}>{y}년 {m}월</b>
        <button onClick={() => shift(1)} style={navBtnB}>›</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 4, marginBottom: 4 }}>
        {['일', '월', '화', '수', '목', '금', '토'].map((d, i) => <div key={i} style={{ textAlign: 'center', fontSize: 12, fontWeight: 600, color: i === 0 ? '#E53E3E' : i === 6 ? '#3B82F6' : '#999' }}>{d}</div>)}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 4 }}>
        {cells.map((ds, i) => {
          if (!ds) return <div key={i} />
          const list = byDate[ds] || []
          // 상태별 건수
          const counts: Record<string, number> = {}
          for (const b of list) { const s = bookerDisplayStatus(b); counts[s] = (counts[s] || 0) + 1 }
          const isToday = ds === todayStr
          return (
            <button key={i} type="button" onClick={() => list.length && onOpenDay(ds, list)} style={{
              minHeight: 84, borderRadius: 8, padding: '6px 6px', textAlign: 'left', cursor: list.length ? 'pointer' : 'default',
              border: `1.5px solid ${isToday ? '#1D9E75' : '#EEE'}`, background: '#fff', display: 'flex', flexDirection: 'column', gap: 3, overflow: 'hidden',
            }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: '#333' }}>{Number(ds.slice(8))}</div>
              {Object.entries(counts).map(([s, n]) => {
                const c = STATUS_COLOR[s] ?? STATUS_COLOR.pending
                return <span key={s} style={{ fontSize: 10.5, fontWeight: 700, color: c.fg, background: c.bg, borderRadius: 5, padding: '1px 5px', whiteSpace: 'nowrap' }}>{STATUS_SHORT[s] ?? s} {n}</span>
              })}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// 날짜별 예약 타임라인 — 우측 드로어. 같은 시간은 한 번만(점), 점끼리 선으로 잇고 그 시간 예약을 오른쪽에.
function DayDrawer({ date, bookings, onClose, onOpenBooking }: { date: string; bookings: Booking[]; onClose: () => void; onOpenBooking: (b: Booking) => void }) {
  const sorted = [...bookings].sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0))
  // 같은 시간끼리 묶기
  const byTime: Record<string, Booking[]> = {}
  for (const b of sorted) (byTime[b.time] ??= []).push(b)
  const times = Object.keys(byTime).sort()

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'flex', justifyContent: 'flex-end', zIndex: 55, fontFamily: 'system-ui, sans-serif' }}>
      <aside onClick={e => e.stopPropagation()} style={{ width: 'min(420px, 92vw)', height: '100dvh', background: '#fff', boxShadow: '-4px 0 20px rgba(0,0,0,0.1)', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 18px', borderBottom: '1px solid #EEE' }}>
          <b style={{ fontSize: 16 }}>{dot(date)} 예약 ({sorted.length})</b>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, color: '#888', cursor: 'pointer' }}>×</button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '18px 18px' }}>
          {times.length === 0 ? <p style={{ color: '#999', fontSize: 14 }}>예약이 없습니다.</p> : (
            <div>
              {times.map((t, ti) => {
                const last = ti === times.length - 1
                return (
                  <div key={t} style={{ display: 'flex', gap: 12 }}>
                    {/* 왼쪽: 점 + 시간, 점끼리 세로선 연결 */}
                    <div style={{ width: 56, flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, height: 18 }}>
                        <div style={{ width: 10, height: 10, borderRadius: 999, background: '#1D9E75', flexShrink: 0 }} />
                        <span style={{ fontSize: 13, fontWeight: 700, color: '#111' }}>{t}</span>
                      </div>
                      {!last && <div style={{ flex: 1, width: 2, background: '#D7EBE2', marginLeft: 4, minHeight: 10 }} />}
                    </div>
                    {/* 오른쪽: 그 시간의 예약들 */}
                    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6, paddingBottom: last ? 0 : 18 }}>
                      {byTime[t].map(b => {
                        const s = bookerDisplayStatus(b)
                        const c = STATUS_COLOR[s] ?? STATUS_COLOR.pending
                        return (
                          <button key={b.groupId} type="button" onClick={() => onOpenBooking(b)} style={{ display: 'flex', gap: 8, alignItems: 'center', width: '100%', padding: '9px 11px', border: '1px solid #EEE', borderLeft: `3px solid ${c.fg}`, borderRadius: 10, background: '#fff', cursor: 'pointer', textAlign: 'left' }}>
                            <div style={{ minWidth: 0, flex: 1 }}>
                              <div style={{ fontSize: 13.5, fontWeight: 700, color: '#111', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {b.booker.nameKo || b.booker.name}{b.companions.length > 0 && <span style={{ color: '#1D9E75', fontWeight: 700 }}> +{b.companions.length}</span>}
                              </div>
                              <div style={{ fontSize: 12, color: '#666', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.booker.treatmentRequest || '-'}</div>
                            </div>
                            <span style={{ flexShrink: 0, fontSize: 11, fontWeight: 700, color: c.fg, background: c.bg, borderRadius: 6, padding: '2px 7px' }}>{STATUS_SHORT[s] ?? s}</span>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </aside>
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

function BranchesView({ isBranch }: { isBranch?: boolean }) {
  const [list, setList] = useState<AdminBranch[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<AdminBranch | null>(null)        // 상세(보기)
  const [editing, setEditing] = useState<{ b: AdminBranch; isNew: boolean } | null>(null)  // 수정/생성

  // 병원 관리자는 목록 없이 자기 병원 상세로 바로 진입 (병원 1곳 자동 선택)
  const load = () => { setLoading(true); adminApi.getAdminBranches().then(l => { setList(l); if (isBranch && l.length) setSelected(s => s ?? l[0]) }).catch((e: any) => alert(e?.message)).finally(() => setLoading(false)) }
  useEffect(() => { load() }, [])

  if (editing) return <BranchForm init={editing.b} isNew={editing.isNew} canDelete={!isBranch} isBranch={isBranch}
    onClose={() => setEditing(null)} onSaved={(saved) => { setEditing(null); setSelected(saved); load() }} />
  if (selected) return <BranchDetail key={selected.branchId} b={selected} hideBack={isBranch} isBranch={isBranch} onBack={() => setSelected(null)} onEdit={() => setEditing({ b: selected, isNew: false })} onChanged={(nb) => { setSelected(nb); load() }} />
  if (loading) return <Center small>불러오는 중…</Center>
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '16px 0' }}>
        <h2 style={{ fontSize: 16, margin: 0 }}>병원 ({list.length})</h2>
        {!isBranch && <button onClick={() => setEditing({ b: emptyBranch(), isNew: true })} style={primaryBtn}>+ 새 병원</button>}
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

function BranchDetail({ b, onBack, onEdit, onChanged, hideBack, isBranch }: { b: AdminBranch; onBack: () => void; onEdit: () => void; onChanged: (b: AdminBranch) => void; hideBack?: boolean; isBranch?: boolean }) {
  const [copied, setCopied] = useState(false)
  const [holidays, setHolidays] = useState<Map<string, string>>(new Map())
  // 일정(휴무 요일/점심 없는 요일/휴무일/마감시간)은 상세에서 바로 편집
  const [sched, setSched] = useState({ closedDays: b.closedDays, noLunchDays: b.noLunchDays, holidayDates: b.holidayDates, blockedSlots: b.blockedSlots })
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')  // 자동 저장 상태
  const savingRef = useRef(false)
  const pendingRef = useRef<typeof sched | null>(null)
  useEffect(() => { adminApi.getHolidays().then(h => setHolidays(new Map(h.map(x => [x.date, x.name])))).catch(() => {}) }, [])

  const url = `https://liff.line.me/${LIFF_ID}?branch=${b.branchId}`
  const copy = async () => {
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1500) }
    catch { prompt('URL 복사', url) }
  }
  const bCal = { ...b, ...sched }   // 캘린더 슬롯 계산 + 표시용
  // 토글 즉시 자동 저장. 연속 토글은 최신값으로 합쳐 1건씩 직렬 저장(유실·경쟁 방지).
  const autoSave = async (next: typeof sched) => {
    pendingRef.current = next
    if (savingRef.current) return
    savingRef.current = true
    setStatus('saving')
    let merged = { ...b, ...next }
    try {
      while (pendingRef.current) {
        merged = { ...b, ...pendingRef.current }
        pendingRef.current = null
        await adminApi.saveBranch(merged)
      }
      savingRef.current = false
      setStatus('saved'); onChanged(merged)
      window.setTimeout(() => setStatus(s => (s === 'saved' ? 'idle' : s)), 2000)
    } catch {
      savingRef.current = false; pendingRef.current = null; setStatus('error')
    }
  }
  const apply = (next: typeof sched) => { setSched(next); autoSave(next) }
  const toggleDay = (key: 'closedDays' | 'noLunchDays', d: number) =>
    apply({ ...sched, [key]: sched[key].includes(d) ? sched[key].filter(x => x !== d) : [...sched[key], d] })
  const toggleHoliday = (date: string) =>
    apply({ ...sched, holidayDates: sched.holidayDates.includes(date) ? sched.holidayDates.filter(x => x !== date) : [...sched.holidayDates, date] })
  const toggleBlocked = (date: string, time: string) => {
    const key = `${date} ${time}`
    apply({ ...sched, blockedSlots: sched.blockedSlots.includes(key) ? sched.blockedSlots.filter(x => x !== key) : [...sched.blockedSlots, key] })
  }

  return (
    <div style={{ margin: '16px 0' }}>
      {!hideBack && <button onClick={onBack} style={ghostBtn}>← 목록</button>}
      <div style={{ margin: '10px 0 16px' }}>
        <h2 style={{ fontSize: 20, margin: 0 }}>{b.name}</h2>
        <div style={{ color: '#888', fontSize: 13, marginTop: 2 }}>{b.nameJa}</div>
      </div>

      {/* 예약 앱 URL은 슈퍼 관리자에게만 노출 */}
      {!isBranch && (
        <div style={cardStyle}>
          <div style={sectionTitle}>📱 예약 앱 URL</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input readOnly value={url} onFocus={e => e.currentTarget.select()} style={{ ...inputStyle, flex: 1, color: '#555' }} />
            <button onClick={copy} style={{ ...primaryBtn, whiteSpace: 'nowrap', background: copied ? '#888' : '#1D9E75' }}>{copied ? '복사됨 ✓' : '복사'}</button>
          </div>
        </div>
      )}

      <div style={cardStyle}>
        <div style={{ ...sectionTitle, display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <span>기본 정보</span>
          <button onClick={onEdit} style={{ padding: '6px 14px', borderRadius: 8, border: '1px solid #1D9E75', background: '#fff', color: '#1D9E75', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>수정</button>
        </div>
        {!isBranch && <Row k="병원 ID" v={b.branchId} />}
        <Row k="주소 (한국어)" v={b.address} />
        <Row k="주소 (일본어)" v={b.addressJa} />
        <Row k="영업시간" v={`${b.openTime || '-'} ~ ${b.closeTime || '-'}`} />
        <Row k="점심시간" v={b.lunchStart ? `${b.lunchStart} ~ ${b.lunchEnd || '-'}` : '없음'} />
        <Row k="예약 마감 버퍼" v={`마감 ${b.closeBufferMin ?? 90}분 · 점심 ${b.lunchBufferMin ?? 90}분 전까지`} />
      </div>

      <div style={cardStyle}>
        <div style={{ ...sectionTitle, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>휴무 / 마감 시간 설정</span>
          <span style={{ fontSize: 12.5, fontWeight: 600, color: status === 'error' ? '#E53E3E' : status === 'saved' ? '#1D9E75' : '#9CA3AF' }}>
            {status === 'saving' ? '저장 중…' : status === 'saved' ? '저장됨 ✓' : status === 'error' ? '저장 실패 · 다시 눌러주세요' : '변경 시 자동 저장'}
          </span>
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

function BranchForm({ init, isNew, canDelete, isBranch, onClose, onSaved }: { init: AdminBranch; isNew: boolean; canDelete?: boolean; isBranch?: boolean; onClose: () => void; onSaved: (saved: AdminBranch | null) => void }) {
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

      {/* 병원 ID는 슈퍼 관리자만 (병원 관리자에겐 숨김) */}
      {!isBranch && <>
        <Lbl>병원 ID (LINE 채널 ID{isNew ? '' : ', 변경 불가'})</Lbl>
        <Txt value={b.branchId} onChange={v => set('branchId', v)} disabled={!isNew} />
      </>}
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
      {/* 매니저 LINE ID·채널 토큰은 슈퍼 관리자만 (병원 관리자에겐 숨김) */}
      {!isBranch && <>
        <Lbl>매니저 LINE ID <span style={{ fontWeight: 400, color: '#1D9E75', fontSize: 11.5, marginLeft: 6 }}>예약 알림을 받을 LINE userId</span></Lbl>
        <Txt value={b.lineNotifyId} onChange={v => set('lineNotifyId', v)} />
        <Lbl>채널 액세스 토큰 <span style={{ fontWeight: 400, color: '#1D9E75', fontSize: 11.5, marginLeft: 6 }}>이 병원 LINE 공식계정의 Messaging API 토큰</span></Lbl>
        <Txt value={b.channelAccessToken} onChange={v => set('channelAccessToken', v)} placeholder="비우면 전역 토큰 사용" />
      </>}

      <div style={{ display: 'flex', gap: 8, marginTop: 22 }}>
        <button disabled={busy} onClick={save} style={{ ...primaryBtn, flex: 1, padding: '12px' }}>{busy ? '저장 중…' : '저장'}</button>
        {!isNew && canDelete && <button disabled={busy} onClick={del} style={{ padding: '12px 18px', borderRadius: 8, border: '1px solid #E53E3E', background: '#fff', color: '#E53E3E', fontWeight: 700, cursor: 'pointer' }}>삭제</button>}
      </div>
    </div>
  )
}

// ── 고객 관리 ─────────────────────────────────────────────────
// 고객 목록 표: 예약(건수) · LINE 프로필 · 이름 · 로마자 · 생년월일 · 성별 · 등록일
const CUST_GRID = '64px minmax(96px,1.1fr) minmax(110px,1.2fr) minmax(92px,1fr) 104px 56px 100px'
const CUST_LIST_HEADERS: { label: string; align: React.CSSProperties['textAlign'] }[] = [
  { label: '예약', align: 'center' }, { label: 'LINE 프로필', align: 'left' }, { label: '이름', align: 'left' },
  { label: '로마자', align: 'left' }, { label: '생년월일', align: 'left' }, { label: '성별', align: 'left' }, { label: '등록일', align: 'left' },
]
// 고객 상세의 예약 내역 — 예약관리와 동일 레이아웃의 읽기 전용 표(동반자 그룹 박스)
const CUST_RES_GRID = '116px 108px minmax(96px,1.2fr) 100px 50px 58px minmax(100px,1.3fr) 88px 88px'
function ReadonlyBookingTable({ bookings }: { bookings: Booking[] }) {
  const cell = (v: React.ReactNode, extra?: React.CSSProperties) => <div style={{ ...cellBase, ...extra }}>{v}</div>
  const personRow = (b: Booking, p: Person, isComp: boolean) => (
    <div key={p.id} style={{ display: 'grid', gridTemplateColumns: CUST_RES_GRID, gap: '0 12px', alignItems: 'center', padding: '11px 14px', ...(isComp ? { background: '#F4FAF7', borderTop: '1px dashed #CDE9DC' } : {}) }}>
      {cell(isComp ? '' : (
        <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.35 }}>
          <b>{dot(b.date)} {b.time}</b>
          {isReschedulePending(b) && <span style={{ fontSize: 10, color: '#1E40AF', fontWeight: 700 }}>🔁 {dot(b.requestedDate)} {b.requestedTime}</span>}
          {isClinicProposed(b) && <span style={{ fontSize: 10, color: '#9A3412', fontWeight: 700 }}>🕒 {(b.proposedTimes || []).join(', ')}</span>}
        </div>
      ), { textAlign: 'center', whiteSpace: 'normal' })}
      {cell(isComp ? '' : b.branchName, { color: '#555', textAlign: 'center', whiteSpace: 'normal' })}
      {cell(
        <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.3 }}>
          <b style={{ color: isComp ? '#222' : '#111' }}>{isComp && <span style={{ color: '#7bbf9f', marginRight: 4 }}>↳</span>}{p.nameKo || p.name}</b>
          {p.nameKo && p.name && <span style={{ color: '#aaa', fontSize: 11.5 }}>{p.name}</span>}
          {!isComp && b.companions.length > 0 && <span style={{ alignSelf: 'center', marginTop: 3, background: '#1D9E75', color: '#fff', fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 10 }}>동반 {b.companions.length}명</span>}
        </div>, { textAlign: 'center', whiteSpace: 'normal' })}
      {cell(p.birthDate || '-', { color: '#555', textAlign: 'center' })}
      {cell(genderKo(p.gender), { color: '#555', textAlign: 'center' })}
      {cell(<VisitPill v={p.visitType} />, { overflow: 'visible', textAlign: 'center' })}
      {cell(p.treatmentRequest || '-', { whiteSpace: 'normal' })}
      {cell(<StatusBadge status={isComp ? companionDisplayStatus(b, p) : bookerDisplayStatus(b)} />, { overflow: 'visible', textAlign: 'center' })}
      {cell(isComp ? '' : dot((b.createdAt || '').slice(0, 10)), { color: '#888', textAlign: 'center' })}
    </div>
  )
  return (
    <div style={{ background: '#fff', border: '1px solid #EAEAEA', borderRadius: 12, overflow: 'hidden' }}>
      <div style={{ display: 'grid', gridTemplateColumns: CUST_RES_GRID, gap: '0 12px', padding: '10px 14px', background: '#FAFBFC', borderBottom: '1px solid #E5E7EB' }}>
        {['예약 일시', '병원', '예약자', '생년월일', '성별', '구분', '희망 시술', '상태', '접수일자'].map((h, i) => (
          <div key={i} style={{ fontSize: 11.5, fontWeight: 700, color: '#888', textAlign: i === 6 ? 'left' : 'center', whiteSpace: 'nowrap' }}>{h}</div>
        ))}
      </div>
      {bookings.map((b, i) => {
        const grouped = b.companions.length > 0
        return (
          <div key={b.groupId} style={{ position: 'relative', background: '#fff', ...(i === bookings.length - 1 ? {} : { borderBottom: '1px solid #EEE' }) }}>
            {grouped && <div style={{ position: 'absolute', left: 0, top: 6, bottom: 6, width: 3, borderRadius: 2, background: '#1D9E75' }} />}
            {personRow(b, b.booker, false)}
            {b.companions.map(c => personRow(b, c, true))}
          </div>
        )
      })}
    </div>
  )
}

function CustomersView({ isBranch }: { isBranch?: boolean }) {
  const [items, setItems] = useState<Customer[]>([])     // keyset로 누적된 고객 목록
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [sel, setSel] = useState<Customer | null>(null)
  const [resv, setResv] = useState<Booking[] | null>(null)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [branches, setBranches] = useState<Branch[]>([])
  const [branchId, setBranchId] = useState('')   // 슈퍼 관리자용 병원 필터 (빈값=전체)

  const cursorRef = useRef<Cursor>(null)
  const reqRef = useRef(0)
  const moreLockRef = useRef(false)
  const hasMoreRef = useRef(false)
  const ioRef = useRef<IntersectionObserver | null>(null)

  useEffect(() => { if (!isBranch) adminApi.getBranches().then(setBranches).catch(() => {}) }, [isBranch])

  const fetchFirst = async () => {
    const my = ++reqRef.current
    setLoading(true); cursorRef.current = null; hasMoreRef.current = false
    try {
      const page = await adminApi.getCustomersPage({ branchId: branchId || undefined, limit: 30 })
      if (my !== reqRef.current) return
      setItems(page.items)
      cursorRef.current = page.nextCursor; hasMoreRef.current = !!page.nextCursor; setHasMore(!!page.nextCursor)
    } catch (e: any) { if (my === reqRef.current) alert(e?.message) }
    finally { if (my === reqRef.current) setLoading(false) }
  }
  const fetchMore = async () => {
    if (moreLockRef.current || !hasMoreRef.current || !cursorRef.current) return
    moreLockRef.current = true; setLoadingMore(true)
    const my = reqRef.current
    try {
      const page = await adminApi.getCustomersPage({ branchId: branchId || undefined, cursor: cursorRef.current, limit: 30 })
      if (my !== reqRef.current) return
      setItems(prev => [...prev, ...page.items])
      cursorRef.current = page.nextCursor; hasMoreRef.current = !!page.nextCursor; setHasMore(!!page.nextCursor)
    } catch { /* 다음 페이지 실패는 조용히 */ }
    finally { moreLockRef.current = false; setLoadingMore(false) }
  }
  const fetchMoreRef = useRef(fetchMore); fetchMoreRef.current = fetchMore
  useEffect(() => { fetchFirst() }, [branchId])
  const sentinel = useCallback((node: HTMLDivElement | null) => {
    if (ioRef.current) { ioRef.current.disconnect(); ioRef.current = null }
    if (node) {
      ioRef.current = new IntersectionObserver(es => { if (es[0].isIntersecting) fetchMoreRef.current() }, { rootMargin: '300px' })
      ioRef.current.observe(node)
    }
  }, [])

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
      setItems(prev => prev.map(c => c.lineUserId === sel.lineUserId ? { ...c, nameKo: v } : c))
      try { setResv(await adminApi.getCustomerReservations(sel.lineUserId)) } catch { /* 예약 표 갱신 실패는 무시 */ }
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
          : <>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: '#999', marginBottom: 8 }}>예약 내역</div>
              <ReadonlyBookingTable bookings={resv} />
            </>}
    </div>
  )

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '16px 0', flexWrap: 'wrap' }}>
        <h2 style={{ fontSize: 16, margin: 0 }}>고객 · 등록순</h2>
        <div style={{ flex: 1 }} />
        {!isBranch && (
          <select value={branchId} onChange={e => setBranchId(e.target.value)} style={{ height: 36, boxSizing: 'border-box', padding: '0 12px', borderRadius: 8, border: '1px solid #DDD', fontSize: 14 }}>
            <option value="">전체 병원</option>
            {branches.map(b => <option key={b.branchId} value={b.branchId}>{b.name}</option>)}
          </select>
        )}
      </div>
      {loading ? <Center small>불러오는 중…</Center> : items.length === 0 ? <p style={{ color: '#999', fontSize: 14 }}>고객이 없습니다.</p> : (
        <>
          <div style={{ background: '#fff', border: '1px solid #EAEAEA', borderRadius: 12, overflow: 'hidden' }}>
            <div style={{ display: 'grid', gridTemplateColumns: CUST_GRID, gap: '0 12px', padding: '11px 16px', background: '#FAFBFC', borderBottom: '1px solid #E5E7EB' }}>
              {CUST_LIST_HEADERS.map((h, i) => <div key={i} style={{ ...headCell, textAlign: h.align }}>{h.label}</div>)}
            </div>
            <div>
              {items.map((c, i) => (
                <div key={c.lineUserId} onClick={() => open(c)} style={{ display: 'grid', gridTemplateColumns: CUST_GRID, gap: '0 12px', alignItems: 'center', minHeight: 48, padding: '8px 16px', cursor: 'pointer', ...(i === items.length - 1 ? {} : { borderBottom: '1px solid #F3F3F3' }) }}>
                  <div style={{ textAlign: 'center' }}><span style={{ display: 'inline-block', minWidth: 22, fontSize: 12.5, fontWeight: 700, color: '#1D9E75', background: '#E7F5EE', borderRadius: 999, padding: '2px 8px' }}>{(c as any).reservationCount ?? 0}</span></div>
                  <div style={{ ...cellBase, color: '#333' }}>{c.displayName || '-'}</div>
                  <div style={{ ...cellBase, color: '#111', fontWeight: 700 }}>{c.nameKo || c.name || '(이름없음)'}</div>
                  <div style={{ ...cellBase, color: '#a3a8a3' }}>{c.name || '-'}</div>
                  <div style={{ ...cellBase, color: '#555' }}>{c.birthDate || '-'}</div>
                  <div style={{ ...cellBase, color: '#555' }}>{genderKo(c.gender)}</div>
                  <div style={{ ...cellBase, color: '#555' }}>{dot((c.createdAt || '').slice(0, 10))}</div>
                </div>
              ))}
            </div>
          </div>
          <div ref={sentinel} style={{ height: 1 }} />
          {loadingMore && <p style={{ textAlign: 'center', color: '#999', fontSize: 13, padding: '14px 0' }}>더 불러오는 중…</p>}
          {!hasMore && !loadingMore && <p style={{ textAlign: 'center', color: '#CCC', fontSize: 12, padding: '12px 0' }}>마지막입니다</p>}
        </>
      )}
    </div>
  )
}

// ── 관리자 관리 (슈퍼 전용) ───────────────────────────────────
// 초대형: 이메일 + 담당 병원만 등록 → 그 Google 계정으로 로그인하면 자동 적용.
function AdminsView({ myEmail }: { myEmail?: string }) {
  const [list, setList] = useState<AdminUser[]>([])
  const [branches, setBranches] = useState<Branch[]>([])
  const [loading, setLoading] = useState(true)
  const [email, setEmail] = useState('')
  const [branchId, setBranchId] = useState('')   // '' = 슈퍼 관리자(전체)
  const [busy, setBusy] = useState(false)

  const load = () => {
    setLoading(true)
    Promise.all([adminApi.listAdmins(), adminApi.getBranches()])
      .then(([a, b]) => { setList(a); setBranches(b) })
      .catch((e: any) => alert(e?.message)).finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])
  const branchLabel = (id: string | null) => id ? (branches.find(b => b.branchId === id)?.name || id) : '전체 (슈퍼 관리자)'

  const add = async () => {
    const e = email.trim()
    if (!e) { alert('이메일을 입력하세요'); return }
    setBusy(true)
    try { await adminApi.saveAdmin(e, branchId || null); setEmail(''); setBranchId(''); load() }
    catch (err: any) { alert(err?.message || '저장에 실패했습니다') } finally { setBusy(false) }
  }
  const remove = async (e: string) => {
    if (!confirm(`${e} 관리자를 삭제하시겠습니까?`)) return
    try { await adminApi.deleteAdmin(e); load() } catch (err: any) { alert(err?.message || '삭제에 실패했습니다') }
  }

  const inp: React.CSSProperties = { height: 38, boxSizing: 'border-box', padding: '0 12px', borderRadius: 8, border: '1px solid #DDD', fontSize: 14 }
  return (
    <div>
      <h2 style={{ fontSize: 16, margin: '16px 0 4px' }}>관리자 관리</h2>
      <p style={{ fontSize: 12.5, color: '#888', margin: '0 0 16px', lineHeight: 1.6 }}>
        이메일과 담당 병원을 등록하면, 그 사람이 <b>해당 Google 계정으로 로그인</b>할 때 자동으로 권한이 적용됩니다.
        병원을 비워두면 <b>전체 권한(슈퍼 관리자)</b>입니다.
      </p>

      {/* 추가 폼 */}
      <div style={{ ...cardStyle, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <input value={email} onChange={e => setEmail(e.target.value)} placeholder="manager@example.com" style={{ ...inp, flex: '1 1 220px', minWidth: 180 }} />
        <select value={branchId} onChange={e => setBranchId(e.target.value)} style={{ ...inp, flex: '0 1 200px' }}>
          <option value="">전체 (슈퍼 관리자)</option>
          {branches.map(b => <option key={b.branchId} value={b.branchId}>{b.name}</option>)}
        </select>
        <button disabled={busy} onClick={add} style={{ ...primaryBtn, padding: '10px 18px', opacity: busy ? 0.6 : 1 }}>{busy ? '저장 중…' : '+ 추가'}</button>
      </div>

      {loading ? <Center small>불러오는 중…</Center> : (
        <div style={{ background: '#fff', border: '1px solid #EAEAEA', borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(180px,1.6fr) minmax(120px,1fr) 80px', gap: '0 12px', padding: '11px 16px', background: '#FAFBFC', borderBottom: '1px solid #E5E7EB' }}>
            {['이메일', '권한 / 담당 병원', ''].map((h, i) => <div key={i} style={{ ...headCell, textAlign: i === 2 ? 'right' : 'left' }}>{h}</div>)}
          </div>
          {list.map((a, i) => {
            const isSuper = !a.branchId
            const isMe = !!myEmail && a.email.toLowerCase() === myEmail.toLowerCase()
            return (
              <div key={a.email} style={{ display: 'grid', gridTemplateColumns: 'minmax(180px,1.6fr) minmax(120px,1fr) 80px', gap: '0 12px', alignItems: 'center', padding: '12px 16px', ...(i === list.length - 1 ? {} : { borderBottom: '1px solid #F3F3F3' }) }}>
                <div style={{ ...cellBase, color: '#111' }}>{a.email} {isMe && <span style={{ color: '#aaa', fontSize: 11.5 }}>(나)</span>}</div>
                <div style={{ ...cellBase }}>
                  <span style={{ fontSize: 11.5, fontWeight: 700, padding: '2px 8px', borderRadius: 999, ...(isSuper ? { color: '#1D9E75', background: '#E7F5EE' } : { color: '#1E40AF', background: '#DBEAFE' }) }}>{isSuper ? '슈퍼 관리자' : branchLabel(a.branchId)}</span>
                </div>
                <div style={{ textAlign: 'right' }}>
                  {!isMe && <button onClick={() => remove(a.email)} style={{ border: '1px solid #E53E3E', background: '#fff', color: '#E53E3E', borderRadius: 7, padding: '5px 10px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>삭제</button>}
                </div>
              </div>
            )
          })}
          {list.length === 0 && <p style={{ color: '#999', fontSize: 14, padding: '20px 16px' }}>등록된 관리자가 없습니다.</p>}
        </div>
      )}
      <p style={{ fontSize: 11.5, color: '#aaa', marginTop: 10 }}>※ 이미 등록된 이메일을 다시 추가하면 담당 병원이 변경됩니다. 본인 계정은 삭제할 수 없습니다.</p>
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
