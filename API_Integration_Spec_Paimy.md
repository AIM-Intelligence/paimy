# API 연동 명세서: Paimy

## 1. 개요

### 1.1 목적
본 문서는 Paimy가 연동하는 외부 API들의 상세 호출 방법을 정의한다.

### 1.2 연동 API 목록

| 서비스 | 용도 | 인증 방식 |
|--------|------|----------|
| Slack Web API | 메시지 수신/발송, 사용자 조회 | Bot Token |
| Notion API | 태스크 CRUD, 사용자 조회 | Integration Token |
| Google Calendar API | 일정 CRUD, 가용 시간 확인 | Service Account + Domain Delegation |
| Gmail API | 메일 조회, 검색 | Service Account + Domain Delegation |
| Claude API | 자연어 이해, Tool Use | API Key |

---

## 2. Slack API

### 2.1 인증

**Header:**
```
Authorization: Bearer {SLACK_BOT_TOKEN}
Content-Type: application/json
```

**요청 검증 (수신 시):**
```typescript
import crypto from 'crypto';

function verifySlackRequest(
  signingSecret: string,
  signature: string,
  timestamp: string,
  body: string
): boolean {
  const baseString = `v0:${timestamp}:${body}`;
  const hmac = crypto.createHmac('sha256', signingSecret);
  const expectedSignature = `v0=${hmac.update(baseString).digest('hex')}`;
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );
}
```

### 2.2 이벤트 수신

**Endpoint:** `POST /api/slack/events` (Paimy 서버)

**Event Payload 구조:**
```json
{
  "type": "event_callback",
  "event": {
    "type": "app_mention",
    "user": "U01ABC2DEF3",
    "text": "<@U0PAIMY> 내 태스크 보여줘",
    "channel": "C01CHANNEL1",
    "ts": "1234567890.123456",
    "thread_ts": "1234567890.123456"
  }
}
```

**이벤트 타입별 처리:**

| event.type | 설명 | 처리 |
|------------|------|------|
| `app_mention` | @Paimy 멘션 | 메시지 파싱 → LLM 처리 |
| `message` (im) | DM 메시지 | 메시지 파싱 → LLM 처리 |
| `message` (channel) | 채널 메시지 | 봇 멘션 포함 시만 처리 |

**Challenge 응답 (최초 URL 검증):**
```json
// Request
{ "type": "url_verification", "challenge": "abc123" }

// Response
{ "challenge": "abc123" }
```

### 2.3 메시지 발송

**Endpoint:** `POST https://slack.com/api/chat.postMessage`

**Request:**
```json
{
  "channel": "C01CHANNEL1",
  "text": "📋 이번 주 마감 태스크 3건이에요.",
  "thread_ts": "1234567890.123456",
  "blocks": [
    {
      "type": "section",
      "text": {
        "type": "mrkdwn",
        "text": "*📋 이번 주 마감 태스크 3건*"
      }
    },
    {
      "type": "section",
      "text": {
        "type": "mrkdwn",
        "text": "1. *레드티밍 가드레일 검증*\n   마감: 금요일 | 상태: In Progress"
      }
    }
  ]
}
```

**Response:**
```json
{
  "ok": true,
  "channel": "C01CHANNEL1",
  "ts": "1234567890.123457",
  "message": { ... }
}
```

**코드 예시:**
```typescript
async function sendSlackMessage(
  channel: string,
  text: string,
  threadTs?: string,
  blocks?: Block[]
) {
  const response = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.SLACK_BOT_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      channel,
      text,
      thread_ts: threadTs,
      blocks,
    }),
  });
  return response.json();
}
```

### 2.4 DM 발송

**Endpoint:** `POST https://slack.com/api/conversations.open` → `chat.postMessage`

```typescript
async function sendDirectMessage(userId: string, text: string) {
  // 1. DM 채널 열기
  const openRes = await fetch('https://slack.com/api/conversations.open', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.SLACK_BOT_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ users: userId }),
  });
  const { channel } = await openRes.json();
  
  // 2. 메시지 발송
  return sendSlackMessage(channel.id, text);
}
```

