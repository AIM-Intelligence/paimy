/**
 * Notion API 클라이언트
 * 태스크 CRUD 및 사용자 조회 기능
 */

import { Client } from '@notionhq/client';

// Notion 클라이언트 싱글톤
let notionClient: Client | null = null;

export function getNotionClient(): Client {
  if (notionClient) {
    return notionClient;
  }

  const token = process.env.NOTION_INTEGRATION_TOKEN?.trim();
  if (!token) {
    throw new Error('NOTION_INTEGRATION_TOKEN is not configured');
  }

  notionClient = new Client({ auth: token });
  return notionClient;
}

// 태스크 DB ID
const getTaskDatabaseId = () => {
  const id = process.env.NOTION_TASK_DATABASE_ID?.trim();
  if (!id) {
    throw new Error('NOTION_TASK_DATABASE_ID is not configured');
  }
  return id;
};

// === 타입 정의 ===

export interface Task {
  id: string;
  name: string;
  status: string | null;
  owner: { id: string; name: string } | null;
  participants: { id: string; name: string }[];
  dueDate: string | null;
  priority: string | null;
  description: string | null;
  source: string | null;
  sourceUrl: string | null;
  url: string;
}

export interface TaskFilter {
  ownerNotionId?: string;
  status?: 'Backlog' | 'In Progress' | 'Blocked' | 'Done';
  dueDateStart?: string;
  dueDateEnd?: string;
  priority?: 'High' | 'Medium' | 'Low';
  keyword?: string;
  limit?: number;
}

// === 태스크 조회 ===

/**
 * 태스크 목록 조회
 */
export async function getTasks(filter: TaskFilter = {}): Promise<Task[]> {
  const notion = getNotionClient();
  const databaseId = getTaskDatabaseId();

  // 필터 조건 구성
  const conditions: any[] = [];

  if (filter.ownerNotionId) {
    conditions.push({
      property: '담당자',
      people: {
        contains: filter.ownerNotionId,
      },
    });
  }

  if (filter.status) {
    conditions.push({
      property: '상태',
      select: {
        equals: filter.status,
      },
    });
  }

  if (filter.dueDateStart) {
    conditions.push({
      property: '마감일',
      date: {
        on_or_after: filter.dueDateStart,
      },
    });
  }

  if (filter.dueDateEnd) {
    conditions.push({
      property: '마감일',
      date: {
        on_or_before: filter.dueDateEnd,
      },
    });
  }

  if (filter.priority) {
    conditions.push({
      property: '우선순위',
      select: {
        equals: filter.priority,
      },
    });
  }

  if (filter.keyword) {
    conditions.push({
      property: '제목',
      title: {
        contains: filter.keyword,
      },
    });
  }

  // 쿼리 실행
  const response = await notion.databases.query({
    database_id: databaseId,
    filter: conditions.length > 0
      ? { and: conditions }
      : undefined,
    sorts: [
      {
        property: '마감일',
        direction: 'ascending',
      },
    ],
    page_size: filter.limit || 10,
  });

  // 결과 파싱
  return response.results.map(parseTaskPage);
}

/**
 * 태스크 상세 조회
 */
export async function getTaskDetail(taskId: string): Promise<Task | null> {
  const notion = getNotionClient();

  try {
    const page = await notion.pages.retrieve({ page_id: taskId });
    return parseTaskPage(page);
  } catch (error: any) {
    if (error.code === 'object_not_found') {
      return null;
    }
    throw error;
  }
}

// === 태스크 수정 ===

export interface TaskUpdate {
  status?: 'Backlog' | 'In Progress' | 'Blocked' | 'Done';
  ownerNotionId?: string;
  dueDate?: string;
  priority?: 'High' | 'Medium' | 'Low';
  description?: string;
}

/**
 * 태스크 업데이트
 */
export async function updateTask(
  taskId: string,
  updates: TaskUpdate
): Promise<Task> {
  const notion = getNotionClient();

  const properties: any = {};

  if (updates.status) {
    properties['상태'] = {
      select: { name: updates.status },
    };
  }

  if (updates.ownerNotionId) {
    properties['담당자'] = {
      people: [{ id: updates.ownerNotionId }],
    };
  }

  if (updates.dueDate) {
    properties['마감일'] = {
      date: { start: updates.dueDate },
    };
  }

  if (updates.priority) {
    properties['우선순위'] = {
      select: { name: updates.priority },
    };
  }

  if (updates.description) {
    properties['실행 상세'] = {
      rich_text: [
        {
          type: 'text',
          text: { content: updates.description },
        },
      ],
    };
  }

  const page = await notion.pages.update({
    page_id: taskId,
    properties,
  });

  return parseTaskPage(page);
}

