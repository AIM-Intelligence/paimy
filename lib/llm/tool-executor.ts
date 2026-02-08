/**
 * Tool 실행 모듈
 * Claude가 호출한 Tool을 실제로 실행
 */

import {
  ToolName,
  GetTasksInput,
  GetTaskDetailInput,
  UpdateTaskStatusInput,
  UpdateTaskOwnerInput,
  UpdateTaskDueDateInput,
  CreateTaskInput,
  GetDailyBriefingInput,
  GetProjectsInput,
} from './tools';
import { UserContext, ConversationContextData } from './prompts';
import {
  getTasks,
  getTaskDetail,
  updateTask,
  createTask,
  getDateRange,
  Task,
  TaskFilter,
  getProjects,
  findProjectByName,
} from '../mcp/notion';
import {
  getUserMappingBySlackId,
  findUsersByName,
} from '../db/supabase';

// === 타입 정의 ===

export interface ToolResult {
  data: unknown;
  contextUpdate?: Partial<ConversationContextData>;
}

// === 메인 실행 함수 ===

export async function executeToolCall(
  toolName: ToolName,
  input: Record<string, unknown>,
  userContext: UserContext
): Promise<ToolResult> {
  switch (toolName) {
    case 'get_tasks':
      return executeGetTasks(input as unknown as GetTasksInput, userContext);

    case 'get_task_detail':
      return executeGetTaskDetail(input as unknown as GetTaskDetailInput);

    case 'update_task_status':
      return executeUpdateTaskStatus(input as unknown as UpdateTaskStatusInput);

    case 'update_task_owner':
      return executeUpdateTaskOwner(input as unknown as UpdateTaskOwnerInput);

    case 'update_task_due_date':
      return executeUpdateTaskDueDate(input as unknown as UpdateTaskDueDateInput);

    case 'create_task':
      return executeCreateTask(input as unknown as CreateTaskInput, userContext);

    case 'get_daily_briefing':
      return executeGetDailyBriefing(input as unknown as GetDailyBriefingInput, userContext);

    case 'get_projects':
      return executeGetProjects(input as unknown as GetProjectsInput);

    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}

// === 개별 Tool 실행 함수 ===

async function executeGetTasks(
  input: GetTasksInput,
  userContext: UserContext
): Promise<ToolResult> {
  const filter: TaskFilter = {};

  // 담당자 처리
  if (input.owner_name) {
    const ownerNotionId = await resolveOwnerNotionId(input.owner_name, userContext);
    if (ownerNotionId) {
      filter.ownerNotionId = ownerNotionId;
    }
  }

  // 상태
  if (input.status) {
    filter.status = input.status;
  }

  // 마감일 기간
  if (input.due_date_period) {
    const dateRange = getDateRange(input.due_date_period);
    filter.dueDateStart = dateRange.start;
    filter.dueDateEnd = dateRange.end;
  }

  // 우선순위
  if (input.priority) {
    filter.priority = input.priority;
  }

  // 키워드
  if (input.keyword) {
    filter.keyword = input.keyword;
  }

  // 프로젝트 필터
  if (input.project_name) {
    const project = await findProjectByName(input.project_name);
    if (project) {
      filter.projectId = project.id;
    }
  }

  // 팀 필터
  if (input.team) {
    filter.team = input.team;
  }

  // 개수 제한
  filter.limit = input.limit || 10;

  const tasks = await getTasks(filter);

  return {
    data: {
      tasks: tasks.map(formatTaskForLLM),
      count: tasks.length,
    },
  };
}

async function executeGetTaskDetail(
  input: GetTaskDetailInput
): Promise<ToolResult> {
  let task: Task | null = null;

  if (input.task_id) {
    task = await getTaskDetail(input.task_id);
  } else if (input.task_name) {
    // 강화된 검색: resolveTaskId 사용
    const resolution = await resolveTaskId(undefined, input.task_name);
    if (resolution.taskId) {
      task = await getTaskDetail(resolution.taskId);
    } else if (resolution.candidates) {
      return {
        data: {
          error: resolution.error,
          candidates: resolution.candidates,
          hint: '정확한 task_id를 지정하거나 get_tasks로 먼저 검색해주세요.',
        },
      };
    }
  }

  if (!task) {
    return {
      data: { error: '태스크를 찾을 수 없습니다. get_tasks로 먼저 검색해보세요.' },
    };
  }

  return {
    data: { task: formatTaskForLLM(task) },
    contextUpdate: {
      lastTaskId: task.id,
      lastTaskName: task.name,
    },
  };
}

async function executeUpdateTaskStatus(
  input: UpdateTaskStatusInput
): Promise<ToolResult> {
  const resolution = await resolveTaskId(input.task_id, input.task_name);
  if (!resolution.taskId) {
    return {
      data: {
        error: resolution.error || '태스크를 찾을 수 없습니다.',
        candidates: resolution.candidates,
        hint: '정확한 task_id를 지정하거나 get_tasks로 먼저 검색해주세요.',
      },
    };
  }
  const taskId = resolution.taskId;

  const updated = await updateTask(taskId, { status: input.status });

  // 수정 결과 검증
  if (updated.status !== input.status) {
    return {
      data: {
        success: false,
        error: `상태 변경에 실패했습니다. 요청: ${input.status}, 실제: ${updated.status}`,
        task: formatTaskForLLM(updated),
      },
    };
  }

  return {
    data: {
      success: true,
      task: formatTaskForLLM(updated),
    },
    contextUpdate: {
      lastTaskId: updated.id,
      lastTaskName: updated.name,
    },
  };
}

async function executeUpdateTaskOwner(
  input: UpdateTaskOwnerInput
): Promise<ToolResult> {
  const resolution = await resolveTaskId(input.task_id, input.task_name);
  if (!resolution.taskId) {
    return {
      data: {
        error: resolution.error || '태스크를 찾을 수 없습니다.',
        candidates: resolution.candidates,
        hint: '정확한 task_id를 지정하거나 get_tasks로 먼저 검색해주세요.',
      },
    };
  }
  const taskId = resolution.taskId;

  // 담당자 이름 → Notion ID
  const users = await findUsersByName(input.owner_name);
  if (users.length === 0 || !users[0].notion_id) {
    return { data: { error: `"${input.owner_name}" 사용자를 찾을 수 없습니다.` } };
  }

  const updated = await updateTask(taskId, { ownerNotionId: users[0].notion_id });

  // 수정 결과 검증
  if (updated.owner?.id !== users[0].notion_id) {
    return {
      data: {
        success: false,
        error: `담당자 변경에 실패했습니다. 요청: ${users[0].notion_name || input.owner_name}`,
        task: formatTaskForLLM(updated),
      },
    };
  }

  return {
    data: {
      success: true,
      task: formatTaskForLLM(updated),
      newOwner: users[0].notion_name || users[0].slack_display_name,
    },
    contextUpdate: {
      lastTaskId: updated.id,
      lastTaskName: updated.name,
    },
  };
}

async function executeUpdateTaskDueDate(
  input: UpdateTaskDueDateInput
): Promise<ToolResult> {
  const resolution = await resolveTaskId(input.task_id, input.task_name);
  if (!resolution.taskId) {
    return {
      data: {
        error: resolution.error || '태스크를 찾을 수 없습니다.',
        candidates: resolution.candidates,
        hint: '정확한 task_id를 지정하거나 get_tasks로 먼저 검색해주세요.',
      },
    };
  }
  const taskId = resolution.taskId;

  // 날짜 파싱
  const dueDate = parseDueDate(input.due_date);

  const updated = await updateTask(taskId, { dueDate });

  // 수정 결과 검증
  if (updated.dueDate !== dueDate) {
    return {
      data: {
        success: false,
        error: `마감일 변경에 실패했습니다. 요청: ${dueDate}, 실제: ${updated.dueDate}`,
        task: formatTaskForLLM(updated),
      },
    };
  }

  return {
    data: {
      success: true,
      task: formatTaskForLLM(updated),
    },
    contextUpdate: {
      lastTaskId: updated.id,
      lastTaskName: updated.name,
    },
  };
}

async function executeCreateTask(
  input: CreateTaskInput,
  userContext: UserContext
): Promise<ToolResult> {
  const sourceUrl = userContext.sourceUrl;
  // 담당자 결정
  let ownerNotionId: string | undefined;

  if (input.owner_name) {
    ownerNotionId = await resolveOwnerNotionId(input.owner_name, userContext) || undefined;
  } else if (userContext.notionId) {
    // 기본값: 요청자
    ownerNotionId = userContext.notionId;
  }

  // 프로젝트 ID 조회
  let projectId: string | undefined;
  if (input.project_name) {
    const project = await findProjectByName(input.project_name);
    if (project) {
      projectId = project.id;
    }
  }

  // 참여자 이름 → Notion ID 변환
  const participantNotionIds: string[] = [];
  if (input.participant_names && input.participant_names.length > 0) {
    for (const name of input.participant_names) {
      const notionId = await resolveOwnerNotionId(name, userContext);
      if (notionId) {
        participantNotionIds.push(notionId);
      }
    }
  }

  const task = await createTask({
    title: input.title,
    ownerNotionId,
    dueDate: input.due_date ? parseDueDate(input.due_date) : undefined,
    priority: input.priority,
    description: input.description,
    source: 'Slack',
    sourceUrl,
    projectId,
    participantNotionIds: participantNotionIds.length > 0 ? participantNotionIds : undefined,
  });

  return {
    data: {
      success: true,
      task: formatTaskForLLM(task),
      project: projectId ? input.project_name : null,
    },
    contextUpdate: {
      lastTaskId: task.id,
      lastTaskName: task.name,
    },
  };
}

async function executeGetDailyBriefing(
  input: GetDailyBriefingInput,
  userContext: UserContext
): Promise<ToolResult> {
  // 대상 사용자 결정
  let targetNotionId = userContext.notionId;

  if (input.user_name && input.user_name !== 'me') {
    const resolved = await resolveOwnerNotionId(input.user_name, userContext);
    if (resolved) {
      targetNotionId = resolved;
    }
  }

  // 오늘 마감 태스크
  const todayRange = getDateRange('today');
  const todayTasks = await getTasks({
    ownerNotionId: targetNotionId || undefined,
    dueDateStart: todayRange.start,
    dueDateEnd: todayRange.end,
    limit: 20,
  });

  // 이번 주 태스크 (In Progress)
  const weekRange = getDateRange('this_week');
  const weekTasks = await getTasks({
    ownerNotionId: targetNotionId || undefined,
    status: 'In Progress',
    dueDateStart: weekRange.start,
    dueDateEnd: weekRange.end,
    limit: 20,
  });

  // 지연된 태스크 (마감일 지남 + 완료 안됨)
  const overdueTasks = await getTasks({
    ownerNotionId: targetNotionId || undefined,
    dueDateEnd: new Date(Date.now() - 86400000).toISOString().split('T')[0],
    limit: 10,
  });
  const filteredOverdue = overdueTasks.filter((t) => t.status !== 'Done');

  return {
    data: {
      today: todayTasks.map(formatTaskForLLM),
      thisWeek: weekTasks.map(formatTaskForLLM),
      overdue: filteredOverdue.map(formatTaskForLLM),
      summary: {
        todayCount: todayTasks.length,
        weekCount: weekTasks.length,
        overdueCount: filteredOverdue.length,
      },
    },
  };
}

async function executeGetProjects(
  input: GetProjectsInput
): Promise<ToolResult> {
  const projects = await getProjects();

  const filtered = input.include_on_hold
    ? projects.filter(p => p.status === 'Active' || p.status === 'On Hold')
    : projects.filter(p => p.status === 'Active');

  return {
    data: {
      projects: filtered.map(p => ({
        id: p.id,
        name: p.name,
        owner: p.owner?.name || null,
        status: p.status,
        deadline: p.deadline,
        goal: p.goal,
        url: p.url,
      })),
      count: filtered.length,
    },
  };
}

// === 헬퍼 함수 ===

/**
 * 담당자 이름/키워드 → Notion ID 변환
 */
async function resolveOwnerNotionId(
  ownerName: string,
  userContext: UserContext
): Promise<string | null> {
  // "me", "나", "내" 등은 요청자
  if (['me', '나', '내', '본인'].includes(ownerName.toLowerCase())) {
    return userContext.notionId;
  }

  // 이름으로 검색
  const users = await findUsersByName(ownerName);
  if (users.length > 0 && users[0].notion_id) {
    return users[0].notion_id;
  }

  return null;
}

/**
 * 태스크 ID 또는 이름으로 ID 조회 (강화된 검색)
 */
interface TaskResolutionResult {
  taskId: string | null;
  candidates?: Array<{ id: string; name: string }>;
  error?: string;
}

async function resolveTaskId(
  taskId?: string,
  taskName?: string
): Promise<TaskResolutionResult> {
  if (taskId) {
    return { taskId };
  }

  if (!taskName) {
    return { taskId: null, error: '태스크 ID 또는 이름이 필요합니다.' };
  }

  // Step 1: 전체 키워드로 검색 (limit: 5)
  let tasks = await getTasks({ keyword: taskName, limit: 5 });

  // Step 2: 결과 없으면 후행 숫자 제거하고 재검색
  if (tasks.length === 0) {
    const shorterKeyword = taskName.replace(/\s*\d+$/, '').trim();
    if (shorterKeyword && shorterKeyword !== taskName) {
      tasks = await getTasks({ keyword: shorterKeyword, limit: 10 });
    }
  }

  // Step 3: 여전히 없으면 첫 단어만으로 검색
  if (tasks.length === 0) {
    const firstWord = taskName.split(/\s+/)[0];
    if (firstWord && firstWord !== taskName) {
      tasks = await getTasks({ keyword: firstWord, limit: 10 });
    }
  }

  if (tasks.length === 0) {
    return { taskId: null, error: `"${taskName}" 태스크를 찾을 수 없습니다. get_tasks로 먼저 검색해보세요.` };
  }

  // 정확히 일치하는 태스크 우선
  const exactMatch = tasks.find(
    (t) => t.name.trim().toLowerCase() === taskName.trim().toLowerCase()
  );
  if (exactMatch) {
    return { taskId: exactMatch.id };
  }

  // 결과 1개면 바로 사용
  if (tasks.length === 1) {
    return { taskId: tasks[0].id };
  }

  // 여러 후보가 있으면 후보 목록 반환
  return {
    taskId: null,
    candidates: tasks.map((t) => ({ id: t.id, name: t.name })),
    error: `"${taskName}"과(와) 일치하는 태스크가 여러 개 있습니다. 정확한 task_id를 지정해주세요.`,
  };
}

/**
 * 자연어 날짜 → YYYY-MM-DD 변환
 */
function parseDueDate(input: string): string {
  const lower = input.toLowerCase();
  const now = new Date();

  if (lower === 'today' || lower === '오늘') {
    return now.toISOString().split('T')[0];
  }

  if (lower === 'tomorrow' || lower === '내일') {
    now.setDate(now.getDate() + 1);
    return now.toISOString().split('T')[0];
  }

  if (lower === 'next_monday' || lower === '다음주 월요일') {
    const dayOfWeek = now.getDay();
    const daysUntilMonday = dayOfWeek === 0 ? 1 : 8 - dayOfWeek;
    now.setDate(now.getDate() + daysUntilMonday);
    return now.toISOString().split('T')[0];
  }

  // 한국어 요일 매핑 (일=0, 월=1, ..., 토=6)
  const koreanDays: Record<string, number> = {
    '일': 0, '월': 1, '화': 2, '수': 3, '목': 4, '금': 5, '토': 6,
  };

  // "다음주 X요일" 패턴 (다음주 = 이번 주가 아닌 그 다음 주)
  const nextWeekMatch = input.match(/다음주\s*(일|월|화|수|목|금|토)요일/);
  if (nextWeekMatch) {
    const targetDay = koreanDays[nextWeekMatch[1]];
    const currentDay = now.getDay();
    // 다음 주의 해당 요일까지의 일수 계산
    const daysUntilNextWeek = (7 - currentDay) + targetDay;
    now.setDate(now.getDate() + daysUntilNextWeek);
    return now.toISOString().split('T')[0];
  }

  // "이번주 X요일" 패턴
  const thisWeekMatch = input.match(/이번주\s*(일|월|화|수|목|금|토)요일/);
  if (thisWeekMatch) {
    const targetDay = koreanDays[thisWeekMatch[1]];
    const currentDay = now.getDay();
    const diff = targetDay - currentDay;
    now.setDate(now.getDate() + diff);
    return now.toISOString().split('T')[0];
  }

  // "X월 Y일" 패턴 (예: "3월 3일", "12월 25일")
  const koreanDateMatch = input.match(/(\d{1,2})월\s*(\d{1,2})일/);
  if (koreanDateMatch) {
    const month = parseInt(koreanDateMatch[1], 10);
    const day = parseInt(koreanDateMatch[2], 10);
    const year = now.getFullYear();
    // 이미 지난 날짜면 내년으로
    const targetDate = new Date(year, month - 1, day);
    if (targetDate < now) {
      targetDate.setFullYear(year + 1);
    }
    return targetDate.toISOString().split('T')[0];
  }

  // 이미 YYYY-MM-DD 형식이면 그대로
  if (/^\d{4}-\d{2}-\d{2}$/.test(input)) {
    return input;
  }

  // 기본값: 오늘
  return now.toISOString().split('T')[0];
}

/**
 * Task → LLM 친화적 포맷
 */
function formatTaskForLLM(task: Task) {
  return {
    id: task.id,
    name: task.name,
    status: task.status,
    dueDate: task.dueDate,
    priority: task.priority,
    owner: task.owner?.name || null,
    description: task.description,
    url: task.url,
    project: task.project?.name || null,
    team: task.team || null,
  };
}
