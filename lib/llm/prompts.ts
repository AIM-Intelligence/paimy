/**
 * Claude 시스템 프롬프트 및 응답 포맷
 */

// === 시스템 프롬프트 ===

export const SYSTEM_PROMPT = `당신은 Paimy, 사내 AI PM 어시스턴트입니다.
슬랙을 통해 팀원들의 프로젝트 관리를 도와줍니다.

## 역할
- 노션 태스크 조회, 생성, 수정
- 프로젝트별 태스크 관리
- 업무 현황 브리핑
- 마감일 리마인드

## 데이터베이스 구조

### 태스크 DB
- 이름 (제목)
- 상태: Backlog, In Progress, Blocked, Done
- 담당자 (Person)
- 참여자 (Person, 다중)
- 마감일 (Date)
- 우선순위: High, Medium, Low
- 프로젝트 (Relation) - 프로젝트 DB와 연결
- 팀 (Select) - 담당자 기반 자동 계산
- 소스: Manual, Slack, Gmail, Calendar
- 원본 링크 (URL)

### 프로젝트 DB
- 프로젝트명
- 오너 (Person)
- 목표
- 기한
- 상태: Active, On Hold, Completed, Archived

## 프로젝트 추론 규칙
1. 사용자가 명시적으로 프로젝트를 언급하면 해당 프로젝트 연결
2. 태스크 내용에서 프로젝트 키워드가 발견되면 추론하여 연결
3. 확실하지 않으면 프로젝트 없이 생성

## 성격
- 친근하고 간결하게 대화
- 핵심 정보를 먼저 전달
- 사용자 이름을 불러주고 개인화된 조언 제공

## Slack 포맷팅 규칙
- 볼드, 이탤릭 등 특수 포맷팅 사용 금지
- *, **, _, ~ 등으로 텍스트를 감싸지 마세요
- 일반 텍스트만 사용하세요

## 이모지 사용 규칙
- 이모지를 적절히 사용
- 핵심 정보를 먼저 전달

## Tool 사용 필수 규칙

### 1. 검색 우선 원칙 (Search-First Principle)
- 태스크를 수정/업데이트할 때는 반드시 먼저 get_tasks 도구로 태스크를 검색하여 정확한 task_id를 확인하세요
- task_name만으로 직접 update_task_status, update_task_owner, update_task_due_date를 호출하지 마세요
- get_tasks 검색 결과에서 task_id를 얻은 후, 해당 task_id로 수정 도구를 호출하세요

### 2. 거짓 성공 금지 (No False Claims)
- tool 호출 없이 절대로 태스크 변경/생성을 완료했다고 주장하지 마세요
- tool 결과에 error가 있으면 사용자에게 정확히 알려주세요. 성공했다고 거짓말하지 마세요
- tool을 호출하지 않았다면, 작업을 수행하지 않은 것입니다

### 3. 검색 실패 시 재시도
- 검색 결과가 없으면 키워드를 더 짧게 줄여서 재검색하세요
- 예: "테스트 2" 검색 실패 시 → "테스트"로 재검색 후 결과에서 올바른 태스크 선택
- 번호가 포함된 태스크명("테스트 2", "태스크 3")은 기본 키워드("테스트", "태스크")로 먼저 검색하여 후보를 확인하세요

### 4. 여러 태스크 동시 처리
- "테스트 2, 3을 Done으로" 같은 요청은 각 태스크를 개별적으로 처리하세요
- 먼저 get_tasks로 후보 목록을 검색한 후, 각 태스크에 대해 개별 update를 호출하세요
- 한 번의 get_tasks 호출로 여러 후보를 찾고, 각각의 task_id로 개별 수정하세요

### 5. 검색 키워드 전략
- 숫자가 포함된 태스크명은 숫자 부분을 제외한 기본 키워드로 먼저 검색하세요
- keyword에 공백 구분이 민감합니다. 가능한 짧은 키워드를 사용하세요
- limit을 넉넉하게 설정하세요 (최소 5~10)

## 응답 규칙

### 1. 태스크 목록 응답 형식
각 태스크를 아래 형식으로 표시:
1. 태스크명
   👤 담당자 | 📅 마감일 | 상태

예시:
1. 삼성카드 PoC 미팅 준비
   👤 YouJun | 📅 01-15 | Backlog

2. 하나은행 메일 보내기
   👤 채욱님 | 📅 02-09 | Backlog

### 2. 모호한 요청 처리
- "내 태스크" → 요청자 담당 태스크
- "급한 거" → High 우선순위 또는 마감 임박
- "그거" → 대화 컨텍스트에서 추론

### 3. 스레드 대화 컨텍스트 활용
- 이전 대화 내용이 제공되면 반드시 참고하세요
- "그거", "아까 그거", "위에 거" 등은 스레드 맥락에서 추론
- 후속 질문은 이전 대화의 맥락을 이어받아 처리
- 이전에 조회한 태스크가 있으면 "그거"로 참조 가능

### 4. 실패 시
- 명확한 이유 설명
- 대안 제시 (가능하면)

### 5. 확인 요청
- 중요 변경 전 확인 (상태 변경, 담당자 변경)
- 단, 사용자가 명확히 지시했으면 바로 실행

## 컨텍스트 정보
- 사용자 정보는 메시지와 함께 제공됩니다
- 이전 대화의 태스크 컨텍스트가 있으면 활용하세요
`;

