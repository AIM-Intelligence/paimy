/**
 * Claude Tool Use 정의
 * Anthropic Claude API의 Tool Use 기능을 위한 도구 정의
 */

import type { Tool } from '@anthropic-ai/sdk/resources/messages';

// === Tool 정의 ===

export const PAIMY_TOOLS: Tool[] = [
  // 태스크 조회
  {
    name: 'get_tasks',
    description:
      '노션에서 태스크 목록을 조회합니다. 담당자, 상태, 마감일, 우선순위 등으로 필터링할 수 있습니다.',
    input_schema: {
      type: 'object' as const,
      properties: {
        owner_name: {
          type: 'string',
          description: '담당자 이름 (예: "김철수", "me"는 요청자 본인)',
        },
        status: {
          type: 'string',
          enum: ['Backlog', 'In Progress', 'Blocked', 'Done'],
          description: '태스크 상태',
        },
        due_date_period: {
          type: 'string',
          enum: ['today', 'this_week', 'next_week'],
          description: '마감일 기간',
        },
        priority: {
          type: 'string',
          enum: ['High', 'Medium', 'Low'],
          description: '우선순위',
        },
        keyword: {
          type: 'string',
          description: '태스크 제목 검색어',
        },
        limit: {
          type: 'number',
          description: '조회할 최대 개수 (기본값: 10)',
        },
      },
      required: [],
    },
  },

  // 태스크 상세 조회
  {
    name: 'get_task_detail',
    description: '특정 태스크의 상세 정보를 조회합니다.',
    input_schema: {
      type: 'object' as const,
      properties: {
        task_id: {
          type: 'string',
          description: '태스크 ID (노션 페이지 ID)',
        },
        task_name: {
          type: 'string',
          description: '태스크 이름 (ID가 없을 때 검색용)',
        },
      },
      required: [],
    },
  },

  // 태스크 상태 변경
  {
    name: 'update_task_status',
    description: '태스크의 상태를 변경합니다.',
    input_schema: {
      type: 'object' as const,
      properties: {
        task_id: {
          type: 'string',
          description: '태스크 ID',
        },
        task_name: {
          type: 'string',
          description: '태스크 이름 (ID가 없을 때 검색용)',
        },
        status: {
          type: 'string',
          enum: ['Backlog', 'In Progress', 'Blocked', 'Done'],
          description: '변경할 상태',
        },
      },
      required: ['status'],
    },
  },

  // 태스크 담당자 변경
  {
    name: 'update_task_owner',
    description: '태스크의 담당자를 변경합니다.',
    input_schema: {
      type: 'object' as const,
      properties: {
        task_id: {
          type: 'string',
          description: '태스크 ID',
        },
        task_name: {
          type: 'string',
          description: '태스크 이름 (ID가 없을 때 검색용)',
        },
        owner_name: {
          type: 'string',
          description: '새 담당자 이름',
        },
      },
      required: ['owner_name'],
    },
  },

  // 태스크 마감일 변경
  {
    name: 'update_task_due_date',
    description: '태스크의 마감일을 변경합니다.',
    input_schema: {
      type: 'object' as const,
      properties: {
        task_id: {
          type: 'string',
          description: '태스크 ID',
        },
        task_name: {
          type: 'string',
          description: '태스크 이름 (ID가 없을 때 검색용)',
        },
        due_date: {
          type: 'string',
          description: '새 마감일 (YYYY-MM-DD 형식 또는 "tomorrow", "next_monday" 등)',
        },
      },
      required: ['due_date'],
    },
  },

  // 태스크 생성
  {
    name: 'create_task',
    description: '새 태스크를 생성합니다.',
    input_schema: {
      type: 'object' as const,
      properties: {
        title: {
          type: 'string',
          description: '태스크 제목',
        },
        owner_name: {
          type: 'string',
          description: '담당자 이름 (없으면 요청자에게 배정)',
        },
        due_date: {
          type: 'string',
          description: '마감일 (YYYY-MM-DD 형식)',
        },
        priority: {
          type: 'string',
          enum: ['High', 'Medium', 'Low'],
          description: '우선순위',
        },
        description: {
          type: 'string',
          description: '태스크 상세 설명',
        },
      },
      required: ['title'],
    },
  },

  // 오늘의 브리핑 (나중에 캘린더, 이메일 연동 시 확장)
  {
    name: 'get_daily_briefing',
    description: '오늘의 업무 브리핑을 생성합니다. 오늘/이번주 마감 태스크와 주요 일정을 요약합니다.',
    input_schema: {
      type: 'object' as const,
      properties: {
        user_name: {
          type: 'string',
          description: '브리핑 대상 사용자 (기본: 요청자)',
        },
      },
      required: [],
    },
  },
];

// === Tool Input 타입 정의 ===

export interface GetTasksInput {
  owner_name?: string;
  status?: 'Backlog' | 'In Progress' | 'Blocked' | 'Done';
  due_date_period?: 'today' | 'this_week' | 'next_week';
  priority?: 'High' | 'Medium' | 'Low';
  keyword?: string;
  limit?: number;
}

export interface GetTaskDetailInput {
  task_id?: string;
  task_name?: string;
}

export interface UpdateTaskStatusInput {
  task_id?: string;
  task_name?: string;
  status: 'Backlog' | 'In Progress' | 'Blocked' | 'Done';
}

export interface UpdateTaskOwnerInput {
  task_id?: string;
  task_name?: string;
  owner_name: string;
}

export interface UpdateTaskDueDateInput {
  task_id?: string;
  task_name?: string;
  due_date: string;
}

export interface CreateTaskInput {
  title: string;
  owner_name?: string;
  due_date?: string;
  priority?: 'High' | 'Medium' | 'Low';
  description?: string;
}

export interface GetDailyBriefingInput {
  user_name?: string;
}

// Union 타입
export type ToolInput =
  | GetTasksInput
  | GetTaskDetailInput
  | UpdateTaskStatusInput
  | UpdateTaskOwnerInput
  | UpdateTaskDueDateInput
  | CreateTaskInput
  | GetDailyBriefingInput;

// Tool 이름 타입
export type ToolName =
  | 'get_tasks'
  | 'get_task_detail'
  | 'update_task_status'
  | 'update_task_owner'
  | 'update_task_due_date'
  | 'create_task'
  | 'get_daily_briefing';
