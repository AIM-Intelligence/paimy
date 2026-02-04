# LLM 프롬프트 & Tool 설계서: Paimy

## 1. 개요

### 1.1 목적
본 문서는 Paimy의 AI 두뇌 역할을 하는 Claude Sonnet 4.5의 시스템 프롬프트와 Tool Use 함수를 정의한다.

### 1.2 설계 원칙

| 원칙 | 설명 |
|------|------|
| **자연스러운 대화** | 딱딱한 봇이 아닌, 친근한 PM 동료처럼 대화 |
| **최소 확인** | 명확한 요청은 바로 실행, 모호할 때만 확인 |
| **맥락 유지** | 이전 대화에서 언급한 항목 기억 |
| **실패 안전** | 잘못된 실행보다 확인 요청 우선 |

---

## 2. 시스템 프롬프트

### 2.1 기본 프롬프트

```
당신은 Paimy, 사내 AI PM 어시스턴트입니다.

## 역할
- 슬랙에서 팀원들의 프로젝트 관리를 돕습니다.
- 노션의 태스크를 조회하고 수정합니다.
- 구글 캘린더 일정을 확인하고 생성합니다.
- Gmail에서 중요한 액션 아이템을 추출합니다.

## 성격
- 친근하고 간결하게 대화합니다.
- 이모지를 적절히 사용합니다 (과하지 않게).
- 존댓말을 사용하되 딱딱하지 않게 합니다.
- "~요" 체를 기본으로 합니다.

## 응답 규칙
1. 명확한 요청은 바로 실행하고 결과를 알려주세요.
2. 모호한 요청은 한 번만 확인하세요. 여러 번 되묻지 마세요.
3. 실행 결과는 간결하게, 필요한 정보만 포함하세요.
4. 에러가 발생하면 사용자가 이해할 수 있는 말로 설명하세요.
5. 할 수 없는 요청은 솔직하게 말하고 대안을 제시하세요.

## 컨텍스트 활용
- 이전 대화에서 언급된 태스크, 일정, 메일을 기억합니다.
- "그거", "그 태스크", "아까 그 미팅" 같은 표현을 이해합니다.
- 컨텍스트가 불명확하면 최근 언급된 항목을 우선합니다.

## 현재 사용자 정보
- Slack ID: {{slack_id}}
- 이름: {{user_name}}
- Notion ID: {{notion_id}}
- Google Email: {{google_email}}
- 현재 시간: {{current_time}}
```

### 2.2 컨텍스트 주입 템플릿

```
## 이전 대화 컨텍스트
{{#if last_task}}
- 마지막으로 언급한 태스크: "{{last_task.name}}" (ID: {{last_task.id}})
{{/if}}
{{#if last_event}}
- 마지막으로 언급한 일정: "{{last_event.name}}" ({{last_event.date}})
{{/if}}
{{#if last_email}}
- 마지막으로 언급한 메일: "{{last_email.subject}}" (from: {{last_email.from}})
{{/if}}
```

### 2.3 상황별 추가 프롬프트

**모닝 브리핑 생성 시:**
```
오늘의 모닝 브리핑을 생성해주세요.
포맷:
- 인사와 날짜
- 📅 오늘 일정 (시간순)
- ✅ 오늘 마감 태스크
- 🔥 진행 중인 우선순위 높은 업무
- 📧 확인이 필요한 메일 (있다면)
- 마무리 응원 메시지

간결하게, 슬랙에서 읽기 좋은 포맷으로 작성해주세요.
```

**주간 리포트 생성 시:**
```
이번 주 주간 리포트를 생성해주세요.
포맷:
- 📊 이번 주 요약 (완료 n건, 진행 중 n건, 지연 n건)
- ✅ 완료된 태스크 목록
- 🚧 진행 중인 태스크
- ⚠️ 지연 중인 태스크 (마감 경과)
- 📅 다음 주 마감 예정
```

---

## 3. Tool 정의

### 3.1 Tool 목록 개요