### 2.5 사용자 정보 조회

**Endpoint:** `GET https://slack.com/api/users.info?user={user_id}`

**Response:**
```json
{
  "ok": true,
  "user": {
    "id": "U01ABC2DEF3",
    "name": "chaewook.kim",
    "profile": {
      "display_name": "김채욱",
      "email": "chaewook@company.com"
    }
  }
}
```

### 2.6 Rate Limits

| Tier | 제한 | 대상 메서드 |
|------|------|------------|
| Tier 1 | 1 req/min | - |
| Tier 2 | 20 req/min | chat.postMessage |
| Tier 3 | 50 req/min | conversations.list |
| Tier 4 | 100 req/min | users.info |

**Rate Limit 응답:**
```json
{
  "ok": false,
  "error": "ratelimited",
  "retry_after": 30
}
```

---

## 3. Notion API

### 3.1 인증

**Headers:**
```
Authorization: Bearer {NOTION_INTEGRATION_TOKEN}
Notion-Version: 2022-06-28
Content-Type: application/json
```

**Base URL:** `https://api.notion.com/v1`

### 3.2 데이터베이스 쿼리 (태스크 조회)

**Endpoint:** `POST /databases/{database_id}/query`

**Request - 담당자별 조회:**
```json
{
  "filter": {
    "property": "담당자",
    "people": {
      "contains": "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
    }
  },
  "sorts": [
    {
      "property": "마감일",
      "direction": "ascending"
    }
  ],
  "page_size": 10
}
```

**Request - 복합 필터 (이번 주 마감 + 미완료):**
```json
{
  "filter": {
    "and": [
      {
        "property": "마감일",
        "date": {
          "on_or_after": "2024-01-15"
        }
      },
      {
        "property": "마감일",
        "date": {
          "on_or_before": "2024-01-21"
        }
      },
      {
        "property": "상태",
        "select": {
          "does_not_equal": "Done"
        }
      }
    ]
  }
}
```

**Response:**
```json
{
  "object": "list",
  "results": [
    {
      "id": "page-id-1234",
      "properties": {
        "태스크명": {
          "title": [{ "plain_text": "레드티밍 가드레일 검증" }]
        },
        "상태": {
          "select": { "name": "In Progress" }
        },
        "담당자": {
          "people": [{ "id": "person-id", "name": "김채욱" }]
        },
        "마감일": {
          "date": { "start": "2024-01-19" }
        },
        "우선순위": {
          "select": { "name": "High" }
        }
      },
      "url": "https://notion.so/..."
    }
  ],
  "has_more": false,
  "next_cursor": null
}
```

**코드 예시:**
```typescript
async function queryTasks(filter: object, sorts?: object[]) {
  const response = await fetch(
    `https://api.notion.com/v1/databases/${process.env.NOTION_TASK_DATABASE_ID}/query`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.NOTION_INTEGRATION_TOKEN}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ filter, sorts, page_size: 20 }),
    }
  );
  return response.json();
}
```

### 3.3 페이지 조회 (태스크 상세)

**Endpoint:** `GET /pages/{page_id}`

**Response:**
```json
{
  "id": "page-id-1234",
  "properties": {
    "태스크명": { "title": [{ "plain_text": "레드티밍 가드레일 검증" }] },
    "상태": { "select": { "name": "In Progress" } },
    "담당자": { "people": [{ "id": "...", "name": "김채욱" }] },
    "마감일": { "date": { "start": "2024-01-19" } },
    "실행 상세": { "rich_text": [{ "plain_text": "보안 가드레일 성능 지표 추가" }] }
  },
  "url": "https://notion.so/..."
}
```

### 3.4 페이지 수정 (태스크 업데이트)

**Endpoint:** `PATCH /pages/{page_id}`

**Request - 상태 변경:**
```json
{
  "properties": {
    "상태": {
      "select": { "name": "Done" }
    }
  }
}
```

**Request - 담당자 변경:**
```json
{
  "properties": {
    "담당자": {
      "people": [{ "id": "new-person-id" }]
    }
  }
}
```

**Request - 마감일 변경:**
```json
{
  "properties": {
    "마감일": {
      "date": { "start": "2024-01-26" }
    }
  }
}
```

**Request - 텍스트 추가 (실행 상세):**
```json
{
  "properties": {
    "실행 상세": {
      "rich_text": [
        {
          "type": "text",
          "text": { "content": "보안 가드레일 성능 지표 추가" }
        }
      ]
    }
  }
}
```

**코드 예시:**
```typescript
async function updateTask(pageId: string, properties: object) {
  const response = await fetch(
    `https://api.notion.com/v1/pages/${pageId}`,
    {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${process.env.NOTION_INTEGRATION_TOKEN}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ properties }),
    }
  );
  return response.json();
}

