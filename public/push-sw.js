/* 웹 푸시 수신 + 앱 배지(안 읽은 알림 수). Workbox 자동생성 sw.js에서 importScripts로 로드됨. */
/* eslint-disable no-undef */
const DB_NAME = 'pwa-badge', STORE = 'kv', KEY = 'unread'

function openDb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, 1)
    r.onupgradeneeded = () => r.result.createObjectStore(STORE)
    r.onsuccess = () => res(r.result)
    r.onerror = () => rej(r.error)
  })
}
async function getCount() {
  try {
    const db = await openDb()
    return await new Promise((res) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(KEY)
      req.onsuccess = () => res(req.result || 0)
      req.onerror = () => res(0)
    })
  } catch { return 0 }
}
async function setCount(n) {
  try {
    const db = await openDb()
    await new Promise((res) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put(n, KEY)
      tx.oncomplete = () => res()
      tx.onerror = () => res()
    })
  } catch { /* noop */ }
}
async function setBadge(n) { try { if (self.navigator.setAppBadge) await self.navigator.setAppBadge(n) } catch { /* noop */ } }
async function clearBadge() { try { if (self.navigator.clearAppBadge) await self.navigator.clearAppBadge() } catch { /* noop */ } }

self.addEventListener('push', (event) => {
  let d = {}
  try { d = event.data ? event.data.json() : {} } catch { d = { body: event.data && event.data.text() } }
  const title = d.title || '새 예약 알림'
  const body = d.body || ''
  event.waitUntil((async () => {
    const n = (await getCount()) + 1
    await setCount(n)
    await setBadge(n)
    await self.registration.showNotification(title, {
      body,
      icon: '/pwa-192x192.png',
      badge: '/favicon-64x64.png',
      tag: d.tag || 'reservation',
      renotify: true,
      data: { url: d.url || '/' },
    })
    // 열려 있는 앱에 새로고침 신호 (목록 즉시 갱신)
    const cs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const c of cs) c.postMessage({ type: 'cb:refresh' })
  })())
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data && event.notification.data.url) || '/'
  event.waitUntil((async () => {
    await setCount(0); await clearBadge()
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const c of all) {
      if ('focus' in c) { try { await c.navigate(url) } catch { /* cross-scope */ } return c.focus() }
    }
    if (self.clients.openWindow) return self.clients.openWindow(url)
  })())
})

// 앱이 포커스를 받으면(클라이언트가 보냄) 배지/카운트 초기화
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'clear-badge') {
    event.waitUntil((async () => { await setCount(0); await clearBadge() })())
  }
})