| 카테고리 | Tool 이름 | 용도 |
|----------|-----------|------|
| **Notion** | `get_tasks` | 태스크 조회 |
| | `get_task_detail` | 태스크 상세 조회 |
| | `update_task` | 태스크 수정 |
| | `create_task` | 태스크 생성 |
| **Calendar** | `get_calendar_events` | 일정 조회 |
| | `create_calendar_event` | 일정 생성 |
| | `update_calendar_event` | 일정 수정 |
| | `delete_calendar_event` | 일정 삭제 |
| | `check_availability` | 가용 시간 확인 |
| **Gmail** | `get_emails` | 메일 조회 |
| | `get_email_detail` | 메일 상세 조회 |
| | `extract_action_items` | 액션 아이템 추출 |
| **Cross** | `create_task_from_email` | 메일→태스크 생성 |
| | `create_meeting_for_task` | 태스크→미팅 생성 |
| | `generate_daily_briefing` | 통합 브리핑 생성 |

---

### 3.2 Notion Tools

#### get_tasks

```json
{
  "name": "get_tasks",
  "description": "노션에서 태스크 목록을 조회합니다. 담당자, 상태, 마감일 등으로 필터링할 수 있습니다.",
  "input_schema": {
    "type": "object",
    "properties": {
      "owner_notion_id": {
        "type": "string",
        "description": "담당자의 Notion ID. 생략하면 전체 조회."
      },
      "status": {
        "type": "string",
        "enum": ["Backlog", "In Progress", "Blocked", "Done"],
        "description": "태스크 상태 필터"
      },
      "due_date_start": {
        "type": "string",
        "format": "date",
        "description": "마감일 시작 범위 (YYYY-MM-DD)"
      },
      "due_date_end": {
        "type": "string",
        "format": "date",
        "description": "마감일 종료 범위 (YYYY-MM-DD)"
      },
      "priority": {
        "type": "string",
        "enum": ["High", "Medium", "Low"],
        "description": "우선순위 필터"
      },
      "keyword": {
        "type": "string",
        "description": "태스크명 검색 키워드"
      },
      "limit": {
        "type": "integer",
        "default": 10,
        "description": "최대 조회 개수"
      }
    },
    "required": []
  }
}
```

**사용 예시:**
| 발화 | Tool 호출 |
|------|-----------|
| "내 태스크 보여줘" | `get_tasks(owner_notion_id="현재유저")` |
| "이번 주 마감인 거" | `get_tasks(due_date_start="월요일", due_date_end="일요일")` |
| "레드티밍 관련 업무" | `get_tasks(keyword="레드티밍")` |
| "블로킹된 태스크" | `get_tasks(status="Blocked")` |

---

#### get_task_detail

```json
{
  "name": "get_task_detail",
  "description": "특정 태스크의 상세 정보를 조회합니다.",
  "input_schema": {
    "type": "object",
    "properties": {
      "task_id": {
        "type": "string",
        "description": "노션 태스크 페이지 ID"
      }
    },
    "required": ["task_id"]
  }
}
```

---

#### update_task

```json
{
  "name": "update_task",
  "description": "태스크의 속성을 수정합니다. 상태, 담당자, 마감일, 우선순위, 실행 상세 등을 변경할 수 있습니다.",
  "input_schema": {
    "type": "object",
    "properties": {
      "task_id": {
        "type": "string",
        "description": "수정할 태스크의 노션 페이지 ID"
      },
      "status": {
        "type": "string",
        "enum": ["Backlog", "In Progress", "Blocked", "Done"],
        "description": "변경할 상태"
      },
      "owner_notion_id": {
        "type": "string",
        "description": "변경할 담당자의 Notion ID"
      },
      "due_date": {
        "type": "string",
        "format": "date",
        "description": "변경할 마감일 (YYYY-MM-DD)"
      },
      "priority": {
        "type": "string",
        "enum": ["High", "Medium", "Low"],
        "description": "변경할 우선순위"
      },
      "description": {
        "type": "string",
        "description": "실행 상세에 추가할 내용"
      }
    },
    "required": ["task_id"]
  }
}
```

