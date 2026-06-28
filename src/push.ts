// 웹 푸시 구독 + 앱 배지 헬퍼.
// 동작 조건: HTTPS + "설치된 PWA"(특히 iOS는 홈 화면 추가 + iOS 16.4+).
import { adminApi } from './api'

// VAPID 공개키(비밀 아님 — 프론트에 둬도 안전). 백엔드 VAPID_PUBLIC_KEY와 동일해야 함.
const VAPID_PUBLIC = 'BLtO_Qyb77J4uLBDw46XfmusB_0tu6jpeN6iHIBTY3FDpj7HS9CTQONogInIn_Kq-YcTSABcrLh0dq727YXCd7M'

export const pushSupported = () =>
  typeof navigator !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window

function urlB64ToUint8(base64: string): Uint8Array {
  const pad = '='.repeat((4 - (base64.length % 4)) % 4)
  const b64 = (base64 + pad).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(b64)
  const arr = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i)
  return arr
}

export async function isSubscribed(): Promise<boolean> {
  if (!pushSupported()) return false
  const reg = await navigator.serviceWorker.getRegistration()
  if (!reg) return false
  return !!(await reg.pushManager.getSubscription())
}

// 권한 요청 → 구독 → 백엔드 저장
export async function enablePush(): Promise<{ ok: boolean; reason?: string }> {
  if (!pushSupported()) return { ok: false, reason: 'unsupported' }
  const perm = await Notification.requestPermission()
  if (perm !== 'granted') return { ok: false, reason: 'denied' }
  try {
    const reg = await navigator.serviceWorker.ready
    let sub = await reg.pushManager.getSubscription()
    if (!sub) {
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8(VAPID_PUBLIC) as BufferSource })
    }
    await adminApi.subscribePush(sub.toJSON())
    return { ok: true }
  } catch (e: any) {
    return { ok: false, reason: e?.message || String(e) || 'failed' }
  }
}

// 앱이 다시 보일 때 배지/안읽음 카운트 초기화
export function clearBadge() {
  try { (navigator as any).clearAppBadge?.() } catch { /* 미지원 무시 */ }
  try { navigator.serviceWorker?.controller?.postMessage({ type: 'clear-badge' }) } catch { /* noop */ }
}
