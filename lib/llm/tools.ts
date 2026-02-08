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
          description: '태스크 제목 검색어. 짧은 키워드가 더 정확합니다. 예: "테스트 2"보다 "테스트"로 먼저 검색 후 결과에서 선택.',
        },
        limit: {
          type: 'number',
          description: '조회할 최대 개수 (기본값: 10). 특정 태스크를 찾을 때는 5~10개를 권장합니다.',
        },
        project_name: {
          type: 'string',
          description: '프로젝트 이름 (부분 일치)',
        },
        team: {
          type: 'string',
          description: '팀 이름 (예: "Engineering", "Design")',
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
    description: '태스크의 상태를 변경합니다. 반드시 task_id를 제공하세요. task_id를 모르면 먼저 get_tasks로 검색하세요. task_name만으로는 정확한 태스크를 찾지 못할 수 있습니다.',
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
    description: '태스크의 담당자를 변경합니다. 반드시 task_id를 제공하세요. task_id를 모르면 먼저 get_tasks로 검색하세요. task_name만으로는 정확한 태스크를 찾지 못할 수 있습니다.',
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
    description: '태스크의 마감일을 변경합니다. 반드시 task_id를 제공하세요. task_id를 모르면 먼저 get_tasks로 검색하세요. task_name만으로는 정확한 태스크를 찾지 못할 수 있습니다.',
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
          description: '새 마감일. 형식: YYYY-MM-DD, "tomorrow", "next_monday", 또는 한국어("다음주 수요일", "이번주 금요일" 등)',
        },
      },
      required: ['due_date'],
    },
  },

  // 태스크 생성
  {
    name: 'create_task',
    description: '새 태스크를 생성합니다. 프로젝트와 연결할 수 있습니다.',
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
          description: '마감일. 형식: YYYY-MM-DD, "tomorrow", "next_monday", 또는 한국어("다음주 수요일", "이번주 금요일" 등)',
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
        project_name: {
          type: 'string',
          description: '연결할 프로젝트 이름 (선택)',
        },
        participant_names: {
          type: 'array',
          items: { type: 'string' },
          description: '참여자 이름 목록 (담당자 외 추가 참여자)',
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

  // 프로젝트 목록 조회
  {
    name: 'get_projects',
    description: '활성 프로젝트 목록을 조회합니다.',
    input_schema: {
      type: 'object' as const,
      properties: {
        include_on_hold: {
          type: 'boolean',
          description: 'On Hold 상태 프로젝트 포함 여부 (기본: false)',
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
  project_name?: string;
  team?: string;
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
  project_name?: string;
  participant_names?: string[];
}

export interface GetDailyBriefingInput {
  user_name?: string;
}

export interface GetProjectsInput {
  include_on_hold?: boolean;
}

// Union 타입
export type ToolInput =
  | GetTasksInput
  | GetTaskDetailInput
  | UpdateTaskStatusInput
  | UpdateTaskOwnerInput
  | UpdateTaskDueDateInput
  | CreateTaskInput
  | GetDailyBriefingInput
  | GetProjectsInput;

// Tool 이름 타입
export type ToolName =
  | 'get_tasks'
  | 'get_task_detail'
  | 'update_task_status'
  | 'update_task_owner'
  | 'update_task_due_date'
  | 'create_task'
  | 'get_daily_briefing'
  | 'get_projects';
