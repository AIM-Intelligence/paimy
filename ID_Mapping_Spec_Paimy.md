# ID 매핑 명세서: Paimy

## 1. 개요

### 1.1 목적
Paimy는 Slack, Notion, Google Workspace 세 가지 플랫폼을 연동한다. 각 플랫폼은 사용자를 식별하는 고유한 ID 체계를 가지고 있으므로, 이를 1:1로 매핑하여 **"슬랙에서 말한 사람 = 노션의 담당자 = 구글 캘린더 소유자"** 관계를 성립시켜야 한다.

### 1.2 매핑이 필요한 이유

| 상황 | 매핑 필요성 |
|------|------------|
| "내 태스크 보여줘" | Slack ID → Notion Person ID로 변환하여 필터링 |
| "김채욱 PM 일정 어때?" | 이름 → Google Email로 변환하여 캘린더 조회 |
| 모닝 브리핑 발송 | Notion 담당자 → Slack ID로 변환하여 DM 발송 |
| "이 태스크 담당자한테 연락해" | Notion Person → Slack ID로 변환하여 멘션 |

---

## 2. 플랫폼별 ID 체계

### 2.1 Slack

| 항목 | 형식 | 예시 | 설명 |
|------|------|------|------|
| User ID | `U` + 10자리 영숫자 | `U01ABC2DEF3` | 사용자 고유 식별자 |
| Display Name | 문자열 | `김채욱` | 표시 이름 (중복 가능) |
| Username | 문자열 | `chaewook.kim` | @멘션용 (중복 불가) |
| Email | 이메일 | `chaewook@company.com` | 워크스페이스 가입 이메일 |

**조회 방법**: `users.list` 또는 `users.info` API

### 2.2 Notion

| 항목 | 형식 | 예시 | 설명 |
|------|------|------|------|
| Person ID | UUID (32자리) | `a1b2c3d4-e5f6-...` | 사용자 고유 식별자 |
| Name | 문자열 | `김채욱` | 워크스페이스 내 표시 이름 |
| Email | 이메일 | `chaewook@company.com` | Notion 계정 이메일 |

**조회 방법**: `users.list` API 또는 DB 쿼리 시 Person 속성에서 확인

### 2.3 Google Workspace

| 항목 | 형식 | 예시 | 설명 |
|------|------|------|------|
| Email | 이메일 | `chaewook@company.com` | 기본 식별자 (Primary Key) |
| User ID | 숫자 문자열 | `118234567890123456789` | Google 내부 ID (거의 사용 안 함) |

**조회 방법**: 도메인 내 이메일로 직접 접근 (Service Account + Domain Delegation)

---

## 3. 매핑 테이블 설계

### 3.1 user_mappings 테이블

```sql
CREATE TABLE user_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Slack 정보
  slack_id VARCHAR(20) UNIQUE NOT NULL,      -- 'U01ABC2DEF3'
  slack_username VARCHAR(100),                -- 'chaewook.kim'
  slack_display_name VARCHAR(100),            -- '김채욱'
  
  -- Notion 정보
  notion_id VARCHAR(50),                      -- 'a1b2c3d4-e5f6-...'
  notion_name VARCHAR(100),                   -- '김채욱'
  
  -- Google 정보
  google_email VARCHAR(100),                  -- 'chaewook@company.com'
  
  -- 메타데이터
  is_active BOOLEAN DEFAULT true,             -- 퇴사자 처리용
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- 인덱스
CREATE INDEX idx_user_mappings_slack_id ON user_mappings(slack_id);
CREATE INDEX idx_user_mappings_notion_id ON user_mappings(notion_id);
CREATE INDEX idx_user_mappings_google_email ON user_mappings(google_email);
```

### 3.2 매핑 데이터 예시

| slack_id | slack_display_name | notion_id | notion_name | google_email |
|----------|-------------------|-----------|-------------|--------------|
| U01ABC2DEF3 | 김채욱 | a1b2c3d4-... | 김채욱 | chaewook@company.com |
| U02DEF4GHI5 | 이수진 | b2c3d4e5-... | 이수진 | sujin@company.com |
| U03GHI6JKL7 | 박지훈 | c3d4e5f6-... | 박지훈 | jihun@company.com |

---

## 4. 매핑 조회 함수

### 4.1 Slack → Notion

```typescript
// 슬랙 사용자의 노션 ID 조회
async function getNotionIdBySlackId(slackId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('user_mappings')
    .select('notion_id')
    .eq('slack_id', slackId)
    .eq('is_active', true)
    .single();
  
  return data?.notion_id ?? null;
}
```

**사용 예시**: "내 태스크 보여줘" → Slack ID로 Notion Person 필터링

### 4.2 Slack → Google

```typescript
// 슬랙 사용자의 구글 이메일 조회
async function getGoogleEmailBySlackId(slackId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('user_mappings')
    .select('google_email')
    .eq('slack_id', slackId)
    .eq('is_active', true)
    .single();
  
  return data?.google_email ?? null;
}
```

**사용 예시**: "내 일정 보여줘" → Slack ID로 Google Calendar 조회

