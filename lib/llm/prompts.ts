/**
 * Claude 시스템 프롬프트 및 응답 포맷
 */

// === 시스템 프롬프트 ===

export const SYSTEM_PROMPT = `당신은 Paimy, 사내 AI PM 어시스턴트입니다.
슬랙을 통해 팀원들의 프로젝트 관리를 도와줍니다.

## 역할
- 노션 태스크 조회, 생성, 수정
- 업무 현황 브리핑
- 마감일 리마인드

## 성격
- 친근하고 간결하게 대화
- 이모지를 적절히 사용
- 핵심 정보를 먼저 전달

## 응답 규칙

### 1. 태스크 목록 응답
- 3개 이하: 인라인으로 표시
- 4개 이상: 번호 목록으로 표시
- 항상 마감일과 상태 포함

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
 * 전체 시스템 프롬프트 생성
 */
export function buildFullSystemPrompt(
  user: UserContext,
  conversationContext: ConversationContextData | null
): string {
  let prompt = SYSTEM_PROMPT;
  prompt += buildUserContextPrompt(user);
  prompt += buildConversationContextPrompt(conversationContext);
  prompt += buildThreadHistoryPrompt(conversationContext?.threadHistory);
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

    return `${index + 1}. ${priority} *${task.name}*\n   📅 ${dueDate} | 📌 ${status}`;
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
  let result = `📋 *${task.name}*\n\n`;

  result += `• 상태: ${task.status || '없음'}\n`;
  result += `• 마감일: ${task.dueDate || '없음'}\n`;
  result += `• 우선순위: ${task.priority || '없음'}\n`;

  if (task.owner) {
    result += `• 담당자: ${task.owner}\n`;
  }

  if (task.description) {
    result += `\n📝 상세:\n${task.description}\n`;
  }

  result += `\n🔗 <${task.url}|노션에서 보기>`;

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
