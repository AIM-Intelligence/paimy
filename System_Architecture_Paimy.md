# 시스템 아키텍처 설계서: Paimy

## 1. 개요

### 1.1 목적
본 문서는 사내 AI PM 어시스턴트 Paimy의 시스템 아키텍처를 정의한다.

### 1.2 기술 스택 요약

| 레이어 | 기술 | 용도 |
|--------|------|------|
| Frontend | Slack | 사용자 인터페이스 (유일한 접점) |
| Backend | Vercel (Serverless) | API Routes, Cron Jobs, Core Logic |
| Database | Supabase (PostgreSQL) | 매핑 테이블, 설정, 컨텍스트 저장 |
| AI | Claude Sonnet 4.5 | 자연어 이해, Tool Use, 응답 생성 |
| Integration | MCP Servers | Notion, Google Calendar, Gmail 연동 |

---

## 2. 시스템 구성도

```
┌─────────────────────────────────────────────────────────────────────┐
│                         User Layer                                   │
│                      👤 사내 사용자 (Slack)                          │
└─────────────────────────────────┬───────────────────────────────────┘
                                  │ Slack Events & Messages
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      Interface Layer                                 │
│                   💬 Slack Workspace (@Paimy Bot)                    │
└─────────────────────────────────┬───────────────────────────────────┘
                                  │ Webhook / Web API
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    Application Layer (Vercel)                        │
│  ┌──────────────────┬────────────────────┬───────────────────┐      │
│  │   API Routes     │    Core Logic      │    Cron Jobs      │      │
│  │                  │                    │                   │      │
│  │ /api/slack/      │ • Message Parser   │ • 09:00 브리핑    │      │
│  │   events         │ • LLM Orchestrator │ • 매시 리마인드   │      │
│  │ /api/slack/      │ • Tool Executor    │ • 월 주간리포트   │      │
│  │   interactions   │                    │                   │      │
│  └──────────────────┴────────────────────┴───────────────────┘      │
└───────────┬─────────────────────┬─────────────────────┬─────────────┘
            │                     │                     │
            ▼                     ▼                     ▼
┌───────────────────┐  ┌───────────────────┐  ┌───────────────────┐
│   Data Layer      │  │ Integration Layer │  │    AI Layer       │
│   (Supabase)      │  │   (MCP Servers)   │  │   (Claude API)    │
│                   │  │                   │  │                   │
│ • user_mappings   │  │ • Notion MCP      │  │ • 자연어 이해     │
│ • conversation_   │  │ • Calendar MCP    │  │ • Tool Use        │
│   context         │  │ • Gmail MCP       │  │ • 응답 생성       │
│ • notification_   │  │                   │  │                   │
│   settings        │  │                   │  │                   │
└───────────────────┘  └─────────┬─────────┘  └───────────────────┘
                                 │
                                 ▼
                    ┌───────────────────────────┐
                    │    External Services      │
                    │                           │
                    │  📋 Notion (Task DB)      │
                    │  📅 Google Calendar       │
                    │  📧 Gmail                 │
                    └───────────────────────────┘
```

---

## 3. 레이어별 상세 설계

### 3.1 Application Layer (Vercel)

Vercel Serverless Functions를 활용하여 모든 백엔드 로직을 처리한다.

#### 3.1.1 API Routes

| 엔드포인트 | 메서드 | 용도 |
|------------|--------|------|
| `/api/slack/events` | POST | Slack Event Subscriptions 수신 (멘션, DM 등) |
| `/api/slack/interactions` | POST | Slack Interactive Components (버튼 클릭 등) |
| `/api/health` | GET | 헬스체크 |

#### 3.1.2 Core Logic 모듈

```
/lib
├── slack/
│   ├── parser.ts        # 슬랙 메시지 파싱
│   ├── responder.ts     # 슬랙 응답 전송
│   └── formatter.ts     # 메시지 포맷팅 (Block Kit)
├── llm/
│   ├── orchestrator.ts  # Claude API 호출 관리
│   ├── prompts.ts       # 시스템 프롬프트 정의
│   └── tools.ts         # Tool Use 함수 스키마
├── mcp/
│   ├── notion.ts        # Notion MCP 클라이언트
│   ├── calendar.ts      # Google Calendar MCP 클라이언트
│   └── gmail.ts         # Gmail MCP 클라이언트
└── db/
    └── supabase.ts      # Supabase 클라이언트
```

#### 3.1.3 Cron Jobs (Vercel Cron)

`vercel.json` 설정:

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

> 참고: 시간은 UTC 기준. KST 09:00 = UTC 00:00

---

### 3.2 Data Layer (Supabase)

#### 3.2.1 테이블 스키마