// 사용 예
await updateTask('page-id-1234', {
  '상태': { select: { name: 'Done' } }
});
```

### 3.5 페이지 생성 (태스크 생성)

**Endpoint:** `POST /pages`

**Request:**
```json
{
  "parent": {
    "database_id": "your-database-id"
  },
  "properties": {
    "태스크명": {
      "title": [{ "text": { "content": "보고서 초안 작성" } }]
    },
    "상태": {
      "select": { "name": "Backlog" }
    },
    "담당자": {
      "people": [{ "id": "person-id" }]
    },
    "마감일": {
      "date": { "start": "2024-01-20" }
    },
    "우선순위": {
      "select": { "name": "Medium" }
    },
    "소스": {
      "select": { "name": "Gmail" }
    },
    "원본 링크": {
      "url": "https://mail.google.com/..."
    }
  }
}
```

### 3.6 사용자 목록 조회

**Endpoint:** `GET /users`

**Response:**
```json
{
  "results": [
    {
      "id": "a1b2c3d4-...",
      "name": "김채욱",
      "type": "person",
      "person": {
        "email": "chaewook@company.com"
      }
    }
  ]
}
```

### 3.7 Rate Limits

| 요청 유형 | 제한 |
|----------|------|
| 일반 요청 | 3 requests/second (평균) |
| Burst | 최대 짧은 순간 초과 허용 |

**Rate Limit 응답:**
```json
{
  "code": "rate_limited",
  "message": "Rate limited"
}
```

→ `Retry-After` 헤더 확인 후 재시도

---

## 4. Google Calendar API

### 4.1 인증 (Service Account)

```typescript
import { google } from 'googleapis';

function getCalendarClient(userEmail: string) {
  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    },
    scopes: [
      'https://www.googleapis.com/auth/calendar',
      'https://www.googleapis.com/auth/calendar.events',
    ],
    clientOptions: {
      subject: userEmail, // 위임 대상 사용자
    },
  });
  
  return google.calendar({ version: 'v3', auth });
}
```

**Base URL:** `https://www.googleapis.com/calendar/v3`

### 4.2 일정 조회

**Endpoint:** `GET /calendars/{calendarId}/events`

**Parameters:**
| 파라미터 | 설명 |
|----------|------|
| `calendarId` | `primary` 또는 이메일 주소 |
| `timeMin` | 시작 시간 (ISO 8601) |
| `timeMax` | 종료 시간 (ISO 8601) |
| `maxResults` | 최대 개수 |
| `singleEvents` | `true` - 반복 일정 개별 표시 |
| `orderBy` | `startTime` |

**Request:**
```typescript
async function getCalendarEvents(
  userEmail: string,
  timeMin: string,
  timeMax: string,
  maxResults = 10
) {
  const calendar = getCalendarClient(userEmail);
  
  const response = await calendar.events.list({
    calendarId: 'primary',
    timeMin,
    timeMax,
    maxResults,
    singleEvents: true,
    orderBy: 'startTime',
  });
  
  return response.data.items;
}
```

