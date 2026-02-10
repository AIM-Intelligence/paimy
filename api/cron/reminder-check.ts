import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  getAllActiveUsers,
  getTodayReminders,
  getLastOverdueReminderDate,
  recordReminderSent,
  type UserMapping,
  type ReminderType,
} from '../../lib/db/supabase.js';
import { getTasks, type Task } from '../../lib/mcp/notion.js';
import { sendDM } from '../../lib/slack/responder.js';

// Vercel 함수 설정: 최대 실행 시간 300초 (5분)
export const config = {
  maxDuration: 300,
};

// 배치 크기 설정 (rate limit 회피용)
const BATCH_SIZE = 5;
const BATCH_DELAY_MS = 1000;

// 마감 초과 재알림 주기 (일)
const OVERDUE_RE_REMIND_DAYS = 7;

interface ReminderBatch {
  threeDayTasks: Task[];
  oneDayTasks: Task[];
  todayTasks: Task[];
  overdueTasks: Task[];
}

interface ReminderResult {
  userId: string;
  success: boolean;
  sentCount: number;
  error?: string;
}

/**
 * 마감 리마인드 체크 Cron Job
 * 실행: 매일 15:00 KST (UTC 06:00)
 *
 * 체크 항목:
 * - 마감 3일 전 태스크
 * - 마감 1일 전 (내일) 태스크
 * - 오늘 마감 태스크
 * - 마감 경과 태스크 (최초 + 7일마다 재알림)
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    if (process.env.CRON_SECRET) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  // 주말(토/일) 체크 — cron 설정의 안전장치
  const now = new Date();
  const dayOfWeek = now.getUTCDay(); // UTC 기준 (Vercel cron은 UTC)
  if (dayOfWeek === 0 || dayOfWeek === 6) {
    console.log('Weekend detected, skipping reminder check');
    return res.status(200).json({ success: true, message: 'Skipped (weekend)' });
  }

  try {
    console.log('Starting reminder check job...');

    // 1. 모든 활성 사용자 조회
    const allUsers = await getAllActiveUsers();
    const users = allUsers.filter((u) => u.notion_id);
    console.log(`Found ${users.length} users with Notion ID`);

    const results: ReminderResult[] = [];

    // 2. 배치로 나누어 처리 (rate limit 회피)
    const batches: UserMapping[][] = [];
    for (let i = 0; i < users.length; i += BATCH_SIZE) {
      batches.push(users.slice(i, i + BATCH_SIZE));
    }

    console.log(`Processing ${batches.length} batches`);

    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex];
      console.log(`Processing batch ${batchIndex + 1}/${batches.length}`);

      const batchResults = await Promise.all(
        batch.map(async (user) => {
          try {
            return await processUserReminders(user);
          } catch (err) {
            console.error(`Failed reminder check for ${user.slack_id}:`, err);
            return {
              userId: user.slack_id,
              success: false,
              sentCount: 0,
              error: err instanceof Error ? err.message : 'Unknown error',
            };
          }
        })
      );

      results.push(...batchResults);

      if (batchIndex < batches.length - 1) {
        await sleep(BATCH_DELAY_MS);
      }
    }

    const successCount = results.filter((r) => r.success).length;
    const totalSent = results.reduce((sum, r) => sum + r.sentCount, 0);
    console.log(`Reminder check completed: ${successCount}/${results.length} users, ${totalSent} reminders sent`);

    return res.status(200).json({
      success: true,
      message: `Reminder check completed for ${successCount}/${results.length} users`,
      totalRemindersSent: totalSent,
      timestamp: new Date().toISOString(),
      results,
    });
  } catch (error) {
    console.error('Reminder check job failed:', error);
    return res.status(500).json({
      success: false,
      error: 'Job execution failed',
    });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 사용자 리마인더 처리
 */