**사용 예시:**
| 발화 | Tool 호출 |
|------|-----------|
| "이거 완료 처리해줘" | `update_task(task_id="컨텍스트", status="Done")` |
| "담당자 김채욱으로 바꿔줘" | `update_task(task_id="컨텍스트", owner_notion_id="김채욱ID")` |
| "마감일 다음주 금요일로" | `update_task(task_id="컨텍스트", due_date="2024-01-19")` |

---

#### create_task

```json
{
  "name": "create_task",
  "description": "새로운 태스크를 생성합니다.",
  "input_schema": {
    "type": "object",
    "properties": {
      "title": {
        "type": "string",
        "description": "태스크 제목"
      },
      "owner_notion_id": {
        "type": "string",
        "description": "담당자의 Notion ID"
      },
      "due_date": {
        "type": "string",
        "format": "date",
        "description": "마감일 (YYYY-MM-DD)"
      },
      "priority": {
        "type": "string",
        "enum": ["High", "Medium", "Low"],
        "default": "Medium"
      },
      "description": {
        "type": "string",
        "description": "실행 상세"
      },
      "source_type": {
        "type": "string",
        "enum": ["Manual", "Slack", "Gmail", "Calendar"],
        "default": "Slack"
      },
      "source_id": {
        "type": "string",
        "description": "출처 ID (메일 ID, 스레드 ID 등)"
      }
    },
    "required": ["title"]
  }
}
```

---

### 3.3 Calendar Tools

#### get_calendar_events

```json
{
  "name": "get_calendar_events",
  "description": "구글 캘린더에서 일정을 조회합니다.",
  "input_schema": {
    "type": "object",
    "properties": {
      "user_email": {
        "type": "string",
        "description": "조회할 사용자의 Google 이메일. 생략하면 현재 사용자."
      },
      "time_min": {
        "type": "string",
        "format": "date-time",
        "description": "조회 시작 시간 (ISO 8601)"
      },
      "time_max": {
        "type": "string",
        "format": "date-time",
        "description": "조회 종료 시간 (ISO 8601)"
      },
      "keyword": {
        "type": "string",
        "description": "일정 제목 검색 키워드"
      },
      "limit": {
        "type": "integer",
        "default": 10
      }
    },
    "required": ["time_min", "time_max"]
  }
}
```

**사용 예시:**
| 발화 | Tool 호출 |
|------|-----------|
| "오늘 일정" | `get_calendar_events(time_min="오늘 00:00", time_max="오늘 23:59")` |
| "김채욱 내일 일정" | `get_calendar_events(user_email="chaewook@...", time_min="내일 00:00", ...)` |
| "이번 주 레드티밍 미팅" | `get_calendar_events(keyword="레드티밍", ...)` |

---

#### create_calendar_event

```json
{
  "name": "create_calendar_event",
  "description": "새로운 캘린더 일정을 생성합니다.",
  "input_schema": {
    "type": "object",
    "properties": {
      "summary": {
        "type": "string",
        "description": "일정 제목"
      },
      "start_time": {
        "type": "string",
        "format": "date-time",
        "description": "시작 시간 (ISO 8601)"
      },
      "end_time": {
        "type": "string",
        "format": "date-time",
        "description": "종료 시간 (ISO 8601). 생략하면 1시간 후."
      },
      "attendees": {
        "type": "array",
        "items": { "type": "string" },
        "description": "참석자 이메일 목록"
      },
      "description": {
        "type": "string",
        "description": "일정 설명"
      },
      "location": {
        "type": "string",
        "description": "장소 또는 회의 링크"
      },
      "recurrence": {
        "type": "string",
        "description": "반복 규칙 (RRULE 형식)"
      }
    },
    "required": ["summary", "start_time"]
  }
}
```

---

#### update_calendar_event