**Response:**
```json
{
  "items": [
    {
      "id": "event-id-123",
      "summary": "팀 스탠드업",
      "start": {
        "dateTime": "2024-01-15T10:00:00+09:00"
      },
      "end": {
        "dateTime": "2024-01-15T11:00:00+09:00"
      },
      "attendees": [
        { "email": "chaewook@company.com", "responseStatus": "accepted" },
        { "email": "sujin@company.com", "responseStatus": "needsAction" }
      ],
      "hangoutLink": "https://meet.google.com/xxx-yyyy-zzz",
      "htmlLink": "https://calendar.google.com/..."
    }
  ]
}
```

### 4.3 일정 생성

**Endpoint:** `POST /calendars/{calendarId}/events`

**Request:**
```typescript
async function createCalendarEvent(
  userEmail: string,
  event: {
    summary: string;
    startTime: string;
    endTime: string;
    attendees?: string[];
    description?: string;
    location?: string;
  }
) {
  const calendar = getCalendarClient(userEmail);
  
  const response = await calendar.events.insert({
    calendarId: 'primary',
    sendUpdates: 'all', // 참석자에게 알림 발송
    requestBody: {
      summary: event.summary,
      start: {
        dateTime: event.startTime,
        timeZone: 'Asia/Seoul',
      },
      end: {
        dateTime: event.endTime,
        timeZone: 'Asia/Seoul',
      },
      attendees: event.attendees?.map(email => ({ email })),
      description: event.description,
      location: event.location,
      conferenceData: {
        createRequest: {
          requestId: `paimy-${Date.now()}`,
          conferenceSolutionKey: { type: 'hangoutsMeet' },
        },
      },
    },
    conferenceDataVersion: 1, // Google Meet 링크 자동 생성
  });
  
  return response.data;
}
```

**Response:**
```json
{
  "id": "new-event-id",
  "summary": "레드티밍 킥오프 미팅",
  "htmlLink": "https://calendar.google.com/...",
  "hangoutLink": "https://meet.google.com/xxx-yyyy-zzz"
}
```

### 4.4 일정 수정

**Endpoint:** `PATCH /calendars/{calendarId}/events/{eventId}`

```typescript
async function updateCalendarEvent(
  userEmail: string,
  eventId: string,
  updates: {
    summary?: string;
    startTime?: string;
    endTime?: string;
    addAttendees?: string[];
  }
) {
  const calendar = getCalendarClient(userEmail);
  
  // 기존 이벤트 조회
  const existing = await calendar.events.get({
    calendarId: 'primary',
    eventId,
  });
  
  const requestBody: any = {};
  
  if (updates.summary) {
    requestBody.summary = updates.summary;
  }
  if (updates.startTime) {
    requestBody.start = { dateTime: updates.startTime, timeZone: 'Asia/Seoul' };
  }
  if (updates.endTime) {
    requestBody.end = { dateTime: updates.endTime, timeZone: 'Asia/Seoul' };
  }
  if (updates.addAttendees) {
    const currentAttendees = existing.data.attendees || [];
    requestBody.attendees = [
      ...currentAttendees,
      ...updates.addAttendees.map(email => ({ email })),
    ];
  }
  
  const response = await calendar.events.patch({
    calendarId: 'primary',
    eventId,
    sendUpdates: 'all',
    requestBody,
  });
  
  return response.data;
}
```

### 4.5 일정 삭제

**Endpoint:** `DELETE /calendars/{calendarId}/events/{eventId}`

```typescript
async function deleteCalendarEvent(
  userEmail: string,
  eventId: string,
  notifyAttendees = true
) {
  const calendar = getCalendarClient(userEmail);
  
  await calendar.events.delete({
    calendarId: 'primary',
    eventId,
    sendUpdates: notifyAttendees ? 'all' : 'none',
  });
}
```

### 4.6 가용 시간 확인 (FreeBusy)

**Endpoint:** `POST /freeBusy`

