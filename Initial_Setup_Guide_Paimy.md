# 초기 설정 가이드: Paimy

## 1. 개요

### 1.1 목적
본 문서는 Paimy를 사내 환경에 배포하기 위한 초기 설정 절차를 안내한다.

### 1.2 설정 순서

```
[1] Supabase 프로젝트 생성
        ↓
[2] Slack 앱 생성 및 설정
        ↓
[3] Notion Integration 설정
        ↓
[4] Google Service Account 설정
        ↓
[5] Vercel 프로젝트 배포
        ↓
[6] ID 매핑 데이터 등록
        ↓
[7] 동작 테스트
```

### 1.3 필요 권한

| 플랫폼 | 필요 권한 |
|--------|----------|
| Slack | 워크스페이스 앱 설치 권한 (Admin) |
| Notion | 워크스페이스 Integration 생성 권한 (Admin) |
| Google Workspace | 서비스 계정 생성 + 도메인 전체 위임 설정 권한 (Super Admin) |
| Supabase | 프로젝트 생성 권한 |
| Vercel | 프로젝트 배포 권한 |

---

## 2. Supabase 설정

### 2.1 프로젝트 생성

1. [Supabase Dashboard](https://supabase.com/dashboard) 접속
2. **New Project** 클릭
3. 프로젝트 정보 입력:
   - Name: `paimy`
   - Database Password: 안전한 비밀번호 생성 및 저장
   - Region: `Northeast Asia (Seoul)` 권장
4. **Create new project** 클릭

### 2.2 테이블 생성

**SQL Editor**에서 아래 쿼리 실행:

```sql
-- 1. user_mappings 테이블
CREATE TABLE user_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slack_id VARCHAR(20) UNIQUE NOT NULL,
  slack_username VARCHAR(100),
  slack_display_name VARCHAR(100),
  notion_id VARCHAR(50),
  notion_name VARCHAR(100),
  google_email VARCHAR(100),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_user_mappings_slack_id ON user_mappings(slack_id);
CREATE INDEX idx_user_mappings_notion_id ON user_mappings(notion_id);
CREATE INDEX idx_user_mappings_google_email ON user_mappings(google_email);

-- 2. conversation_context 테이블
CREATE TABLE conversation_context (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slack_thread_ts VARCHAR(50) UNIQUE NOT NULL,
  slack_channel_id VARCHAR(20) NOT NULL,
  slack_user_id VARCHAR(20) NOT NULL,
  last_task_id VARCHAR(50),
  last_task_name VARCHAR(200),
  last_event_id VARCHAR(100),
  last_email_id VARCHAR(100),
  context_data JSONB,
  expires_at TIMESTAMP DEFAULT (NOW() + INTERVAL '24 hours'),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_conversation_context_thread ON conversation_context(slack_thread_ts);

-- 3. notification_settings 테이블
CREATE TABLE notification_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slack_id VARCHAR(20) UNIQUE NOT NULL,
  morning_briefing BOOLEAN DEFAULT true,
  reminder_24h BOOLEAN DEFAULT true,
  reminder_3h BOOLEAN DEFAULT true,
  meeting_reminder BOOLEAN DEFAULT true,
  quiet_hours_start TIME,
  quiet_hours_end TIME,
  created_at TIMESTAMP DEFAULT NOW()
);

-- 4. task_event_mapping 테이블 (태스크-일정 연결)
CREATE TABLE task_event_mapping (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  notion_task_id VARCHAR(50) NOT NULL,
  google_event_id VARCHAR(100) NOT NULL,
  relationship_type VARCHAR(20) DEFAULT 'related',  -- 'related', 'created_from', 'follow_up'
  created_at TIMESTAMP DEFAULT NOW(),
  
  UNIQUE(notion_task_id, google_event_id)
);

CREATE INDEX idx_task_event_mapping_task ON task_event_mapping(notion_task_id);
CREATE INDEX idx_task_event_mapping_event ON task_event_mapping(google_event_id);

-- 5. task_source_mapping 테이블 (태스크 출처 추적)
CREATE TABLE task_source_mapping (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  notion_task_id VARCHAR(50) UNIQUE NOT NULL,
  source_type VARCHAR(20) NOT NULL,        -- 'gmail', 'slack', 'calendar', 'manual'
  source_id VARCHAR(200),                  -- Gmail message ID, Slack thread ts 등
  source_url TEXT,                         -- 원본 링크
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_task_source_mapping_task ON task_source_mapping(notion_task_id);
CREATE INDEX idx_task_source_mapping_source ON task_source_mapping(source_type, source_id);

-- 6. 만료된 컨텍스트 자동 삭제 함수 (선택)
CREATE OR REPLACE FUNCTION delete_expired_context()
RETURNS void AS $$
BEGIN
  DELETE FROM conversation_context WHERE expires_at < NOW();
END;
$$ LANGUAGE plpgsql;
```

### 2.3 API 키 확인

1. **Settings** → **API** 이동
2. 다음 값 복사 및 저장:
   - `Project URL` → `SUPABASE_URL`
   - `service_role` (secret) → `SUPABASE_SERVICE_KEY`

> ⚠️ `service_role` 키는 절대 클라이언트에 노출하지 마세요.

---

## 3. Slack 앱 설정

### 3.1 앱 생성

1. [Slack API Apps](https://api.slack.com/apps) 접속
2. **Create New App** → **From scratch** 선택
3. 앱 정보 입력:
   - App Name: `Paimy`
   - Workspace: 사내 워크스페이스 선택
4. **Create App** 클릭

### 3.2 Bot 설정

**OAuth & Permissions** 메뉴:

1. **Scopes** → **Bot Token Scopes** 추가:

```
channels:history      # 공개 채널 메시지 읽기
channels:read         # 채널 목록 조회
chat:write           # 메시지 전송
groups:history       # 비공개 채널 메시지 읽기
groups:read          # 비공개 채널 목록
im:history           # DM 메시지 읽기
im:read              # DM 목록
im:write             # DM 전송
users:read           # 사용자 정보 조회
users:read.email     # 사용자 이메일 조회
```

2. **Install to Workspace** 클릭 → 권한 승인
3. **Bot User OAuth Token** 복사 → `SLACK_BOT_TOKEN`

### 3.3 Event Subscriptions 설정

**Event Subscriptions** 메뉴:

1. **Enable Events** 활성화
2. **Request URL** 입력:
   ```
   https://your-app.vercel.app/api/slack/events
   ```
   > Vercel 배포 후 실제 URL로 교체
3. **Subscribe to bot events** 추가:

```
app_mention          # @Paimy 멘션
message.channels     # 채널 메시지 (봇이 참여한)
message.groups       # 비공개 채널 메시지
message.im           # DM 메시지
```

4. **Save Changes** 클릭

### 3.4 Interactivity 설정 (버튼 사용 시)

**Interactivity & Shortcuts** 메뉴:

1. **Interactivity** 활성화
2. **Request URL** 입력:
   ```
   https://your-app.vercel.app/api/slack/interactions
   ```
3. **Save Changes** 클릭

### 3.5 Signing Secret 확인

**Basic Information** 메뉴:

1. **App Credentials** → **Signing Secret** 복사
2. → `SLACK_SIGNING_SECRET`

### 3.6 앱 설정 요약

| 환경 변수 | 값 위치 |
|----------|--------|
| `SLACK_BOT_TOKEN` | OAuth & Permissions → Bot User OAuth Token |
| `SLACK_SIGNING_SECRET` | Basic Information → Signing Secret |

---

## 4. Notion Integration 설정

### 4.1 Integration 생성

1. [Notion Integrations](https://www.notion.so/my-integrations) 접속
2. **New integration** 클릭
3. 설정 입력:
   - Name: `Paimy`
   - Associated workspace: 사내 워크스페이스 선택
   - Logo: (선택) Paimy 로고 업로드
4. **Submit** 클릭

### 4.2 Capabilities 설정

**Capabilities** 탭:

| 항목 | 설정 |
|------|------|
| Read content | ✅ |
| Update content | ✅ |
| Insert content | ✅ |
| Read user information including email | ✅ |

**Save changes** 클릭

### 4.3 Integration Token 복사

**Secrets** 탭:

1. **Internal Integration Secret** 복사
2. → `NOTION_INTEGRATION_TOKEN`

### 4.4 데이터베이스 연결

Paimy가 접근할 **태스크 데이터베이스**에 Integration 연결:

1. 노션에서 태스크 DB 페이지 열기
2. 우측 상단 **···** → **Connections** → **Connect to** → `Paimy` 선택
3. **Confirm** 클릭

### 4.5 데이터베이스 ID 확인

태스크 DB URL에서 ID 추출:

```
https://www.notion.so/workspace/태스크-DB-{DATABASE_ID}?v=...
                                    ↑ 이 부분 (32자리)
```

→ `NOTION_TASK_DATABASE_ID`

### 4.6 노션 설정 요약

| 환경 변수 | 값 위치 |
|----------|--------|
| `NOTION_INTEGRATION_TOKEN` | Integration → Secrets |
| `NOTION_TASK_DATABASE_ID` | 태스크 DB URL에서 추출 |

### 4.7 미팅 DB 설정 (선택적)

태스크-미팅 연결 기능을 사용하려면 노션에 별도의 미팅 DB를 생성한다.

1. 노션에서 새 데이터베이스 생성
2. 다음 속성 추가:

| 속성명 | 타입 | 설명 |
|--------|------|------|
| 미팅명 | 제목 | 미팅 제목 |
| 일시 | 날짜 | 미팅 시작 시간 |
| 참석자 | 사람(다중) | 미팅 참석자 |
| Calendar Event ID | 텍스트 | Google Calendar 이벤트 ID |
| 관련 태스크 | 관계형 | 태스크 DB와 연결 |
| 회의록 | 텍스트 | 미팅 노트 |

3. Paimy Integration 연결 (4.4와 동일)
4. (선택) 환경 변수 추가: `NOTION_MEETING_DATABASE_ID`

> 📌 이 설정은 선택적이며, 미팅-태스크 연결 기능을 사용하지 않는다면 생략 가능.

---

## 5. Google Workspace 설정

### 5.1 Google Cloud 프로젝트 생성

1. [Google Cloud Console](https://console.cloud.google.com) 접속
2. 프로젝트 선택 드롭다운 → **New Project**
3. 프로젝트 정보 입력:
   - Project name: `paimy`
   - Organization: 회사 조직 선택
4. **Create** 클릭

### 5.2 API 활성화

**APIs & Services** → **Library**에서 다음 API 활성화:

- Google Calendar API
- Gmail API
- Admin SDK API (사용자 목록 조회용, 선택)

각 API 페이지에서 **Enable** 클릭

### 5.3 Service Account 생성

**IAM & Admin** → **Service Accounts**:

1. **Create Service Account** 클릭
2. 정보 입력:
   - Name: `paimy-service`
   - Description: `Paimy PM Assistant Service Account`
3. **Create and Continue** 클릭
4. Role 설정은 건너뛰기 (**Continue** → **Done**)

### 5.4 Service Account 키 생성

1. 생성된 Service Account 클릭
2. **Keys** 탭 → **Add Key** → **Create new key**
3. **JSON** 선택 → **Create**
4. JSON 파일 다운로드 (안전하게 보관)

JSON 파일 내용:
```json
{
  "type": "service_account",
  "project_id": "paimy-xxxxxx",
  "private_key_id": "...",
  "private_key": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n",
  "client_email": "paimy-service@paimy-xxxxxx.iam.gserviceaccount.com",
  "client_id": "...",
  ...
}
```

필요한 값:
- `client_email` → `GOOGLE_SERVICE_ACCOUNT_EMAIL`
- `private_key` → `GOOGLE_PRIVATE_KEY`

### 5.5 Domain-wide Delegation 설정

#### 5.5.1 Service Account에서 활성화

1. Service Account 상세 페이지
2. **Show Advanced Settings** 클릭
3. **Domain-wide Delegation** → **Enable G Suite Domain-wide Delegation** 체크
4. **Save** 클릭
5. **Client ID** 복사 (숫자 문자열)

#### 5.5.2 Google Workspace Admin에서 승인

1. [Google Admin Console](https://admin.google.com) 접속 (Super Admin 권한 필요)
2. **Security** → **Access and data control** → **API controls**
3. **Manage Domain Wide Delegation** 클릭
4. **Add new** 클릭
5. 정보 입력:
   - Client ID: (위에서 복사한 Client ID)
   - OAuth scopes:
     ```
     https://www.googleapis.com/auth/calendar,
     https://www.googleapis.com/auth/calendar.events,
     https://www.googleapis.com/auth/gmail.readonly
     ```
6. **Authorize** 클릭

### 5.6 위임 대상 사용자 설정

Service Account가 사용자를 대신하여 API를 호출할 때 사용할 기본 계정:

→ `GOOGLE_DELEGATED_USER_EMAIL` (예: `admin@company.com`)

> 이 계정은 도메인 내 모든 사용자의 캘린더/메일에 접근하는 기준점 역할

### 5.7 Google 설정 요약

| 환경 변수 | 값 위치 |
|----------|--------|
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | Service Account JSON → client_email |
| `GOOGLE_PRIVATE_KEY` | Service Account JSON → private_key |
| `GOOGLE_DELEGATED_USER_EMAIL` | 도메인 관리자 이메일 |

---

## 6. Vercel 배포

### 6.1 프로젝트 준비

프로젝트 구조:
```
paimy/
├── api/
│   ├── slack/
│   │   ├── events.ts
│   │   └── interactions.ts
│   ├── cron/
│   │   ├── morning-briefing.ts
│   │   ├── reminder-check.ts
│   │   └── weekly-report.ts
│   └── health.ts
├── lib/
│   ├── slack/
│   ├── llm/
│   ├── mcp/
│   └── db/
├── vercel.json
├── package.json
├── tsconfig.json
└── .env.local (로컬 테스트용)
```

### 6.2 vercel.json 설정

```json
{
  "crons": [
    {
      "path": "/api/cron/morning-briefing",
      "schedule": "0 0 * * *"
    },
    {
      "path": "/api/cron/reminder-check",
      "schedule": "0 * * * *"
    },
    {
      "path": "/api/cron/weekly-report",
      "schedule": "0 0 * * 1"
    }
  ]
}
```

> ⏰ 시간은 UTC 기준. KST 09:00 = UTC 00:00

### 6.3 Vercel 프로젝트 생성

1. [Vercel Dashboard](https://vercel.com/dashboard) 접속
2. **Add New** → **Project**
3. Git 저장소 연결 또는 직접 업로드
4. **Deploy** 클릭

### 6.4 환경 변수 설정

**Settings** → **Environment Variables**에서 추가:

| 변수명 | 값 |
|--------|-----|
| `SLACK_BOT_TOKEN` | xoxb-... |
| `SLACK_SIGNING_SECRET` | ... |
| `SUPABASE_URL` | https://xxx.supabase.co |
| `SUPABASE_SERVICE_KEY` | eyJ... |
| `NOTION_INTEGRATION_TOKEN` | secret_... |
| `NOTION_TASK_DATABASE_ID` | ... |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | ...@...iam.gserviceaccount.com |
| `GOOGLE_PRIVATE_KEY` | -----BEGIN PRIVATE KEY----- ... |
| `GOOGLE_DELEGATED_USER_EMAIL` | admin@company.com |
| `ANTHROPIC_API_KEY` | sk-ant-... |

> ⚠️ `GOOGLE_PRIVATE_KEY`는 줄바꿈 포함. Vercel에서는 그대로 붙여넣기 가능.

### 6.5 배포 URL 확인

배포 완료 후 URL 확인:
```
https://paimy-xxx.vercel.app
```

### 6.6 Slack URL 업데이트

Slack 앱 설정에서 URL 업데이트:

1. **Event Subscriptions** → Request URL:
   ```
   https://paimy-xxx.vercel.app/api/slack/events
   ```
2. **Interactivity** → Request URL:
   ```
   https://paimy-xxx.vercel.app/api/slack/interactions
   ```

---

## 7. ID 매핑 데이터 등록

### 7.1 데이터 수집

#### Slack 사용자 목록

Slack API 또는 Admin에서 내보내기:
```bash
# Slack API 호출 (Bot Token 필요)
curl -H "Authorization: Bearer xoxb-..." \
  https://slack.com/api/users.list
```

필요 정보: `id`, `name`, `profile.display_name`, `profile.email`

#### Notion 사용자 목록

Notion API 호출:
```bash
curl -H "Authorization: Bearer secret_..." \
  -H "Notion-Version: 2022-06-28" \
  https://api.notion.com/v1/users
```

필요 정보: `id`, `name`, `person.email`

### 7.2 매핑 CSV 작성

```csv
slack_id,slack_username,slack_display_name,notion_id,notion_name,google_email
U01ABC2DEF3,chaewook.kim,김채욱,a1b2c3d4-e5f6-7890-abcd-ef1234567890,김채욱,chaewook@company.com
U02DEF4GHI5,sujin.lee,이수진,b2c3d4e5-f6a7-8901-bcde-f23456789012,이수진,sujin@company.com
U03GHI6JKL7,jihun.park,박지훈,c3d4e5f6-a7b8-9012-cdef-345678901234,박지훈,jihun@company.com
```

### 7.3 Supabase에 Import

1. Supabase Dashboard → **Table Editor** → `user_mappings`
2. **Insert** → **Import data from CSV**
3. CSV 파일 업로드
4. 컬럼 매핑 확인 → **Import**

### 7.4 매핑 검증

```sql
-- 전체 매핑 확인
SELECT * FROM user_mappings WHERE is_active = true;

-- 매핑 누락 확인 (notion_id가 없는 경우)
SELECT * FROM user_mappings WHERE notion_id IS NULL;
```

---

## 8. 동작 테스트

### 8.1 기본 연결 테스트

#### Health Check
```bash
curl https://paimy-xxx.vercel.app/api/health
# 응답: {"status":"ok"}
```

#### Slack 이벤트 수신 확인
1. Slack에서 `@Paimy` 멘션
2. Vercel Function Logs에서 이벤트 수신 확인

### 8.2 기능 테스트 체크리스트

| 테스트 | 명령어 | 예상 결과 |
|--------|--------|----------|
| 태스크 조회 | "@Paimy 내 태스크 보여줘" | 본인 태스크 목록 응답 |
| 태스크 상태 변경 | "@Paimy 이거 완료 처리해줘" | 상태 변경 + 확인 메시지 |
| 일정 조회 | "@Paimy 오늘 일정 뭐야?" | 오늘 캘린더 일정 응답 |
| 일정 생성 | "@Paimy 내일 3시에 팀 미팅 잡아줘" | 미팅 생성 + 확인 |
| 메일 조회 | "@Paimy 오늘 온 메일 정리해줘" | 메일 요약 응답 |
| 에러 처리 | "@Paimy 없는사람 태스크" | 적절한 에러 메시지 |

### 8.3 Cron 테스트

Vercel Dashboard → **Functions** → 해당 Cron 함수 → **Invoke** 버튼으로 수동 실행

### 8.4 트러블슈팅

| 증상 | 원인 | 해결 |
|------|------|------|
| Slack 이벤트 미수신 | URL 미설정 또는 잘못됨 | Event Subscriptions URL 확인 |
| 노션 조회 실패 | Integration 미연결 | DB에 Paimy Integration 연결 확인 |
| 캘린더 접근 오류 | Domain Delegation 미설정 | Google Admin에서 승인 확인 |
| 사용자 못 찾음 | 매핑 누락 | user_mappings 테이블 확인 |
| 타임아웃 | Vercel 함수 실행 시간 초과 | 로직 최적화 또는 Plan 업그레이드 |

---

## 9. 환경 변수 전체 목록

```env
# Slack
SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_SIGNING_SECRET=your-signing-secret

# Supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=your-service-role-key

# Notion
NOTION_INTEGRATION_TOKEN=secret_your-integration-token
NOTION_TASK_DATABASE_ID=your-database-id

# Google
GOOGLE_SERVICE_ACCOUNT_EMAIL=your-service@project.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
GOOGLE_DELEGATED_USER_EMAIL=admin@company.com

# Claude
ANTHROPIC_API_KEY=sk-ant-your-api-key
```

---

## 10. 설정 체크리스트

### 10.1 Supabase
- [ ] 프로젝트 생성
- [ ] 테이블 5개 생성 (user_mappings, conversation_context, notification_settings, task_event_mapping, task_source_mapping)
- [ ] API URL 및 Service Key 확보

### 10.2 Slack
- [ ] 앱 생성
- [ ] Bot Token Scopes 설정
- [ ] Event Subscriptions 설정
- [ ] 워크스페이스에 앱 설치
- [ ] Bot Token 및 Signing Secret 확보

### 10.3 Notion
- [ ] Integration 생성
- [ ] Capabilities 설정 (Read, Update, Insert, User email)
- [ ] 태스크 DB에 Integration 연결
- [ ] Token 및 Database ID 확보

### 10.4 Google
- [ ] Cloud 프로젝트 생성
- [ ] Calendar API, Gmail API 활성화
- [ ] Service Account 생성
- [ ] JSON 키 다운로드
- [ ] Domain-wide Delegation 활성화 (Service Account)
- [ ] Google Admin에서 OAuth Scopes 승인

### 10.5 Vercel
- [ ] 프로젝트 배포
- [ ] 환경 변수 설정 (10개)
- [ ] Cron Jobs 활성화 확인

### 10.6 데이터
- [ ] 사용자 매핑 CSV 작성
- [ ] Supabase에 Import
- [ ] 매핑 검증

### 10.7 테스트
- [ ] Health Check 통과
- [ ] Slack 이벤트 수신 확인
- [ ] 주요 기능 테스트 완료

---

## 11. 운영 참고사항

### 11.1 비용 예상 (무료 티어 기준)

| 서비스 | 무료 한도 | 예상 사용량 |
|--------|----------|------------|
| Vercel | 100GB bandwidth, 100시간 함수 | 충분 |
| Supabase | 500MB DB, 2GB bandwidth | 충분 |
| Claude API | 사용량 기반 과금 | ~$10-50/월 (팀 규모별) |
| Slack | 무료 | - |
| Notion | 무료/팀플랜 | - |
| Google | 무료 (Workspace 포함) | - |

### 11.2 보안 권장사항

- 환경 변수는 Vercel에만 저장, 코드에 포함 금지
- Service Account JSON 파일 Git 커밋 금지 (.gitignore)
- Slack Signing Secret으로 요청 검증 필수
- Supabase Service Key는 서버 사이드에서만 사용

---
