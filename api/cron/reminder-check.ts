import type { VercelRequest, VercelResponse } from '@vercel/node';

// Vercel 함수 설정: 최대 실행 시간 300초 (5분)
export const config = {
  maxDuration: 300,
};

/**
 * 마감 리마인드 체크 Cron Job
 * 실행: 매시 정각
 *
 * 체크 항목:
 * - 마감 24시간 전 태스크
 * - 마감 3시간 전 태스크
 * - 마감 경과 태스크
 * - 미팅 30분 전, 10분 전
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
    console.log('Starting reminder check job...');

    // TODO: 구현 예정
    // 1. 마감 24시간 전 태스크 조회 및 리마인드
    // 2. 마감 3시간 전 태스크 조회 및 리마인드
    // 3. 마감 경과 태스크 조회 및 알림
    // 4. 미팅 30분/10분 전 리마인드

    console.log('Reminder check job completed');

    return res.status(200).json({
      success: true,
      message: 'Reminder check job executed',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Reminder check job failed:', error);
    return res.status(500).json({
      success: false,
      error: 'Job execution failed',
    });
  }
}