```typescript
async function checkAvailability(
  userEmails: string[],
  timeMin: string,
  timeMax: string
) {
  const calendar = getCalendarClient(process.env.GOOGLE_DELEGATED_USER_EMAIL!);
  
  const response = await calendar.freebusy.query({
    requestBody: {
      timeMin,
      timeMax,
      timeZone: 'Asia/Seoul',
      items: userEmails.map(email => ({ id: email })),
    },
  });
  
  return response.data.calendars;
}

// 사용 예
const availability = await checkAvailability(
  ['chaewook@company.com', 'sujin@company.com'],
  '2024-01-15T09:00:00+09:00',
  '2024-01-15T18:00:00+09:00'
);

// Response
// {
//   "chaewook@company.com": {
//     "busy": [
//       { "start": "2024-01-15T10:00:00+09:00", "end": "2024-01-15T11:00:00+09:00" }
//     ]
//   }
// }
```

**빈 시간 슬롯 계산:**
```typescript
function findFreeSlots(
  busyTimes: { start: string; end: string }[],
  timeMin: string,
  timeMax: string,
  durationMinutes: number
): { start: string; end: string }[] {
  const slots: { start: string; end: string }[] = [];
  let current = new Date(timeMin);
  const end = new Date(timeMax);
  
  // busy times를 시간순 정렬
  const sorted = busyTimes.sort((a, b) => 
    new Date(a.start).getTime() - new Date(b.start).getTime()
  );
  
  for (const busy of sorted) {
    const busyStart = new Date(busy.start);
    const gap = (busyStart.getTime() - current.getTime()) / 60000;
    
    if (gap >= durationMinutes) {
      slots.push({
        start: current.toISOString(),
        end: busyStart.toISOString(),
      });
    }
    
    current = new Date(busy.end);
  }
  
  // 마지막 busy 이후 시간 확인
  if (current < end) {
    const gap = (end.getTime() - current.getTime()) / 60000;
    if (gap >= durationMinutes) {
      slots.push({
        start: current.toISOString(),
        end: end.toISOString(),
      });
    }
  }
  
  return slots;
}
```

### 4.7 Rate Limits

| 쿼터 | 제한 |
|------|------|
| 사용자당 일일 요청 | 1,000,000 |
| 100초당 요청 | 500 (사용자당) |

---

## 5. Gmail API

### 5.1 인증 (Service Account)

```typescript
import { google } from 'googleapis';

function getGmailClient(userEmail: string) {
  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    },
    scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
    clientOptions: {
      subject: userEmail,
    },
  });
  
  return google.gmail({ version: 'v1', auth });
}
```

**Base URL:** `https://gmail.googleapis.com/gmail/v1`

### 5.2 메일 목록 조회

**Endpoint:** `GET /users/{userId}/messages`

**Query 문법:**
| 검색어 | 설명 |
|--------|------|
| `is:unread` | 읽지 않은 메일 |
| `from:email@example.com` | 발신자 |
| `after:2024/01/15` | 특정 날짜 이후 |
| `before:2024/01/20` | 특정 날짜 이전 |
| `subject:키워드` | 제목 검색 |
| `has:attachment` | 첨부파일 있음 |

```typescript
async function getEmails(
  userEmail: string,
  query: string,
  maxResults = 10
) {
  const gmail = getGmailClient(userEmail);
  
  const response = await gmail.users.messages.list({
    userId: 'me',
    q: query,
    maxResults,
  });
  
  return response.data.messages || [];
}

// 사용 예
const unreadEmails = await getEmails(
  'chaewook@company.com',
  'is:unread after:2024/01/15',
  10
);
```

**Response:**
```json
{
  "messages": [
    { "id": "msg-id-1", "threadId": "thread-id-1" },
    { "id": "msg-id-2", "threadId": "thread-id-2" }
  ],
  "nextPageToken": "..."
}
```

### 5.3 메일 상세 조회

**Endpoint:** `GET /users/{userId}/messages/{id}`