```json
{
  "name": "update_calendar_event",
  "description": "기존 캘린더 일정을 수정합니다.",
  "input_schema": {
    "type": "object",
    "properties": {
      "event_id": {
        "type": "string",
        "description": "수정할 이벤트 ID"
      },
      "summary": {
        "type": "string",
        "description": "변경할 제목"
      },
      "start_time": {
        "type": "string",
        "format": "date-time"
      },
      "end_time": {
        "type": "string",
        "format": "date-time"
      },
      "attendees_add": {
        "type": "array",
        "items": { "type": "string" },
        "description": "추가할 참석자"
      },
      "attendees_remove": {
        "type": "array",
        "items": { "type": "string" },
        "description": "제거할 참석자"
      }
    },
    "required": ["event_id"]
  }
}
```

---

#### delete_calendar_event

```json
{
  "name": "delete_calendar_event",
  "description": "캘린더 일정을 삭제합니다.",
  "input_schema": {
    "type": "object",
    "properties": {
      "event_id": {
        "type": "string",
        "description": "삭제할 이벤트 ID"
      },
      "notify_attendees": {
        "type": "boolean",
        "default": true,
        "description": "참석자에게 취소 알림 발송 여부"
      }
    },
    "required": ["event_id"]
  }
}
```

---

#### check_availability

```json
{
  "name": "check_availability",
  "description": "여러 사용자의 가용 시간을 확인합니다.",
  "input_schema": {
    "type": "object",
    "properties": {
      "user_emails": {
        "type": "array",
        "items": { "type": "string" },
        "description": "확인할 사용자들의 이메일"
      },
      "time_min": {
        "type": "string",
        "format": "date-time"
      },
      "time_max": {
        "type": "string",
        "format": "date-time"
      },
      "duration_minutes": {
        "type": "integer",
        "default": 60,
        "description": "필요한 미팅 시간 (분)"
      }
    },
    "required": ["user_emails", "time_min", "time_max"]
  }
}
```

---

### 3.4 Gmail Tools

#### get_emails

```json
{
  "name": "get_emails",
  "description": "Gmail에서 메일 목록을 조회합니다.",
  "input_schema": {
    "type": "object",
    "properties": {
      "user_email": {
        "type": "string",
        "description": "조회할 사용자 이메일. 생략하면 현재 사용자."
      },
      "query": {
        "type": "string",
        "description": "Gmail 검색 쿼리 (예: 'from:boss@company.com is:unread')"
      },
      "is_unread": {
        "type": "boolean",
        "description": "읽지 않은 메일만"
      },
      "from_email": {
        "type": "string",
        "description": "발신자 필터"
      },
      "after_date": {
        "type": "string",
        "format": "date",
        "description": "이 날짜 이후 메일"
      },
      "limit": {
        "type": "integer",
        "default": 10
      }
    },
    "required": []
  }
}
```

---

#### get_email_detail

```json
{
  "name": "get_email_detail",
  "description": "특정 메일의 상세 내용을 조회합니다.",
  "input_schema": {
    "type": "object",
    "properties": {
      "message_id": {
        "type": "string",
        "description": "Gmail 메시지 ID"
      }
    },
    "required": ["message_id"]
  }
}
```

---

#### extract_action_items

```json
{
  "name": "extract_action_items",
  "description": "메일 본문에서 액션 아이템을 추출합니다. LLM이 메일 내용을 분석하여 할 일 목록을 반환합니다.",
  "input_schema": {
    "type": "object",
    "properties": {
      "message_id": {
        "type": "string",
        "description": "분석할 Gmail 메시지 ID"
      }
    },
    "required": ["message_id"]
  }
}
```

**반환 형식:**
```json
{
  "action_items": [
    {
      "title": "보고서 초안 검토",
      "suggested_owner": "me",
      "suggested_due_date": "2024-01-15",
      "context": "김 부장님이 금주 내 검토 요청"
    },
    {
      "title": "데이터 분석 결과 공유",
      "suggested_owner": "sujin@company.com",
      "suggested_due_date": null,
      "context": "이수진님께 전달 필요"
    }
  ]
}
```

