import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * 주간 리포트 Cron Job
 * 실행: 매주 월요일 09:00 KST (UTC 00:00)
 *
 * 리포트 내용:
 * - 지난주 완료된 태스크
 * - 이번 주 마감 예정 태스크
 * - 지연 중인 태스크 (마감 경과)
 * - 이번 주 주요 미팅 일정
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

  try {
    console.log('Starting weekly report job...');

    // TODO: 구현 예정
    // 1. 지난주 완료 태스크 집계
    // 2. 이번 주 마감 예정 태스크 조회
    // 3. 지연 태스크 조회
    // 4. 이번 주 미팅 일정 조회
    // 5. LLM으로 리포트 생성
    // 6. 지정 채널에 발송

    console.log('Weekly report job completed');

    return res.status(200).json({
      success: true,
      message: 'Weekly report job executed',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Weekly report job failed:', error);
    return res.status(500).json({
      success: false,
      error: 'Job execution failed',
    });
  }
}