```typescript
async function getEmailDetail(userEmail: string, messageId: string) {
  const gmail = getGmailClient(userEmail);
  
  const response = await gmail.users.messages.get({
    userId: 'me',
    id: messageId,
    format: 'full',
  });
  
  const message = response.data;
  const headers = message.payload?.headers || [];
  
  const getHeader = (name: string) =>
    headers.find(h => h.name?.toLowerCase() === name.toLowerCase())?.value;
  
  // 본문 추출
  let body = '';
  if (message.payload?.body?.data) {
    body = Buffer.from(message.payload.body.data, 'base64').toString('utf-8');
  } else if (message.payload?.parts) {
    const textPart = message.payload.parts.find(
      p => p.mimeType === 'text/plain'
    );
    if (textPart?.body?.data) {
      body = Buffer.from(textPart.body.data, 'base64').toString('utf-8');
    }
  }
  
  return {
    id: message.id,
    threadId: message.threadId,
    subject: getHeader('subject'),
    from: getHeader('from'),
    to: getHeader('to'),
    date: getHeader('date'),
    body,
    snippet: message.snippet,
  };
}
```

**Response (가공 후):**
```json
{
  "id": "msg-id-1",
  "threadId": "thread-id-1",
  "subject": "[긴급] Q1 예산 검토 요청",
  "from": "김부장 <boss@company.com>",
  "to": "chaewook@company.com",
  "date": "Mon, 15 Jan 2024 09:30:00 +0900",
  "body": "안녕하세요,\n\nQ1 예산 관련하여 금주 내 검토 부탁드립니다...",
  "snippet": "안녕하세요, Q1 예산 관련하여 금주 내 검토 부탁드립니다..."
}
```

### 5.4 메일 요약 조회 (다건)

```typescript
async function getEmailSummaries(userEmail: string, query: string, limit = 5) {
  const messages = await getEmails(userEmail, query, limit);
  
  const summaries = await Promise.all(
    messages.map(async (msg) => {
      const detail = await getEmailDetail(userEmail, msg.id!);
      return {
        id: detail.id,
        subject: detail.subject,
        from: detail.from,
        date: detail.date,
        snippet: detail.snippet,
      };
    })
  );
  
  return summaries;
}
```

### 5.5 Rate Limits

| 쿼터 | 제한 |
|------|------|
| 사용자당 일일 요청 | 1,000,000,000 |
| 100초당 요청 | 250 (사용자당) |

---

## 6. Claude API

### 6.1 인증

**Headers:**
```
x-api-key: {ANTHROPIC_API_KEY}
anthropic-version: 2023-06-01
Content-Type: application/json
```

**Base URL:** `https://api.anthropic.com/v1`

### 6.2 메시지 생성 (Tool Use)

**Endpoint:** `POST /messages`

**Request:**
```json
{
  "model": "claude-sonnet-4-20250514",
  "max_tokens": 4096,
  "system": "당신은 Paimy, 사내 AI PM 어시스턴트입니다...",
  "tools": [
    {
      "name": "get_tasks",
      "description": "노션에서 태스크 목록을 조회합니다.",
      "input_schema": {
        "type": "object",
        "properties": {
          "owner_notion_id": { "type": "string" },
          "status": { "type": "string", "enum": ["Backlog", "In Progress", "Blocked", "Done"] },
          "due_date_start": { "type": "string", "format": "date" },
          "due_date_end": { "type": "string", "format": "date" }
        }
      }
    },
    {
      "name": "update_task",
      "description": "태스크의 속성을 수정합니다.",
      "input_schema": {
        "type": "object",
        "properties": {
          "task_id": { "type": "string" },
          "status": { "type": "string" }
        },
        "required": ["task_id"]
      }
    }
  ],
  "messages": [
    {
      "role": "user",
      "content": "내 태스크 보여줘"
    }
  ]
}
```

**Response (Tool Use 요청):**
```json
{
  "id": "msg_01234",
  "type": "message",
  "role": "assistant",
  "content": [
    {
      "type": "tool_use",
      "id": "toolu_01234",
      "name": "get_tasks",
      "input": {
        "owner_notion_id": "a1b2c3d4-..."
      }
    }
  ],
  "stop_reason": "tool_use"
}
```

