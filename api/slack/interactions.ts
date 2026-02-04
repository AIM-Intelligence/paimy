import type { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'crypto';

interface SlackInteraction {
  type: string;
  user: {
    id: string;
    name: string;
  };
  channel: {
    id: string;
  };
  actions: Array<{
    action_id: string;
    value: string;
  }>;
  response_url: string;
  trigger_id: string;
}

/**
 * Slack 요청 서명 검증
 */
function verifySlackRequest(
  signingSecret: string,
  signature: string,
  timestamp: string,
  body: string
): boolean {
  const fiveMinutesAgo = Math.floor(Date.now() / 1000) - 60 * 5;
  if (parseInt(timestamp, 10) < fiveMinutesAgo) {
    return false;
  }

  const baseString = `v0:${timestamp}:${body}`;
  const hmac = crypto.createHmac('sha256', signingSecret);
  const expectedSignature = `v0=${hmac.update(baseString).digest('hex')}`;

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  if (!signingSecret) {
    console.error('SLACK_SIGNING_SECRET is not configured');
    return res.status(500).json({ error: 'Server configuration error' });
  }

  // 요청 검증
  const signature = req.headers['x-slack-signature'] as string;
  const timestamp = req.headers['x-slack-request-timestamp'] as string;

  // Slack interactions는 payload가 URL-encoded로 옴
  const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);

  if (!verifySlackRequest(signingSecret, signature, timestamp, rawBody)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  // payload 파싱
  let interaction: SlackInteraction;
  try {
    const payload = typeof req.body === 'string'
      ? req.body
      : req.body.payload;
    interaction = JSON.parse(payload);
  } catch {
    return res.status(400).json({ error: 'Invalid payload' });
  }

  // 인터랙션 타입별 처리
  switch (interaction.type) {
    case 'block_actions':
      // 버튼 클릭 등 Block Kit 액션 처리
      console.log(`Action from ${interaction.user.name}:`, interaction.actions);
      // TODO: 액션별 처리 로직 구현
      break;

    case 'shortcut':
      // 글로벌 숏컷 처리
      console.log(`Shortcut triggered by ${interaction.user.name}`);
      break;

    case 'message_action':
      // 메시지 액션 처리
      console.log(`Message action by ${interaction.user.name}`);
      break;

    default:
      console.log(`Unhandled interaction type: ${interaction.type}`);
  }

  // 즉시 응답 (Slack은 3초 내 응답 필요)
  return res.status(200).json({ ok: true });
}