### 4.3 Notion → Slack

```typescript
// 노션 사용자의 슬랙 ID 조회
async function getSlackIdByNotionId(notionId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('user_mappings')
    .select('slack_id')
    .eq('notion_id', notionId)
    .eq('is_active', true)
    .single();
  
  return data?.slack_id ?? null;
}
```

**사용 예시**: 모닝 브리핑 발송 시 Notion 담당자 → Slack DM 대상

### 4.4 이름으로 검색

```typescript
// 이름으로 사용자 검색 (퍼지 매칭)
async function findUserByName(name: string): Promise<UserMapping[]> {
  const { data, error } = await supabase
    .from('user_mappings')
    .select('*')
    .eq('is_active', true)
    .or(`slack_display_name.ilike.%${name}%,notion_name.ilike.%${name}%`);
  
  return data ?? [];
}
```

**사용 예시**: "김채욱 PM 태스크 보여줘" → 이름으로 사용자 찾기

### 4.5 전체 매핑 조회

```typescript
// 활성 사용자 전체 조회 (브리핑 발송용)
async function getAllActiveUsers(): Promise<UserMapping[]> {
  const { data, error } = await supabase
    .from('user_mappings')
    .select('*')
    .eq('is_active', true);
  
  return data ?? [];
}
```

---

## 5. 초기 데이터 구축 방법

### 5.1 방법 1: CSV 일괄 등록 (권장)

관리자가 CSV 파일을 준비하여 Supabase에 일괄 import.

**CSV 형식**:
```csv
slack_id,slack_username,slack_display_name,notion_id,notion_name,google_email
U01ABC2DEF3,chaewook.kim,김채욱,a1b2c3d4-e5f6-7890-abcd-ef1234567890,김채욱,chaewook@company.com
U02DEF4GHI5,sujin.lee,이수진,b2c3d4e5-f6a7-8901-bcde-f23456789012,이수진,sujin@company.com
```

**구축 절차**:
1. Slack Admin에서 사용자 목록 내보내기 (slack_id, email)
2. Notion Admin에서 워크스페이스 멤버 조회 (notion_id, email)
3. 이메일 기준으로 조인하여 매핑 테이블 생성
4. Supabase Table Editor에서 CSV Import

### 5.2 방법 2: 이메일 기반 자동 매핑

세 플랫폼 모두 **회사 이메일**을 공통으로 사용한다면, 이메일 기준 자동 매핑 스크립트 실행.

```typescript
async function buildMappingTable() {
  // 1. Slack 사용자 목록 조회
  const slackUsers = await slack.users.list();
  
  // 2. Notion 사용자 목록 조회
  const notionUsers = await notion.users.list();
  
  // 3. 이메일 기준 매핑
  for (const slackUser of slackUsers.members) {
    const email = slackUser.profile.email;
    const notionUser = notionUsers.results.find(n => n.person?.email === email);
    
    if (notionUser) {
      await supabase.from('user_mappings').upsert({
        slack_id: slackUser.id,
        slack_username: slackUser.name,
        slack_display_name: slackUser.profile.display_name,
        notion_id: notionUser.id,
        notion_name: notionUser.name,
        google_email: email,
      });
    }
  }
}
```

### 5.3 방법 3: 슬랙 명령어로 개별 등록

사용자가 직접 자신의 매핑 정보를 등록.

```
사용자: /paimy register
Paimy: 매핑 정보를 등록할게요. 노션과 구글 계정에 사용하는 이메일을 알려주세요.
사용자: chaewook@company.com
Paimy: ✅ 등록 완료!
       - Slack: 김채욱 (U01ABC2DEF3)
       - Notion: 김채욱 (a1b2c3d4-...)
       - Google: chaewook@company.com
```

---

## 6. 데이터 동기화 및 유지보수

### 6.1 신규 입사자 처리

| 방법 | 설명 |
|------|------|
| 수동 등록 | 관리자가 Supabase에 직접 추가 |
| 슬랙 명령어 | `/paimy register` 명령어로 본인 등록 |
| 자동 감지 | Slack `team_join` 이벤트 수신 → 등록 안내 DM 발송 |

### 6.2 퇴사자 처리

```typescript
// 퇴사자 비활성화 (데이터 삭제 대신 soft delete)
async function deactivateUser(slackId: string) {
  await supabase
    .from('user_mappings')
    .update({ is_active: false, updated_at: new Date() })
    .eq('slack_id', slackId);
}
```

### 6.3 정보 변경 처리

| 상황 | 처리 |
|------|------|
| 슬랙 이름 변경 | `user_change` 이벤트로 자동 업데이트 |
| 노션 이름 변경 | 주기적 동기화 또는 수동 업데이트 |
| 이메일 변경 | 관리자 수동 처리 (드문 케이스) |

### 6.4 주기적 검증 스크립트