**user_mappings**
```sql
CREATE TABLE user_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Slack 정보
  slack_id VARCHAR(20) UNIQUE NOT NULL,
  slack_username VARCHAR(100),
  slack_display_name VARCHAR(100),
  
  -- Notion 정보
  notion_id VARCHAR(50),
  notion_name VARCHAR(100),
  
  -- Google 정보
  google_email VARCHAR(100),
  
  -- 메타데이터
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_user_mappings_slack_id ON user_mappings(slack_id);
CREATE INDEX idx_user_mappings_notion_id ON user_mappings(notion_id);
CREATE INDEX idx_user_mappings_google_email ON user_mappings(google_email);
```

**conversation_context**
```sql
CREATE TABLE conversation_context (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slack_thread_ts VARCHAR(50) UNIQUE NOT NULL,
  slack_channel_id VARCHAR(20) NOT NULL,
  slack_user_id VARCHAR(20) NOT NULL,
  
  -- 마지막으로 언급된 항목들
  last_task_id VARCHAR(50),
  last_task_name VARCHAR(200),
  last_event_id VARCHAR(100),
  last_email_id VARCHAR(100),
  
  -- 대화 맥락 데이터 (유연한 확장용)
  context_data JSONB,
  
  -- TTL
  expires_at TIMESTAMP DEFAULT (NOW() + INTERVAL '24 hours'),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_conversation_context_thread ON conversation_context(slack_thread_ts);
```

**notification_settings**
```sql
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
```

**task_event_mapping** (태스크-일정 연결)
```sql
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
```

**task_source_mapping** (태스크 출처 추적)
```sql
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
```

#### 3.2.2 노션 미팅 DB (선택적)

태스크-미팅 연결 기능을 사용하려면 노션에 별도의 **미팅 DB**를 생성해야 한다. 이 DB는 Google Calendar 이벤트와 노션 태스크를 연결하는 역할을 한다.

| 속성명 | 타입 | 필수 | 설명 |
|--------|------|------|------|
| 미팅명 | 제목 | ✅ | 미팅 제목 |
| 일시 | 날짜 | ✅ | 미팅 시작 시간 |
| 참석자 | 사람(다중) | - | 미팅 참석자 |
| Calendar Event ID | 텍스트 | - | Google Calendar 이벤트 ID |
| 관련 태스크 | 관계형 | - | 태스크 DB와 연결 |
| 회의록 | 텍스트 | - | 미팅 노트 |

> 📌 이 DB는 선택적이며, 미팅-태스크 연결 기능을 사용하지 않는다면 생략 가능.

#### 3.2.3 Supabase 사용 이유

- **실시간 기능**: 향후 실시간 알림 확장 가능
- **Row Level Security**: 필요시 권한 관리 용이
- **PostgreSQL**: 복잡한 쿼리 지원
- **무료 티어**: 사내용 소규모 사용에 적합

---

### 3.3 Integration Layer (MCP Servers)

Model Context Protocol을 통해 외부 서비스와 연동한다.

#### 3.3.1 MCP 구성 옵션

**옵션 A: 기존 MCP 서버 활용**
- `@modelcontextprotocol/server-notion`
- `@anthropic/mcp-server-google-calendar` (또는 커스텀)
- 커스텀 Gmail MCP 서버

**옵션 B: 통합 MCP 서버 직접 구현**
- Vercel 내에서 MCP 프로토콜 직접 구현
- 단일 서버로 Notion, Calendar, Gmail 모두 처리

#### 3.3.2 연동 방식

| 서비스 | 인증 방식 | 비고 |
|--------|----------|------|
| Notion | Internal Integration Token | 팀 워크스페이스 전체 접근 |
| Google Calendar | Service Account + Domain-wide Delegation | 도메인 내 모든 사용자 캘린더 접근 |
| Gmail | Service Account + Domain-wide Delegation | 도메인 내 모든 사용자 메일 접근 |

---

### 3.4 AI Layer (Claude Sonnet 4.5)

#### 3.4.1 모델 선택 이유

| 기준 | Claude Sonnet 4.5 |
|------|-------------------|
| Tool Calling 성능 | BFCL 벤치마크 70.29% (상위권) |
| MCP 호환성 | 네이티브 지원 (Anthropic이 MCP 창시) |
| 에이전트 안정성 | SWE-bench 77.2%, 장기 태스크 안정적 수행 |
| 한국어 지원 | 자연스러운 대화체 |
| 비용 | $3/$15 per 1M tokens (월 $100-300 예상) |

#### 3.4.2 호출 흐름

```
사용자 메시지
    ↓
[전처리] Slack 메시지 파싱 + 컨텍스트 로드
    ↓
[Claude API] 시스템 프롬프트 + 사용자 메시지 + Tools
    ↓
[Tool Use?] ─── Yes ──→ MCP 서버 호출 → 결과 반환 → Claude 재호출
    │
    No
    ↓
[응답 생성] 최종 텍스트 응답
    ↓
[후처리] Slack Block Kit 포맷팅 → 전송
```