---

### 3.5 Cross-Platform Tools

#### create_task_from_email

```json
{
  "name": "create_task_from_email",
  "description": "메일에서 추출한 액션 아이템을 노션 태스크로 생성합니다.",
  "input_schema": {
    "type": "object",
    "properties": {
      "message_id": {
        "type": "string",
        "description": "원본 Gmail 메시지 ID"
      },
      "action_item": {
        "type": "object",
        "properties": {
          "title": { "type": "string" },
          "owner_notion_id": { "type": "string" },
          "due_date": { "type": "string", "format": "date" },
          "priority": { "type": "string" }
        },
        "required": ["title"]
      }
    },
    "required": ["message_id", "action_item"]
  }
}
```

---

#### create_meeting_for_task

```json
{
  "name": "create_meeting_for_task",
  "description": "태스크의 담당자/참여자들과 미팅을 생성합니다. 태스크 정보를 조회하여 참여자를 파악하고, 가용 시간을 확인한 후 미팅을 생성합니다.",
  "input_schema": {
    "type": "object",
    "properties": {
      "task_id": {
        "type": "string",
        "description": "미팅을 생성할 태스크의 노션 페이지 ID"
      },
      "duration_minutes": {
        "type": "integer",
        "default": 60,
        "description": "미팅 시간 (분)"
      },
      "time_range_start": {
        "type": "string",
        "format": "date-time",
        "description": "미팅 가능 시간 범위 시작 (ISO 8601). 생략하면 오늘부터."
      },
      "time_range_end": {
        "type": "string",
        "format": "date-time",
        "description": "미팅 가능 시간 범위 종료 (ISO 8601). 생략하면 1주일 후."
      },
      "preferred_time": {
        "type": "string",
        "enum": ["morning", "afternoon", "any"],
        "default": "any",
        "description": "선호 시간대"
      }
    },
    "required": ["task_id"]
  }
}
```

**사용 예시:**
| 발화 | Tool 호출 |
|------|-----------|
| "이 태스크 담당자들이랑 미팅 잡아줘" | `create_meeting_for_task(task_id=context)` |
| "이 건 관련해서 30분 미팅 잡아줘" | `create_meeting_for_task(task_id=context, duration_minutes=30)` |
| "이번 주 오후에 이 태스크 미팅 잡아줘" | `create_meeting_for_task(task_id=context, preferred_time="afternoon")` |

---

#### generate_daily_briefing

```json
{
  "name": "generate_daily_briefing",
  "description": "사용자의 일일 모닝 브리핑을 생성합니다. 오늘 일정, 마감 태스크, 중요 메일을 통합하여 요약합니다.",
  "input_schema": {
    "type": "object",
    "properties": {
      "user_id": {
        "type": "string",
        "description": "브리핑을 생성할 사용자의 Slack ID. 생략하면 현재 사용자."
      },
      "include_calendar": {
        "type": "boolean",
        "default": true,
        "description": "오늘 일정 포함 여부"
      },
      "include_tasks": {
        "type": "boolean",
        "default": true,
        "description": "오늘 마감 태스크 포함 여부"
      },
      "include_emails": {
        "type": "boolean",
        "default": true,
        "description": "미읽은 중요 메일 포함 여부"
      }
    },
    "required": []
  }
}
```

**사용 예시:**
| 발화 | Tool 호출 |
|------|-----------|
| "오늘 브리핑 보여줘" | `generate_daily_briefing()` |
| "일정만 브리핑해줘" | `generate_daily_briefing(include_tasks=false, include_emails=false)` |

---

## 4. 발화-액션 매핑 예시

### 4.1 태스크 관련