```typescript
// 매핑 무결성 검증 (주 1회 실행 권장)
async function validateMappings() {
  const mappings = await getAllActiveUsers();
  const issues = [];
  
  for (const user of mappings) {
    // Slack ID 유효성 검증
    try {
      await slack.users.info({ user: user.slack_id });
    } catch {
      issues.push({ user, issue: 'Invalid Slack ID' });
    }
    
    // Notion ID 유효성 검증
    try {
      await notion.users.retrieve({ user_id: user.notion_id });
    } catch {
      issues.push({ user, issue: 'Invalid Notion ID' });
    }
  }
  
  return issues;
}
```

---

## 7. 추가 매핑 테이블

### 7.1 conversation_context (대화 맥락)

사용자가 "그 태스크"라고 말할 때 어떤 태스크를 의미하는지 추적.

```sql
CREATE TABLE conversation_context (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slack_thread_ts VARCHAR(50) UNIQUE NOT NULL,  -- 스레드 식별자
  slack_channel_id VARCHAR(20) NOT NULL,
  slack_user_id VARCHAR(20) NOT NULL,
  
  -- 마지막으로 언급된 항목들
  last_task_id VARCHAR(50),           -- 노션 태스크 ID
  last_task_name VARCHAR(200),        -- 태스크명 (빠른 참조용)
  last_event_id VARCHAR(100),         -- 캘린더 이벤트 ID
  last_email_id VARCHAR(100),         -- Gmail 메시지 ID
  
  -- 대화 맥락 데이터 (유연한 확장용)
  context_data JSONB,
  
  -- TTL
  expires_at TIMESTAMP DEFAULT (NOW() + INTERVAL '24 hours'),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

**사용 예시**:
```
사용자: "이번 주 마감인 레드티밍 프로젝트 건 보여줘"
Paimy: "레드티밍 가드레일 검증" 태스크가 있어요. 마감일은 금요일이에요.
       → context에 last_task_id 저장

사용자: "그거 완료 처리해줘"
Paimy: → context에서 last_task_id 조회 → 상태 변경
```

### 7.2 task_event_mapping (태스크-일정 연결)

태스크와 관련된 미팅을 연결.

```sql
CREATE TABLE task_event_mapping (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  notion_task_id VARCHAR(50) NOT NULL,
  google_event_id VARCHAR(100) NOT NULL,
  relationship_type VARCHAR(20) DEFAULT 'related',  -- 'related', 'created_from', 'follow_up'
  created_at TIMESTAMP DEFAULT NOW(),
  
  UNIQUE(notion_task_id, google_event_id)
);
```

### 7.3 task_source_mapping (태스크 출처)

메일에서 생성된 태스크의 원본 추적.

```sql
CREATE TABLE task_source_mapping (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  notion_task_id VARCHAR(50) UNIQUE NOT NULL,
  source_type VARCHAR(20) NOT NULL,        -- 'gmail', 'slack', 'calendar', 'manual'
  source_id VARCHAR(200),                  -- Gmail message ID, Slack thread ts 등
  source_url TEXT,                         -- 원본 링크
  created_at TIMESTAMP DEFAULT NOW()
);
```

---

## 8. 에러 처리

### 8.1 매핑 없는 사용자

```typescript
async function handleUnmappedUser(slackId: string, slackChannel: string) {
  const user = await getUserMapping(slackId);
  
  if (!user) {
    await slack.chat.postMessage({
      channel: slackChannel,
      text: "앗, 아직 등록되지 않은 사용자예요. `/paimy register` 명령어로 먼저 등록해주세요!"
    });
    return null;
  }
  
  if (!user.notion_id) {
    await slack.chat.postMessage({
      channel: slackChannel,
      text: "노션 계정이 연결되지 않았어요. 관리자에게 문의해주세요."
    });
    return null;
  }
  
  return user;
}
```

### 8.2 이름 검색 결과 모호

```typescript
async function resolveAmbiguousName(name: string, slackChannel: string) {
  const matches = await findUserByName(name);
  
  if (matches.length === 0) {
    await slack.chat.postMessage({
      channel: slackChannel,
      text: `"${name}"에 해당하는 사용자를 찾을 수 없어요.`
    });
    return null;
  }
  
  if (matches.length > 1) {
    const options = matches.map(u => `• ${u.slack_display_name} (<@${u.slack_id}>)`).join('\n');
    await slack.chat.postMessage({
      channel: slackChannel,
      text: `"${name}"에 해당하는 사용자가 여러 명이에요. 누구를 말하는 건가요?\n${options}`
    });
    return null;
  }
  
  return matches[0];
}
```

---

## 9. 체크리스트

### 9.1 초기 구축

- [ ] Supabase에 `user_mappings` 테이블 생성
- [ ] Slack 워크스페이스 멤버 목록 추출
- [ ] Notion 워크스페이스 멤버 목록 추출
- [ ] 이메일 기준 매핑 데이터 생성
- [ ] Supabase에 데이터 import
- [ ] 매핑 누락 사용자 확인 및 수동 보완

### 9.2 운영

- [ ] 신규 입사자 등록 프로세스 수립
- [ ] 퇴사자 처리 프로세스 수립
- [ ] 주기적 검증 스크립트 스케줄링
- [ ] 매핑 오류 알림 채널 설정

---