### 6.3 Tool 결과 전달 및 최종 응답

**Request (Tool 결과 포함):**
```json
{
  "model": "claude-sonnet-4-20250514",
  "max_tokens": 4096,
  "system": "...",
  "tools": [...],
  "messages": [
    {
      "role": "user",
      "content": "내 태스크 보여줘"
    },
    {
      "role": "assistant",
      "content": [
        {
          "type": "tool_use",
          "id": "toolu_01234",
          "name": "get_tasks",
          "input": { "owner_notion_id": "a1b2c3d4-..." }
        }
      ]
    },
    {
      "role": "user",
      "content": [
        {
          "type": "tool_result",
          "tool_use_id": "toolu_01234",
          "content": "[{\"id\":\"task-1\",\"name\":\"레드티밍 가드레일 검증\",\"status\":\"In Progress\",\"due_date\":\"2024-01-19\"}]"
        }
      ]
    }
  ]
}
```

**Response (최종):**
```json
{
  "content": [
    {
      "type": "text",
      "text": "📋 현재 진행 중인 태스크 1건이에요.\n\n1. **레드티밍 가드레일 검증**\n   마감: 금요일 | 상태: In Progress"
    }
  ],
  "stop_reason": "end_turn"
}
```

### 6.4 전체 처리 플로우 코드

```typescript
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function processUserMessage(
  userMessage: string,
  systemPrompt: string,
  tools: Anthropic.Tool[],
  context: ConversationContext
) {
  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: userMessage }
  ];
  
  while (true) {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: systemPrompt,
      tools,
      messages,
    });
    
    // Tool Use 요청인 경우
    if (response.stop_reason === 'tool_use') {
      const toolUseBlock = response.content.find(
        block => block.type === 'tool_use'
      ) as Anthropic.ToolUseBlock;
      
      // Tool 실행
      const toolResult = await executeTool(
        toolUseBlock.name,
        toolUseBlock.input,
        context
      );
      
      // 대화에 추가
      messages.push({ role: 'assistant', content: response.content });
      messages.push({
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: toolUseBlock.id,
          content: JSON.stringify(toolResult),
        }],
      });
      
      continue; // 다시 Claude 호출
    }
    
    // 최종 텍스트 응답
    const textBlock = response.content.find(
      block => block.type === 'text'
    ) as Anthropic.TextBlock;
    
    return textBlock.text;
  }
}

async function executeTool(
  name: string,
  input: any,
  context: ConversationContext
) {
  switch (name) {
    case 'get_tasks':
      return await queryTasks(input);
    case 'update_task':
      return await updateTask(input.task_id, input);
    case 'get_calendar_events':
      return await getCalendarEvents(context.google_email, input.time_min, input.time_max);
    // ... 기타 tools
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
```

### 6.5 Rate Limits

| 티어 | 분당 요청 | 분당 토큰 | 일일 토큰 |
|------|----------|----------|----------|
| Tier 1 | 50 | 40,000 | 1,000,000 |
| Tier 2 | 1,000 | 80,000 | 2,500,000 |
| Tier 3 | 2,000 | 160,000 | 5,000,000 |

---

## 7. 에러 코드 및 처리

### 7.1 공통 에러 처리 패턴

```typescript
async function apiCallWithRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  baseDelay = 1000
): Promise<T> {
  let lastError: Error;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;
      
      // Rate Limit
      if (error.status === 429) {
        const retryAfter = error.headers?.['retry-after'] || Math.pow(2, attempt);
        await sleep(retryAfter * 1000);
        continue;
      }
      
      // 서버 에러 (재시도 가능)
      if (error.status >= 500) {
        await sleep(baseDelay * Math.pow(2, attempt));
        continue;
      }
      
      // 클라이언트 에러 (재시도 불가)
      throw error;
    }
  }
  
  throw lastError!;
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
```

### 7.2 서비스별 에러 코드