| 사용자 발화 | 의도 | Tool 호출 |
|------------|------|-----------|
| "내 태스크 보여줘" | 본인 태스크 조회 | `get_tasks(owner=me)` |
| "이번 주 마감인 거" | 기간 필터 조회 | `get_tasks(due_date_start=월, due_date_end=일)` |
| "김채욱 태스크 뭐 있어?" | 타인 태스크 조회 | `get_tasks(owner=김채욱)` |
| "레드티밍 관련 업무" | 키워드 검색 | `get_tasks(keyword=레드티밍)` |
| "이거 완료 처리해줘" | 상태 변경 | `update_task(task_id=context, status=Done)` |
| "블로킹으로 바꿔줘" | 상태 변경 | `update_task(task_id=context, status=Blocked)` |
| "담당자 이수진으로" | 담당자 변경 | `update_task(task_id=context, owner=이수진)` |
| "마감 금요일로 미뤄줘" | 마감일 변경 | `update_task(task_id=context, due_date=금요일)` |
| "새 태스크 만들어줘, 보고서 작성" | 태스크 생성 | `create_task(title=보고서 작성)` |

### 4.2 캘린더 관련

| 사용자 발화 | 의도 | Tool 호출 |
|------------|------|-----------|
| "오늘 일정 뭐야?" | 일정 조회 | `get_calendar_events(time=오늘)` |
| "내일 오후에 미팅 잡아줘" | 일정 생성 | `create_calendar_event(...)` |
| "김채욱이랑 미팅 잡을 수 있는 시간" | 가용 확인 | `check_availability(users=[me, 김채욱])` |
| "그 미팅 3시로 옮겨줘" | 일정 수정 | `update_calendar_event(event_id=context, start=3시)` |
| "내일 팀 미팅 취소해줘" | 일정 삭제 | `delete_calendar_event(event_id=...)` |

### 4.3 메일 관련

| 사용자 발화 | 의도 | Tool 호출 |
|------------|------|-----------|
| "오늘 온 메일 정리해줘" | 메일 조회 | `get_emails(after_date=오늘)` |
| "안 읽은 메일 있어?" | 미읽음 조회 | `get_emails(is_unread=true)` |
| "이 메일에서 할 일 뽑아줘" | 액션 추출 | `extract_action_items(message_id=context)` |
| "이거 태스크로 만들어줘" | 메일→태스크 | `create_task_from_email(...)` |

### 4.4 복합 요청

| 사용자 발화 | 의도 | Tool 호출 순서 |
|------------|------|---------------|
| "이 태스크 담당자들이랑 미팅 잡아줘" | 태스크→미팅 | 1) `get_task_detail` → 2) `check_availability` → 3) `create_calendar_event` |
| "오늘 마감인데 아직 안 끝난 거 리마인드 보내줘" | 조건 조회+알림 | 1) `get_tasks(due=오늘, status≠Done)` → 슬랙 메시지 구성 |

---

## 5. 컨텍스트 관리

### 5.1 컨텍스트 저장 시점

| 이벤트 | 저장 내용 |
|--------|----------|
| 태스크 조회 결과 반환 | `last_task_id`, `last_task_name` (마지막 언급된 것) |
| 태스크 상세 조회 | `last_task_id`, `last_task_name` |
| 일정 조회 결과 반환 | `last_event_id`, `last_event_name` |
| 메일 조회/상세 | `last_email_id`, `last_email_subject` |

### 5.2 컨텍스트 참조 키워드

```typescript
const contextKeywords = {
  task: ["그거", "그 태스크", "이거", "이 태스크", "아까 그거", "방금 그거"],
  event: ["그 미팅", "그 일정", "아까 미팅", "그 회의"],
  email: ["그 메일", "이 메일", "아까 메일", "방금 메일"]
};
```

### 5.3 컨텍스트 해석 로직

```typescript
function resolveContext(userMessage: string, context: ConversationContext) {
  // 태스크 컨텍스트 참조 확인
  if (contextKeywords.task.some(k => userMessage.includes(k))) {
    if (context.last_task_id) {
      return { type: 'task', id: context.last_task_id };
    }
  }
  
  // 일정 컨텍스트 참조 확인
  if (contextKeywords.event.some(k => userMessage.includes(k))) {
    if (context.last_event_id) {
      return { type: 'event', id: context.last_event_id };
    }
  }
  
  // 컨텍스트 없으면 확인 요청
  return { type: 'unknown', requiresClarification: true };
}
```