#### 3.4.3 Tool Use 함수 목록

```typescript
const tools = [
  // Notion
  { name: "get_tasks", description: "태스크 조회" },
  { name: "get_task_detail", description: "태스크 상세 조회" },
  { name: "update_task", description: "태스크 상태/속성 변경" },
  { name: "create_task", description: "새 태스크 생성" },
  
  // Calendar
  { name: "get_calendar_events", description: "일정 조회" },
  { name: "create_calendar_event", description: "일정 생성" },
  { name: "update_calendar_event", description: "일정 수정" },
  { name: "delete_calendar_event", description: "일정 삭제" },
  { name: "check_availability", description: "가용 시간 확인" },
  
  // Gmail
  { name: "get_emails", description: "메일 조회" },
  { name: "get_email_detail", description: "메일 상세 조회" },
  { name: "extract_action_items", description: "메일에서 액션 아이템 추출" },
  
  // Cross-platform
  { name: "create_task_from_email", description: "메일 → 태스크 생성" },
  { name: "create_meeting_for_task", description: "태스크 → 미팅 생성" },
  { name: "generate_daily_briefing", description: "통합 브리핑 생성" },
];
```

---

## 4. 데이터 흐름

### 4.1 Pull 흐름 (사용자 요청 → 응답)

```
[1] 사용자: "@Paimy 이번 주 마감인 내 태스크 보여줘"
                    │
[2] Slack ─────────▶ Vercel /api/slack/events
                    │
[3] Vercel ────────▶ Supabase: user_mapping 조회 (slack_id → notion_id)
                    │
[4] Vercel ────────▶ Claude API: 의도 분석
                    │  └─ Tool 결정: get_tasks(owner=notion_id, due_date=this_week)
                    │
[5] Vercel ────────▶ MCP Notion: 태스크 조회
                    │
[6] MCP ───────────▶ Notion API → 결과 반환
                    │
[7] Vercel ────────▶ Claude API: 결과 요약 및 응답 생성
                    │
[8] Vercel ────────▶ Slack: 응답 메시지 전송
                    │
[9] 사용자: "📋 이번 주 마감 태스크 3건..."
```

### 4.2 Push 흐름 (스케줄 → 알림 발송)

```
[1] Vercel Cron: 09:00 (KST) 트리거
                    │
[2] Vercel ────────▶ Supabase: 브리핑 활성 사용자 목록 조회
                    │
[3] For each user:
    │
    ├──▶ MCP Notion: 오늘 마감 태스크 조회
    ├──▶ MCP Calendar: 오늘 일정 조회
    ├──▶ MCP Gmail: 미읽은 중요 메일 조회
    │
[4] Vercel ────────▶ Claude API: 브리핑 메시지 생성
                    │
[5] Vercel ────────▶ Slack: 사용자 DM으로 발송
```

---

## 5. 환경 변수

```env
# Slack
SLACK_BOT_TOKEN=xoxb-...
SLACK_SIGNING_SECRET=...

# Supabase
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_KEY=...

# Claude
ANTHROPIC_API_KEY=sk-ant-...

# Notion
NOTION_INTEGRATION_TOKEN=secret_...
NOTION_TASK_DATABASE_ID=...

# Google (Service Account)
GOOGLE_SERVICE_ACCOUNT_EMAIL=...@...iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----...
GOOGLE_DELEGATED_USER_EMAIL=admin@company.com  # 도메인 위임용
```

---

## 6. 배포 구성

### 6.1 Vercel 프로젝트 구조

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
└── .env.local
```

### 6.2 배포 플로우

```
main branch push
      │
      ▼
  Vercel CI/CD
      │
      ├── Build & Deploy
      ├── Environment Variables (Vercel Dashboard)
      └── Cron Jobs 활성화
```

---

## 7. 확장성 고려사항

### 7.1 현재 구조의 한계

- Vercel Serverless 함수 실행 시간 제한 (Pro: 60초, Hobby: 10초)
- Cron Jobs 최소 간격 1분 (Vercel Pro 필요)

### 7.2 향후 확장 방안

| 상황 | 대응 |
|------|------|
| 처리 시간 초과 | Vercel Background Functions 또는 외부 큐(Upstash) 활용 |
| 실시간 알림 필요 | Supabase Realtime + Slack Socket Mode |
| 트래픽 급증 | Edge Functions 활용, Caching 강화 |

---

## 8. 모니터링 및 로깅

### 8.1 Vercel 기본 제공

- Function Logs (실시간)
- Analytics (요청 수, 응답 시간)
- Error Tracking

### 8.2 추가 권장

- Supabase에 `logs` 테이블 생성하여 주요 이벤트 기록
- Slack에 `#paimy-logs` 채널 생성하여 에러 알림

---
