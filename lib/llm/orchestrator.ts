/**
 * LLM Orchestrator
 * Claude API 호출 및 Tool Use 실행 관리
 */

import Anthropic from '@anthropic-ai/sdk';
import { PAIMY_TOOLS, ToolName } from './tools';
import {
  buildFullSystemPrompt,
  UserContext,
  ConversationContextData,
  ThreadMessageContext,
} from './prompts';
import { executeToolCall, ToolResult } from './tool-executor';

/** 태스크를 변경하는 툴 목록 */
const MUTATION_TOOLS: Set<string> = new Set([
  'create_task',
  'update_task_status',
  'update_task_owner',
  'update_task_due_date',
]);

interface MutatedTaskInfo {
  name: string;
  url: string;
}

/**
 * 변경된 태스크의 노션 링크 푸터 생성
 * URL 기준 중복 제거 (동일 태스크에 여러 수정이 발생한 경우)
 */
function buildNotionLinkFooter(tasks: MutatedTaskInfo[]): string {
  if (tasks.length === 0) return '';

  const uniqueTasks = new Map<string, MutatedTaskInfo>();
  for (const task of tasks) {
    uniqueTasks.set(task.name, task);
  }

  const links = Array.from(uniqueTasks.values())
    .map(task => `📎 <${task.url}|${task.name} - 노션에서 보기>`)
    .join('\n');

  return '\n\n' + links;
}

// Anthropic 클라이언트 싱글톤
let anthropicClient: Anthropic | null = null;

function getAnthropicClient(): Anthropic {
  if (anthropicClient) {
    return anthropicClient;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY is not configured');
  }

  anthropicClient = new Anthropic({ apiKey });
  return anthropicClient;
}

// === 타입 정의 ===

export interface OrchestratorInput {
  userMessage: string;
  userContext: UserContext;
  conversationContext: ConversationContextData | null;
}

export interface OrchestratorOutput {
  response: string;
  toolsUsed: string[];
  updatedContext: Partial<ConversationContextData>;
}

// === 헬퍼 함수 ===

/**
 * 연속된 같은 role 메시지를 합쳐서 Claude API 규칙에 맞게 변환
 * (Claude API는 user/assistant가 번갈아 나와야 함)
 */
function normalizeMessages(
  history: ThreadMessageContext[]
): Anthropic.MessageParam[] {
  const result: Anthropic.MessageParam[] = [];

  for (const msg of history) {
    const lastMsg = result[result.length - 1];

    if (lastMsg && lastMsg.role === msg.role) {
      // 같은 role이면 내용 합치기
      lastMsg.content += '\n' + msg.content;
    } else {
      result.push({ role: msg.role, content: msg.content });
    }
  }

  return result;
}

// === 메인 함수 ===

/**
 * 사용자 메시지 처리 및 응답 생성
 */
export async function processMessage(
  input: OrchestratorInput
): Promise<OrchestratorOutput> {
  console.log('[Orchestrator] Processing message:', input.userMessage);

  const client = getAnthropicClient();

  // 시스템 프롬프트 생성 (비동기 - 프로젝트 목록 포함)
  const systemPrompt = await buildFullSystemPrompt(
    input.userContext,
    input.conversationContext
  );
  console.log('[Orchestrator] System prompt length:', systemPrompt.length);

  // 초기 메시지 (스레드 히스토리 포함)
  const messages: Anthropic.MessageParam[] = input.conversationContext?.threadHistory
    ? normalizeMessages(input.conversationContext.threadHistory)
    : [];
  messages.push({ role: 'user', content: input.userMessage });

  const toolsUsed: string[] = [];
  const updatedContext: Partial<ConversationContextData> = {};
  const mutatedTasks: MutatedTaskInfo[] = [];

  // Tool Use 루프 (최대 5회)
  let iterations = 0;
  const maxIterations = 5;

  while (iterations < maxIterations) {
    iterations++;

    // Claude API 호출
    console.log('[Orchestrator] Calling Claude API, iteration:', iterations);
    const response = await client.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: parseInt(process.env.LLM_MAX_TOKENS || '2048', 10),
      system: systemPrompt,
      tools: PAIMY_TOOLS,
      messages,
    });
    console.log('[Orchestrator] Claude response stop_reason:', response.stop_reason);
    console.log('[Orchestrator] Claude response content blocks:', response.content.length);

    // 응답 처리
    const textBlocks: string[] = [];
    const toolUseBlocks: Anthropic.ToolUseBlock[] = [];

    for (const block of response.content) {
      if (block.type === 'text') {
        textBlocks.push(block.text);
      } else if (block.type === 'tool_use') {
        toolUseBlocks.push(block);
      }
    }

    // Tool Use가 없으면 종료
    if (toolUseBlocks.length === 0) {
      const finalResponse = textBlocks.join('\n') + buildNotionLinkFooter(mutatedTasks);
      console.log('[Orchestrator] Final response length:', finalResponse.length);
      console.log('[Orchestrator] Final response preview:', finalResponse.substring(0, 100));
      return {
        response: finalResponse,
        toolsUsed,
        updatedContext,
      };
    }

    // Tool 실행
    const toolResults: Anthropic.ToolResultBlockParam[] = [];

    for (const toolUse of toolUseBlocks) {
      toolsUsed.push(toolUse.name);

      try {
        const result = await executeToolCall(
          toolUse.name as ToolName,
          toolUse.input as Record<string, unknown>,
          input.userContext
        );

        // 컨텍스트 업데이트
        if (result.contextUpdate) {
          Object.assign(updatedContext, result.contextUpdate);
        }

        // 뮤테이션 툴인 경우 태스크 정보 수집
        if (MUTATION_TOOLS.has(toolUse.name) && result.data) {
          const data = result.data as { success?: boolean; task?: { name?: string; url?: string } };
          if (data.success && data.task?.url) {
            const taskName = data.task.name || 'Unknown Task';
            if (!mutatedTasks.some(t => t.name === taskName)) {
              mutatedTasks.push({ name: taskName, url: data.task.url });
            }
          }
        }

        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: JSON.stringify(result.data),
        });
      } catch (error: any) {
        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: JSON.stringify({ error: error.message }),
          is_error: true,
        });
      }
    }

    // 메시지 히스토리에 추가
    messages.push({
      role: 'assistant',
      content: response.content,
    });
    messages.push({
      role: 'user',
      content: toolResults,
    });

    // stop_reason이 end_turn이면 종료 (다음 루프에서 텍스트만 응답)
    if (response.stop_reason === 'end_turn') {
      break;
    }
  }

  // 최대 반복 도달 시 마지막 텍스트 반환
  return {
    response: '요청을 처리하는 데 문제가 발생했습니다. 다시 시도해 주세요.' + buildNotionLinkFooter(mutatedTasks),
    toolsUsed,
    updatedContext,
  };
}

/**
 * 간단한 응답 생성 (Tool Use 없이)
 */
export async function generateSimpleResponse(
  systemPrompt: string,
  userMessage: string
): Promise<string> {
  const client = getAnthropicClient();

  const response = await client.messages.create({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 1024,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
  });

  const textContent = response.content.find((block) => block.type === 'text');
  return textContent?.type === 'text' ? textContent.text : '';
}