// === 컨텍스트 프롬프트 생성 ===

export interface UserContext {
  slackId: string;
  slackDisplayName: string;
  notionId: string | null;
  notionName: string | null;
  sourceUrl?: string; // Slack 메시지 원본 URL
}

export interface ThreadMessageContext {
  role: 'user' | 'assistant';
  userName: string;
  content: string;
}

export interface ConversationContextData {
  lastTaskId?: string;
  lastTaskName?: string;
  lastEventId?: string;
  lastEmailId?: string;
  threadHistory?: ThreadMessageContext[];
}

/**
 * 사용자 컨텍스트 프롬프트 생성
 */
export function buildUserContextPrompt(user: UserContext): string {
  let prompt = `\n## 현재 사용자\n`;
  prompt += `- Slack: ${user.slackDisplayName} (${user.slackId})\n`;

  if (user.notionId) {
    prompt += `- Notion: ${user.notionName || '이름 없음'} (${user.notionId})\n`;
  } else {
    prompt += `- Notion: 연동되지 않음\n`;
  }

  return prompt;
}

/**
 * 대화 컨텍스트 프롬프트 생성
 */
export function buildConversationContextPrompt(
  context: ConversationContextData | null
): string {
  if (!context) {
    return '';
  }

  let prompt = `\n## 이전 대화 컨텍스트\n`;

  if (context.lastTaskId && context.lastTaskName) {
    prompt += `- 마지막 언급 태스크: "${context.lastTaskName}" (ID: ${context.lastTaskId})\n`;
  }

  if (context.lastEventId) {
    prompt += `- 마지막 언급 일정 ID: ${context.lastEventId}\n`;
  }

  if (context.lastEmailId) {
    prompt += `- 마지막 언급 이메일 ID: ${context.lastEmailId}\n`;
  }

  return prompt;
}

/**
 * 스레드 히스토리 프롬프트 생성
 */
export function buildThreadHistoryPrompt(
  threadHistory: ThreadMessageContext[] | undefined
): string {
  if (!threadHistory || threadHistory.length === 0) {
    return '';
  }

  let prompt = `\n## 이전 대화 내용 (스레드)\n`;
  prompt += `최근 ${threadHistory.length}개의 메시지:\n\n`;

  for (const msg of threadHistory) {
    const roleLabel = msg.role === 'assistant' ? '🤖 Paimy' : `👤 ${msg.userName}`;
    prompt += `**${roleLabel}**: ${msg.content}\n\n`;
  }

  prompt += `---\n위 대화를 참고하여 현재 요청에 응답하세요. "그거", "아까 그거", "위에 거" 등은 이전 대화에서 언급된 항목을 의미합니다.\n`;

  return prompt;
}

/**
 * 현재 날짜/시간 프롬프트 생성
 */
function buildCurrentDatePrompt(): string {
  const now = new Date();
  const weekdays = ['일', '월', '화', '수', '목', '금', '토'];
  const dayName = weekdays[now.getDay()];
  const dateStr = now.toISOString().split('T')[0];

  let prompt = `\n## 현재 시간 정보\n`;
  prompt += `- 오늘: ${dateStr} (${dayName}요일)\n`;

  // 다음 주 요일별 날짜 미리 계산 (LLM의 날짜 계산 오류 방지)
  prompt += `- 다음 주 날짜 참고:\n`;
  for (let i = 0; i < 7; i++) {
    const futureDate = new Date(now);
    const daysUntil = (7 - now.getDay()) + i;
    futureDate.setDate(now.getDate() + daysUntil);
    const futureDateStr = futureDate.toISOString().split('T')[0];
    prompt += `  - 다음주 ${weekdays[i]}요일: ${futureDateStr}\n`;
  }

  prompt += `\n### 마감일 설정 시 주의사항\n`;
  prompt += `- 마감일은 반드시 한국어 표현("다음주 월요일", "3월 3일", "이번주 금요일" 등)을 그대로 전달하세요\n`;
  prompt += `- 직접 날짜를 계산해서 YYYY-MM-DD 형식으로 변환하지 마세요. 시스템이 자동으로 계산합니다\n`;

  return prompt;
}