// === 태스크 생성 ===

export interface TaskCreate {
  title: string;
  ownerNotionId?: string;
  dueDate?: string;
  priority?: 'High' | 'Medium' | 'Low';
  description?: string;
  source?: 'Manual' | 'Slack' | 'Gmail' | 'Calendar';
  sourceUrl?: string;
}

/**
 * 태스크 생성
 */
export async function createTask(data: TaskCreate): Promise<Task> {
  const notion = getNotionClient();
  const databaseId = getTaskDatabaseId();

  const properties: any = {
    제목: {
      title: [
        {
          type: 'text',
          text: { content: data.title },
        },
      ],
    },
    상태: {
      select: { name: 'Backlog' },
    },
  };

  if (data.ownerNotionId) {
    properties['담당자'] = {
      people: [{ id: data.ownerNotionId }],
    };
  }

  if (data.dueDate) {
    properties['마감일'] = {
      date: { start: data.dueDate },
    };
  }

  if (data.priority) {
    properties['우선순위'] = {
      select: { name: data.priority },
    };
  }

  if (data.description) {
    properties['실행 상세'] = {
      rich_text: [
        {
          type: 'text',
          text: { content: data.description },
        },
      ],
    };
  }

  if (data.source) {
    properties['소스'] = {
      select: { name: data.source },
    };
  }

  if (data.sourceUrl) {
    properties['원본 링크'] = {
      url: data.sourceUrl,
    };
  }

  const page = await notion.pages.create({
    parent: { database_id: databaseId },
    properties,
  });

  return parseTaskPage(page);
}

// === 유틸리티 함수 ===

/**
 * Notion 페이지를 Task 객체로 파싱
 */
function parseTaskPage(page: any): Task {
  const props = page.properties;

  // 제목 추출
  const titleProp = props['제목'] || props['태스크명'] || props['Name'];
  const name = titleProp?.title?.[0]?.plain_text || 'Untitled';

  // 담당자 추출
  const ownerProp = props['담당자'];
  const owner = ownerProp?.people?.[0]
    ? { id: ownerProp.people[0].id, name: ownerProp.people[0].name || 'Unknown' }
    : null;

  // 참여자 추출
  const participantsProp = props['참여자'];
  const participants = (participantsProp?.people || []).map((p: any) => ({
    id: p.id,
    name: p.name || 'Unknown',
  }));

  return {
    id: page.id,
    name,
    status: props['상태']?.select?.name || null,
    owner,
    participants,
    dueDate: props['마감일']?.date?.start || null,
    priority: props['우선순위']?.select?.name || null,
    description: props['실행 상세']?.rich_text?.[0]?.plain_text || null,
    source: props['소스']?.select?.name || null,
    sourceUrl: props['원본 링크']?.url || null,
    url: page.url,
  };
}

/**
 * 날짜 문자열 헬퍼 (오늘, 이번 주 등)
 */
export function getDateRange(period: 'today' | 'this_week' | 'next_week'): {
  start: string;
  end: string;
} {
  const now = new Date();
  const today = now.toISOString().split('T')[0];

  switch (period) {
    case 'today':
      return { start: today, end: today };

    case 'this_week': {
      const dayOfWeek = now.getDay();
      const monday = new Date(now);
      monday.setDate(now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);
      return {
        start: monday.toISOString().split('T')[0],
        end: sunday.toISOString().split('T')[0],
      };
    }

    case 'next_week': {
      const dayOfWeek = now.getDay();
      const nextMonday = new Date(now);
      nextMonday.setDate(now.getDate() + (dayOfWeek === 0 ? 1 : 8 - dayOfWeek));
      const nextSunday = new Date(nextMonday);
      nextSunday.setDate(nextMonday.getDate() + 6);
      return {
        start: nextMonday.toISOString().split('T')[0],
        end: nextSunday.toISOString().split('T')[0],
      };
    }
  }
}
