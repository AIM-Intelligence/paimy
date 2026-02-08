import type { VercelRequest, VercelResponse } from '@vercel/node';
import { refreshProjectCache } from '../../lib/mcp/notion';

/**
 * 프로젝트 캐시 갱신 Cron Job
 * 실행: 매시간 (0 * * * *)
 *
 * 프로젝트 목록을 Notion에서 다시 조회하여 캐시 갱신
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Vercel Cron은 GET 요청
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Vercel Cron 인증 (선택적)
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    if (process.env.CRON_SECRET) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  try {
    console.log('Starting project cache refresh...');

    await refreshProjectCache();

    console.log('Project cache refreshed successfully');

    return res.status(200).json({
      success: true,
      message: 'Project cache refreshed',
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('Project cache refresh failed:', error);

    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
}