/**
 * 프로젝트 목록 프롬프트 생성
 */
async function buildProjectListPrompt(): Promise<string> {
  try {
    const { getProjects } = await import('../mcp/notion.js');
    const projects = await getProjects();

    if (projects.length === 0) {
      return '';
    }

    let prompt = `\n## 현재 프로젝트 목록\n`;
    prompt += `태스크 생성 시 아래 프로젝트 중 적절한 것을 연결하세요:\n\n`;

    const activeProjects = projects.filter((p: { status: string | null }) => p.status === 'Active');
    for (const project of activeProjects) {
      prompt += `- **${project.name}** (ID: ${project.id})`;
      if (project.owner) {
        prompt += ` - 오너: ${project.owner.name}`;
      }
      prompt += '\n';
    }

    return prompt;
  } catch (error) {
    console.error('Failed to build project list prompt:', error);
    return '';
  }
}

/**
 * 팀원 정보 프롬프트 생성 (별칭 포함)
 */
async function buildTeamMembersPrompt(): Promise<string> {
  try {
    const { getAllActiveUsers } = await import('../db/supabase.js');
    const users = await getAllActiveUsers();

    if (users.length === 0) {
      return '';
    }

    let prompt = `\n## 팀원 정보\n`;
    prompt += `태스크 배정 시 아래 정보를 참고하세요. 별칭으로 언급해도 해당 팀원을 인식하세요:\n\n`;

    for (const user of users) {
      prompt += `- ${user.notion_name || user.slack_display_name || user.slack_username}`;
      if (user.notion_id) {
        prompt += ` (Notion ID: ${user.notion_id})`;
      }
      if (user.aliases && user.aliases.length > 0) {
        prompt += ` — 별칭: ${user.aliases.join(', ')}`;
      }
      if (user.team) {
        prompt += ` [${user.team}]`;
      }
      prompt += '\n';
    }

    return prompt;
  } catch (error) {
    console.error('Failed to build team members prompt:', error);
    return '';
  }
}

/**
 * 전체 시스템 프롬프트 생성
 * (스레드 히스토리는 messages 배열에 추가되므로 시스템 프롬프트에서 제외)
 */
export async function buildFullSystemPrompt(
  user: UserContext,
  conversationContext: ConversationContextData | null
): Promise<string> {
  let prompt = SYSTEM_PROMPT;
  prompt += buildCurrentDatePrompt();
  prompt += buildUserContextPrompt(user);
  prompt += buildConversationContextPrompt(conversationContext);
  prompt += await buildProjectListPrompt();
  prompt += await buildTeamMembersPrompt();
  return prompt;
}

// === 응답 포맷 헬퍼 ===

export interface TaskForDisplay {
  name: string;
  status: string | null;
  dueDate: string | null;
  priority: string | null;
  url: string;
}

/**
 * 태스크 목록 포맷팅
 */
export function formatTaskList(tasks: TaskForDisplay[]): string {
  if (tasks.length === 0) {
    return '조회된 태스크가 없습니다.';
  }

  const lines = tasks.map((task, index) => {
    const status = task.status || '상태 없음';
    const dueDate = task.dueDate || '마감일 없음';
    const priority = task.priority ? `[${task.priority}]` : '';

    return `${index + 1}. ${priority} ${task.name}\n   마감: ${dueDate} | 상태: ${status}`;
  });

  return lines.join('\n\n');
}

/**
 * 단일 태스크 상세 포맷팅
 */
export function formatTaskDetail(task: TaskForDisplay & {
  owner?: string | null;
  description?: string | null;
}): string {
  let result = `${task.name}\n\n`;

  result += `• 상태: ${task.status || '없음'}\n`;
  result += `• 마감일: ${task.dueDate || '없음'}\n`;
  result += `• 우선순위: ${task.priority || '없음'}\n`;

  if (task.owner) {
    result += `• 담당자: ${task.owner}\n`;
  }

  if (task.description) {
    result += `\n상세:\n${task.description}\n`;
  }

  result += `\n<${task.url}|노션에서 보기>`;

  return result;
}

/**
 * 성공 메시지 포맷팅
 */
export function formatSuccessMessage(action: string, taskName: string): string {
  return `✅ "${taskName}" ${action} 완료!`;
}

/**
 * 오류 메시지 포맷팅
 */
export function formatErrorMessage(error: string): string {
  return `❌ ${error}`;
}

/**
 * 확인 요청 메시지 포맷팅
 */
export function formatConfirmationRequest(
  action: string,
  taskName: string
): string {
  return `"${taskName}"을(를) ${action}할까요?`;
}
