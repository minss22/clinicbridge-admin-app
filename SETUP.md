# 관리자 대시보드 설치 가이드

구글 로그인 + 승인된 계정만 접근하는 슈퍼 관리자 대시보드. liff-app과 별개의 React 앱.

순서대로 진행하세요. (1~3은 1회 설정, 4는 배포)

---

## 1. DB — admin_users 테이블 + 승인 이메일

Supabase SQL Editor에서 [../supabase/admin_setup.sql](../supabase/admin_setup.sql) 실행.
안의 `insert ... values ('...')` 이메일을 **본인 구글 이메일(소문자)**로 바꾸세요.
나중에 관리자 추가: `insert into admin_users (email) values ('someone@gmail.com') on conflict do nothing;`

## 2. api 함수 재배포

Edge Functions → `api` → 최신 [../supabase/functions/api/index.ts](../supabase/functions/api/index.ts) 붙여넣고 Deploy.
(admin-branches / admin-reservations / admin-confirm / admin-reject 라우트 추가됨)

## 3. 구글 로그인 설정 (Supabase Auth + Google Cloud)

### 3-1. Google Cloud Console에서 OAuth 클라이언트 생성
1. https://console.cloud.google.com → 프로젝트 생성/선택
2. **API 및 서비스 → OAuth 동의 화면** → External → 앱 이름/이메일 입력 → 저장
3. **API 및 서비스 → 사용자 인증 정보 → 사용자 인증 정보 만들기 → OAuth 클라이언트 ID**
   - 유형: **웹 애플리케이션**
   - **승인된 리디렉션 URI**에 추가:
     `https://bwiwvusjydhnwgewolib.supabase.co/auth/v1/callback`
   - 생성 후 **클라이언트 ID / 클라이언트 보안 비밀** 복사

### 3-2. Supabase에 Google 공급자 등록
1. Supabase 대시보드 → **Authentication → Sign In / Providers → Google** → Enable
2. 위에서 복사한 **Client ID / Client Secret** 붙여넣기 → Save
3. **Authentication → URL Configuration**
   - **Site URL**: 배포된 대시보드 주소 (예: `https://liff-admin.vercel.app`)
   - **Redirect URLs**에 추가: 배포 주소 + 로컬 개발용 `http://localhost:3001`

## 4. 대시보드 배포 (새 Vercel 프로젝트)

### 4-1. 새 GitHub 저장소에 admin-app 올리기
```bash
cd admin-app
git init && git add -A && git commit -m "init admin dashboard"
git remote add origin https://github.com/<본인>/liff-admin-dashboard.git
git push -u origin main
```

### 4-2. Vercel에서 새 프로젝트로 Import
- Root Directory: 저장소 루트(admin-app을 따로 올렸으면 그대로)
- **Environment Variables** (Project Settings → Environment Variables):
  | Key | Value |
  |---|---|
  | `VITE_SUPABASE_URL` | `https://bwiwvusjydhnwgewolib.supabase.co` |
  | `VITE_SUPABASE_ANON_KEY` | Supabase → Project Settings → API → **anon public** 키 |
  | `VITE_API_BASE_URL` | `https://bwiwvusjydhnwgewolib.supabase.co/functions/v1/api` |
- 배포 후 그 주소를 **3-2의 Site URL / Redirect URLs**에 반드시 등록.

## 로컬 개발
```bash
cd admin-app
npm install
cp .env.example .env   # 값 채우기 (anon key 등)
npm run dev            # http://localhost:3001
```
(로컬도 `http://localhost:3001`이 Supabase Redirect URLs에 있어야 로그인됨)

---

## 동작
- 구글 로그인 → `admin_users`에 이메일 있으면 통과, 없으면 "승인되지 않은 계정" 화면.
- 병원 선택 + 상태 탭(처리 대기 / 확정 / 거절 / 취소 / 전체).
- **처리 대기**: 신규 예약 · 시간 변경 요청 · 동반자 추가에 **확정/거절** 버튼.
- 확정/거절 시 기존 로직대로 **고객에게 LINE 알림** 발송 (동반자 추가 거절은 그 동반자만, 기존 예약 유지).