async function processUserReminders(user: UserMapping): Promise<ReminderResult> {
  // 1. 태스크 조회
  const tasks = await getTasksForReminder(user);

  // 2. 이미 발송된 리마인더 필터링
  const filtered = await filterAlreadySent(user.slack_id, tasks);

  // 3. 발송할 태스크가 없으면 스킵
  const totalTasks =
    filtered.overdueTasks.length +
    filtered.todayTasks.length +
    filtered.oneDayTasks.length +
    filtered.threeDayTasks.length;

  if (totalTasks === 0) {
    return { userId: user.slack_id, success: true, sentCount: 0 };
  }

  // 4. 통합 메시지 생성
  const message = formatCombinedMessage(
    user,
    filtered.overdueTasks,
    filtered.todayTasks,
    filtered.oneDayTasks,
    filtered.threeDayTasks
  );

  // 5. DM 발송
  await sendDM(user.slack_id, message);
  console.log(`Reminder sent to ${user.slack_display_name || user.slack_id}: ${totalTasks} tasks`);

  // 6. 발송 기록 저장
  await recordSentReminders(user.slack_id, filtered);

  return { userId: user.slack_id, success: true, sentCount: totalTasks };
}

/**
 * 마감 기준 태스크 조회
 */
async function getTasksForReminder(user: UserMapping): Promise<ReminderBatch> {
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const threeDaysOut = new Date(today);
  threeDaysOut.setDate(threeDaysOut.getDate() + 3);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const formatDateStr = (d: Date) => d.toISOString().split('T')[0];

  const [threeDayTasks, oneDayTasks, todayTasks, overdueTasks] = await Promise.all([
    // 3일 후 마감 (정확히 3일 후)
    getTasks({
      ownerNotionId: user.notion_id!,
      dueDateStart: formatDateStr(threeDaysOut),
      dueDateEnd: formatDateStr(threeDaysOut),
      limit: 20,
    }),
    // 내일 마감 (정확히 1일 후)
    getTasks({
      ownerNotionId: user.notion_id!,
      dueDateStart: formatDateStr(tomorrow),
      dueDateEnd: formatDateStr(tomorrow),
      limit: 20,
    }),
    // 오늘 마감 (정확히 오늘)
    getTasks({
      ownerNotionId: user.notion_id!,
      dueDateStart: formatDateStr(today),
      dueDateEnd: formatDateStr(today),
      limit: 20,
    }),
    // 마감 초과 (어제까지)
    getTasks({
      ownerNotionId: user.notion_id!,
      dueDateEnd: formatDateStr(yesterday),
      limit: 20,
    }),
  ]);

  return {
    threeDayTasks: threeDayTasks.filter((t) => t.status !== 'Done'),
    oneDayTasks: oneDayTasks.filter((t) => t.status !== 'Done'),
    todayTasks: todayTasks.filter((t) => t.status !== 'Done'),
    overdueTasks: overdueTasks.filter((t) => t.status !== 'Done'),
  };
}

/**
 * 이미 발송된 리마인더 필터링
 */
async function filterAlreadySent(
  slackId: string,
  tasks: ReminderBatch
): Promise<ReminderBatch> {
  // 오늘 발송된 리마인더 조회
  const todayReminders = await getTodayReminders(slackId);
  const sentToday = new Set(
    todayReminders.map((r) => `${r.taskId}:${r.reminderType}`)
  );

  // 3일 전, 오늘, 1일 전 리마인더 필터링 (오늘 이미 발송된 것 제외)
  const filteredThreeDay = tasks.threeDayTasks.filter(
    (t) => !sentToday.has(`${t.id}:3_day`)
  );
  const filteredOneDay = tasks.oneDayTasks.filter(
    (t) => !sentToday.has(`${t.id}:1_day`)
  );
  const filteredToday = tasks.todayTasks.filter(
    (t) => !sentToday.has(`${t.id}:today`)
  );

  // 마감 초과 태스크는 최초 발송 또는 7일 주기 재발송
  const filteredOverdue: Task[] = [];
  for (const task of tasks.overdueTasks) {
    // 오늘 이미 발송됐으면 스킵
    if (sentToday.has(`${task.id}:overdue`) || sentToday.has(`${task.id}:overdue_weekly`)) {
      continue;
    }

    // 마지막 발송 날짜 확인
    const lastSent = await getLastOverdueReminderDate(slackId, task.id);
    if (!lastSent) {
      // 처음 발송
      filteredOverdue.push(task);
    } else {
      // 7일 지났으면 재발송
      const daysSinceLastSent = Math.floor(
        (Date.now() - lastSent.getTime()) / (1000 * 60 * 60 * 24)
      );
      if (daysSinceLastSent >= OVERDUE_RE_REMIND_DAYS) {
        filteredOverdue.push(task);
      }
    }
  }

  return {
    threeDayTasks: filteredThreeDay,
    oneDayTasks: filteredOneDay,
    todayTasks: filteredToday,
    overdueTasks: filteredOverdue,
  };
}

