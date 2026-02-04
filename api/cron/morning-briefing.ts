import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * 일일 모닝 브리핑 Cron Job
 * 실행: 매일 09:00 KST (UTC 00:00)
 *
 * 브리핑 내용:
 * - 오늘의 일정 (Google Calendar)
 * - 오늘 마감 태스크 (Notion)
 * - 우선순위 높은 업무 (Notion)
 * - 미읽은 중요 메일 (Gmail)
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

    // TODO: 구현 예정
    // 1. getAllActiveUsers()로 전체 사용자 조회
    // 2. 각 사용자별:
    //    - 오늘 일정 조회 (Calendar API)
    //    - 오늘 마감 태스크 조회 (Notion API)
    //    - 미읽은 메일 조회 (Gmail API)
    // 3. LLM으로 브리핑 메시지 생성
    // 4. Slack DM으로 발송

    console.log('Morning briefing job completed');

    return res.status(200).json({
      success: true,
      message: 'Morning briefing job executed',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Morning briefing job failed:', error);
    return res.status(500).json({
      success: false,
      error: 'Job execution failed',
    });
  }
}
