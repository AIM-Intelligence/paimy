import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getAllActiveUsers, type UserMapping } from '../../lib/db/supabase.js';
import { getTasks, getDateRange, type Task } from '../../lib/mcp/notion.js';
import { sendDM } from '../../lib/slack/responder.js';

// 배치 크기 설정 (rate limit 회피용)
const BATCH_SIZE = 5;
const BATCH_DELAY_MS = 1000;

/**
 * 일일 모닝 브리핑 Cron Job
 * 실행: 매일 09:00 KST (UTC 00:00)
 *
 * 브리핑 내용:
 * - 오늘 마감 태스크
 * - 진행 중인 태스크
 * - 지연된 태스크 (마감일 지남)
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Vercel Cron은 GET 요청
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Vercel Cron 인증 (선택적)
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    // CRON_SECRET이 설정되지 않으면 인증 스킵 (개발 환경)
    if (process.env.CRON_SECRET) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  try {
    console.log('Starting morning briefing job...');

    // 1. 모든 활성 사용자 조회
    const allUsers = await getAllActiveUsers();
    // Notion ID가 있는 사용자만 필터
    const users = allUsers.filter((u) => u.notion_id);
    console.log(`Found ${users.length} users with Notion ID (total: ${allUsers.length})`);

    const results: { userId: string; success: boolean; error?: string }[] = [];

    // 2. 배치로 나누어 처리 (rate limit 회피)
    const batches: UserMapping[][] = [];
    for (let i = 0; i < users.length; i += BATCH_SIZE) {
      batches.push(users.slice(i, i + BATCH_SIZE));
    }

    console.log(`Processing ${batches.length} batches of ${BATCH_SIZE} users each`);

    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex];
      console.log(`Processing batch ${batchIndex + 1}/${batches.length}`);

      // 배치 내 사용자는 병렬 처리
      const batchResults = await Promise.all(
        batch.map(async (user) => {
          try {
            const briefingResult = await sendBriefingToUser(user);
            return {
              userId: user.slack_id,
              success: briefingResult.success,
              error: briefingResult.error,
            };
          } catch (err) {
            console.error(`Failed to send briefing to ${user.slack_id}:`, err);
            return {
              userId: user.slack_id,
              success: false,
              error: err instanceof Error ? err.message : 'Unknown error',
            };
          }
        })
      );

      results.push(...batchResults);

      // 마지막 배치가 아니면 대기 (rate limit 회피)
      if (batchIndex < batches.length - 1) {
        await sleep(BATCH_DELAY_MS);
      }
    }

    const successCount = results.filter((r) => r.success).length;
    console.log(`Morning briefing completed: ${successCount}/${results.length} sent`);

    return res.status(200).json({
      success: true,
      message: `Morning briefing sent to ${successCount}/${results.length} users`,
      timestamp: new Date().toISOString(),
      results,
    });
  } catch (error) {
    console.error('Morning briefing job failed:', error);
    return res.status(500).json({
      success: false,
      error: 'Job execution failed',
    });
  }
}

/**
 * 대기 헬퍼 함수
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 사용자에게 브리핑 발송
 */
async function sendBriefingToUser(
  user: UserMapping
): Promise<{ success: boolean; error?: string }> {
  const today = getDateRange('today');
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split('T')[0];

  // 태스크 조회 병렬 실행 (API 호출 시간 단축)
  const [todayTasks, inProgressTasks, overdueTasks] = await Promise.all([
    // 1. 오늘 마감 태스크
    getTasks({
      ownerNotionId: user.notion_id!,
      dueDateStart: today.start,
      dueDateEnd: today.end,
      limit: 10,
    }),
    // 2. 진행 중인 태스크 (In Progress)
    getTasks({
      ownerNotionId: user.notion_id!,
      status: 'In Progress',
      limit: 10,
    }),
    // 3. 지연된 태스크 (마감일 < 오늘)
    getTasks({
      ownerNotionId: user.notion_id!,
      dueDateEnd: yesterdayStr,
      limit: 10,
    }),
  ]);

  // Done이 아닌 것만 필터
  const todayPending = todayTasks.filter((t) => t.status !== 'Done');
  const actualOverdue = overdueTasks.filter(
    (t) => t.status !== 'Done' && t.dueDate && t.dueDate < today.start
  );

  // 4. 태스크가 없으면 브리핑 스킵
  if (todayPending.length === 0 && inProgressTasks.length === 0 && actualOverdue.length === 0) {
    console.log(`No tasks for user ${user.slack_id}, skipping briefing`);
    return { success: true };
  }

  // 5. 브리핑 메시지 생성
  const message = formatBriefingMessage(user, todayPending, inProgressTasks, actualOverdue);

  // 6. DM 발송
  await sendDM(user.slack_id, message);
  console.log(`Briefing sent to ${user.slack_display_name || user.slack_id}`);

  return { success: true };
}

/**
 * 브리핑 메시지 포맷팅
 */
function formatBriefingMessage(
  user: UserMapping,
  todayTasks: Task[],
  inProgressTasks: Task[],
  overdueTasks: Task[]
): string {
  const name = user.slack_display_name || user.notion_name || '팀원';
  const lines: string[] = [];

  lines.push(`${name}님, 좋은 아침이에요! 오늘 업무 현황이에요.\n`);

  // 지연된 태스크 (있으면 먼저 표시)
  if (overdueTasks.length > 0) {
    lines.push(`지연된 태스크 (${overdueTasks.length}개)`);
    overdueTasks.forEach((task, i) => {
      lines.push(formatTaskLine(task, i + 1));
    });
    lines.push('');
  }

  // 오늘 마감 태스크
  if (todayTasks.length > 0) {
    lines.push(`오늘 마감 (${todayTasks.length}개)`);
    todayTasks.forEach((task, i) => {
      lines.push(formatTaskLine(task, i + 1));
    });
    lines.push('');
  }

  // 진행 중인 태스크
  if (inProgressTasks.length > 0) {
    // 오늘 마감/지연 태스크와 중복 제거
    const todayIds = new Set(todayTasks.map((t) => t.id));
    const overdueIds = new Set(overdueTasks.map((t) => t.id));
    const filtered = inProgressTasks.filter((t) => !todayIds.has(t.id) && !overdueIds.has(t.id));

    if (filtered.length > 0) {
      lines.push(`진행 중 (${filtered.length}개)`);
      filtered.forEach((task, i) => {
        lines.push(formatTaskLine(task, i + 1));
      });
      lines.push('');
    }
  }

  lines.push('오늘도 화이팅!');

  return lines.join('\n');
}

/**
 * 태스크 한 줄 포맷
 */
function formatTaskLine(task: Task, num: number): string {
  const status = task.status || 'Backlog';
  const priority = task.priority ? ` | ${task.priority}` : '';
  const dueDate = task.dueDate ? formatDate(task.dueDate) : '';
  const duePart = dueDate ? ` | ${dueDate}` : '';

  return `${num}. ${task.name}\n   ${status}${priority}${duePart}`;
}

/**
 * 날짜 포맷 (오늘, 내일, 또는 MM-DD)
 */
function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  const today = new Date();
  const tomorrow = new Date();
  tomorrow.setDate(today.getDate() + 1);

  const dateOnly = dateStr.split('T')[0];
  const todayOnly = today.toISOString().split('T')[0];
  const tomorrowOnly = tomorrow.toISOString().split('T')[0];

  if (dateOnly === todayOnly) return '오늘';
  if (dateOnly === tomorrowOnly) return '내일';

  const month = date.getMonth() + 1;
  const day = date.getDate();
  return `${month}/${day}`;
}