/**
 * 통합 메시지 포맷팅
 */
function formatCombinedMessage(
  user: UserMapping,
  overdueTasks: Task[],
  todayTasks: Task[],
  oneDayTasks: Task[],
  threeDayTasks: Task[]
): string {
  const name = user.slack_display_name || user.notion_name || '팀원';
  const lines: string[] = [];

  lines.push(`${name}님, 마감 관련 안내드려요.\n`);

  // 마감 초과 (가장 긴급)
  if (overdueTasks.length > 0) {
    lines.push(`[마감 초과] (${overdueTasks.length}개)`);
    overdueTasks.forEach((task, i) => {
      const daysOverdue = getDaysOverdue(task.dueDate!);
      lines.push(`${i + 1}. <${task.url}|${task.name}> | ${daysOverdue}일 초과`);
    });
    lines.push('');
  }

  // 오늘 마감
  if (todayTasks.length > 0) {
    lines.push(`[오늘 마감] (${todayTasks.length}개)`);
    todayTasks.forEach((task, i) => {
      const priority = task.priority || 'Medium';
      lines.push(`${i + 1}. <${task.url}|${task.name}> | ${priority}`);
    });
    lines.push('');
  }

  // 내일 마감
  if (oneDayTasks.length > 0) {
    lines.push(`[내일 마감] (${oneDayTasks.length}개)`);
    oneDayTasks.forEach((task, i) => {
      const priority = task.priority || 'Medium';
      lines.push(`${i + 1}. <${task.url}|${task.name}> | ${priority}`);
    });
    lines.push('');
  }

  // 3일 후 마감
  if (threeDayTasks.length > 0) {
    lines.push(`[3일 후 마감] (${threeDayTasks.length}개)`);
    threeDayTasks.forEach((task, i) => {
      lines.push(`${i + 1}. <${task.url}|${task.name}>`);
    });
    lines.push('');
  }

  lines.push('확인 부탁드려요!');

  return lines.join('\n');
}

/**
 * 마감 초과 일수 계산
 */
function getDaysOverdue(dueDateStr: string): number {
  const dueDate = new Date(dueDateStr);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  dueDate.setHours(0, 0, 0, 0);

  const diffTime = today.getTime() - dueDate.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return diffDays;
}

/**
 * 발송 기록 저장
 */
async function recordSentReminders(
  slackId: string,
  tasks: ReminderBatch
): Promise<void> {
  const recordPromises: Promise<boolean>[] = [];

  for (const task of tasks.threeDayTasks) {
    recordPromises.push(recordReminderSent(slackId, task.id, '3_day'));
  }

  for (const task of tasks.oneDayTasks) {
    recordPromises.push(recordReminderSent(slackId, task.id, '1_day'));
  }

  for (const task of tasks.todayTasks) {
    recordPromises.push(recordReminderSent(slackId, task.id, 'today'));
  }

  for (const task of tasks.overdueTasks) {
    // 마지막 발송이 있으면 weekly, 없으면 overdue
    const lastSent = await getLastOverdueReminderDate(slackId, task.id);
    const reminderType: ReminderType = lastSent ? 'overdue_weekly' : 'overdue';
    recordPromises.push(recordReminderSent(slackId, task.id, reminderType));
  }

  await Promise.all(recordPromises);
}