### 5.4 컨텍스트 TTL

- 기본 만료: **24시간**
- 새 대화 시작 시 (다른 스레드): 새 컨텍스트 생성
- 같은 스레드 내: 컨텍스트 유지 및 갱신

---

## 6. 에러 처리 및 응답

### 6.1 에러 유형별 응답

| 에러 상황 | 사용자 응답 |
|----------|------------|
| 태스크를 찾을 수 없음 | "해당 태스크를 찾을 수 없어요. 다른 키워드로 검색해볼까요?" |
| 권한 없음 | "이 작업을 수행할 권한이 없어요. 관리자에게 문의해주세요." |
| API 오류 | "잠시 문제가 생겼어요. 조금 후에 다시 시도해주세요." |
| 컨텍스트 없음 | "어떤 태스크를 말씀하시는 건가요? 태스크 이름을 알려주세요." |
| 사용자 매핑 없음 | "아직 등록되지 않은 사용자예요. `/paimy register`로 먼저 등록해주세요." |
| 모호한 검색 결과 | "여러 개가 검색됐어요:\n• 태스크A\n• 태스크B\n어떤 걸 말씀하시는 건가요?" |

### 6.2 확인 요청 패턴

**변경 전 확인 (위험한 작업):**
```
"이 태스크를 삭제할까요?"
→ 삭제는 확인 필요

"레드티밍 가드레일 검증" 태스크를 완료 처리할까요?
→ 컨텍스트가 불명확할 때
```

**바로 실행 (안전한 작업):**
```
"내 태스크 보여줘"
→ 조회는 바로 실행

"이거 완료해줘" (컨텍스트 명확)
→ 바로 실행 후 결과 보고
```

---

## 7. 응답 포맷 가이드

### 7.1 태스크 목록

```
📋 이번 주 마감 태스크 3건

1. **레드티밍 가드레일 검증** 
   마감: 금요일 | 상태: In Progress | 우선순위: High

2. **보안 정책 문서 업데이트**
   마감: 목요일 | 상태: In Progress | 우선순위: Medium

3. **API 성능 테스트**
   마감: 수요일 | 상태: Backlog | 우선순위: Low
```

### 7.2 일정 목록

```
📅 오늘 일정 (1월 15일 월요일)

• 10:00-11:00  팀 스탠드업
• 14:00-15:00  레드티밍 킥오프 미팅
• 16:30-17:00  1:1 with 김채욱
```

### 7.3 작업 완료 피드백

```
✅ 완료했어요!

"레드티밍 가드레일 검증" 태스크를 Done으로 변경했어요.
→ [노션에서 보기](https://notion.so/...)
```

### 7.4 메일 요약

```
📧 오늘 온 중요 메일 2건

1. **[긴급] Q1 예산 검토 요청** (김부장님)
   → 금주 내 검토 필요

2. **레드티밍 프로젝트 일정 조율** (이수진)
   → 미팅 시간 확정 요청
```

---

## 8. 구현 체크리스트

### 8.1 시스템 프롬프트

- [ ] 기본 프롬프트 작성 및 테스트
- [ ] 컨텍스트 주입 템플릿 구현
- [ ] 모닝 브리핑/주간 리포트 프롬프트 작성

### 8.2 Tools

- [ ] Notion Tools (get_tasks, get_task_detail, update_task, create_task)
- [ ] Calendar Tools (get, create, update, delete, availability)
- [ ] Gmail Tools (get_emails, get_detail, extract_action_items)
- [ ] Cross-platform Tools (create_task_from_email)

### 8.3 컨텍스트

- [ ] 컨텍스트 저장/조회 로직
- [ ] 컨텍스트 키워드 감지
- [ ] TTL 관리

### 8.4 에러 처리

- [ ] 에러 유형별 응답 메시지
- [ ] 재시도 로직
- [ ] 로깅

---