**Slack:**
| 에러 | 설명 | 처리 |
|------|------|------|
| `ratelimited` | Rate Limit 초과 | Retry-After 후 재시도 |
| `channel_not_found` | 채널 없음 | 사용자에게 알림 |
| `not_in_channel` | 봇이 채널에 없음 | 채널 초대 요청 |

**Notion:**
| 에러 | 설명 | 처리 |
|------|------|------|
| `rate_limited` | Rate Limit 초과 | Retry-After 후 재시도 |
| `object_not_found` | 페이지/DB 없음 | 사용자에게 알림 |
| `unauthorized` | 권한 없음 | Integration 연결 확인 |

**Google:**
| 에러 | 설명 | 처리 |
|------|------|------|
| `403` | 권한 없음 | Domain Delegation 확인 |
| `404` | 리소스 없음 | 사용자에게 알림 |
| `429` | Rate Limit 초과 | 지수 백오프 재시도 |

**Claude:**
| 에러 | 설명 | 처리 |
|------|------|------|
| `rate_limit_error` | Rate Limit 초과 | 재시도 |
| `overloaded_error` | 서버 과부하 | 잠시 후 재시도 |
| `invalid_request_error` | 잘못된 요청 | 로깅 후 사용자 알림 |

---

## 8. 완성된 API 호출 예시

### 8.1 시나리오: "내 이번 주 태스크 보여줘"

```typescript
// 1. Slack에서 이벤트 수신
// POST /api/slack/events
const event = {
  type: 'app_mention',
  user: 'U01ABC2DEF3',
  text: '<@UPAIMY> 내 이번 주 태스크 보여줘',
  channel: 'C01CHANNEL1',
  ts: '1234567890.123456'
};

// 2. 사용자 매핑 조회 (Supabase)
const userMapping = await supabase
  .from('user_mappings')
  .select('*')
  .eq('slack_id', 'U01ABC2DEF3')
  .single();
// → { notion_id: 'a1b2c3d4-...', google_email: 'chaewook@company.com' }

// 3. Claude API 호출 → Tool Use 응답
// Claude가 get_tasks tool 호출 결정

// 4. Notion API 호출
const tasks = await queryTasks({
  owner_notion_id: 'a1b2c3d4-...',
  due_date_start: '2024-01-15',
  due_date_end: '2024-01-21'
});

// 5. Claude에 결과 전달 → 최종 응답 생성
const response = '📋 이번 주 마감 태스크 2건이에요.\n\n1. **레드티밍 가드레일 검증**...';

// 6. Slack 메시지 발송
await sendSlackMessage('C01CHANNEL1', response, '1234567890.123456');
```

### 8.2 시나리오: "이거 완료 처리해줘"

```typescript
// 1. 컨텍스트에서 마지막 태스크 조회 (Supabase)
const context = await supabase
  .from('conversation_context')
  .select('last_task_id, last_task_name')
  .eq('slack_thread_ts', '1234567890.123456')
  .single();
// → { last_task_id: 'page-id-1234', last_task_name: '레드티밍 가드레일 검증' }

// 2. Claude API → update_task tool 호출 결정

// 3. Notion API 호출
await updateTask('page-id-1234', {
  '상태': { select: { name: 'Done' } }
});

// 4. 완료 응답
await sendSlackMessage(
  'C01CHANNEL1',
  '✅ "레드티밍 가드레일 검증" 태스크를 완료 처리했어요!',
  '1234567890.123456'
);
```

---

## 9. 체크리스트

### 9.1 구현

- [ ] Slack 이벤트 수신 및 검증
- [ ] Slack 메시지 발송 (일반, DM, 스레드)
- [ ] Notion 쿼리/조회/수정/생성
- [ ] Google Calendar CRUD + FreeBusy
- [ ] Gmail 조회 및 파싱
- [ ] Claude Tool Use 루프
- [ ] 에러 처리 및 재시도 로직

### 9.2 테스트

- [ ] 각 API 개별 호출 테스트
- [ ] Tool Use 전체 플로우 테스트
- [ ] Rate Limit 시뮬레이션
- [ ] 에러 케이스 테스트

---
