import type { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'crypto';
import { processMessage } from '../../lib/llm/orchestrator';

// Vercel에서 raw body 접근을 위한 설정
export const config = {
  api: {
    bodyParser: false,
  },
};

// Raw body 파싱 헬퍼
async function getRawBody(req: VercelRequest): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
    });
    req.on('end', () => {
      resolve(data);
    });
    req.on('error', reject);
  });
}
import { UserContext, ConversationContextData, ThreadMessageContext } from '../../lib/llm/prompts';
import {
  replyInThread,
  sendMessage,
  addReaction,
  getUserInfo,
  getThreadHistory,
  enrichThreadWithUserNames,
  ThreadMessage,
} from '../../lib/slack/responder';
import {
  getUserMappingBySlackId,
  getOrCreateConversationContext,
  updateConversationContext,
} from '../../lib/db/supabase';

interface SlackEvent {
  type: string;
  challenge?: string;
  event_id?: string;
  event?: {
    type: string;
    user: string;
    text: string;
    channel: string;
    ts: string;
    thread_ts?: string;
    bot_id?: string;
    subtype?: string;
    client_msg_id?: string;
  };
}

// 중복 이벤트 방지를 위한 캐시 (5분 TTL)
const processedEvents = new Map<string, number>();
const EVENT_CACHE_TTL = 5 * 60 * 1000; // 5분

function isEventProcessed(eventId: string): boolean {
  const now = Date.now();

  // 만료된 이벤트 정리
  for (const [id, timestamp] of processedEvents) {
    if (now - timestamp > EVENT_CACHE_TTL) {
      processedEvents.delete(id);
    }
  }

  if (processedEvents.has(eventId)) {
    return true;
  }

  processedEvents.set(eventId, now);
  return false;
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
  // 5분 이상 지난 요청은 거부 (replay attack 방지)
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

/**
 * 멘션 텍스트에서 봇 ID 제거
 */
function cleanMessageText(text: string): string {
  // <@UXXXX> 형태의 멘션 제거
  return text.replace(/<@[A-Z0-9]+>/g, '').trim();
}

/**
 * 비동기 메시지 처리 (3초 제한 우회)
 */
async function handleMessageAsync(
  userId: string,
  text: string,
  channel: string,
  ts: string,
  threadTs?: string
): Promise<void> {
  console.log('[handleMessageAsync] Starting for user:', userId);
  console.log('[handleMessageAsync] Text:', text);

  try {
    // 처리 중 이모지 표시
    console.log('[handleMessageAsync] Adding eyes reaction...');
    await addReaction(channel, ts, 'eyes');
    console.log('[handleMessageAsync] Eyes reaction added');

    // 사용자 정보 조회
    const [userMapping, slackUser] = await Promise.all([
      getUserMappingBySlackId(userId).catch(() => null),
      getUserInfo(userId),
    ]);
    console.log('[handleMessageAsync] User mapping:', userMapping ? 'found' : 'not found');
    console.log('[handleMessageAsync] Slack user:', slackUser?.displayName || 'no display name');

    // 사용자 컨텍스트 구성
    const userContext: UserContext = {
      slackId: userId,
      slackDisplayName: slackUser?.displayName || slackUser?.realName || userId,
      notionId: userMapping?.notion_id || null,
      notionName: userMapping?.notion_name || null,
    };

    // 대화 컨텍스트 조회/생성
    const effectiveThreadTs = threadTs || ts;
    const conversationCtx = await getOrCreateConversationContext(
      effectiveThreadTs,
      channel,
      userId
    ).catch(() => null);

    // 컨텍스트 데이터 파싱
    let conversationContextData: ConversationContextData | null = null;
    if (conversationCtx?.context_data) {
      conversationContextData = conversationCtx.context_data as ConversationContextData;
    } else {
      conversationContextData = {};
    }

    // 스레드 히스토리 조회
    console.log('[handleMessageAsync] threadTs value:', threadTs, '| ts value:', ts);

    if (threadTs) {
      console.log('[handleMessageAsync] Fetching thread history for:', threadTs);
      const threadMessages = await getThreadHistory(channel, threadTs, 10);
      console.log('[handleMessageAsync] getThreadHistory returned:', threadMessages.length, 'messages');

      if (threadMessages.length > 0) {
        // 사용자 이름 추가
        const enrichedMessages = await enrichThreadWithUserNames(threadMessages);

        // 현재 메시지 제외하고 컨텍스트 형식으로 변환
        conversationContextData.threadHistory = enrichedMessages
          .filter((msg) => msg.ts !== ts) // 현재 메시지 제외
          .map((msg) => ({
            role: msg.isBot ? 'assistant' : 'user',
            userName: msg.userName || msg.user,
            content: cleanMessageText(msg.text),
          })) as ThreadMessageContext[];

        console.log('[handleMessageAsync] Thread history after filter:', conversationContextData.threadHistory.length, 'messages');
        console.log('[handleMessageAsync] Thread history content:', JSON.stringify(conversationContextData.threadHistory));
      } else {
        console.log('[handleMessageAsync] No thread messages found!');
      }
    } else {
      console.log('[handleMessageAsync] No threadTs - this is a new thread or channel message');
    }

    // LLM 처리
    const cleanedText = cleanMessageText(text);
    console.log('[handleMessageAsync] Cleaned text:', cleanedText);
    console.log('[handleMessageAsync] Calling processMessage...');

    const result = await processMessage({
      userMessage: cleanedText,
      userContext,
      conversationContext: conversationContextData,
    });

    console.log('[handleMessageAsync] LLM response length:', result.response.length);
    console.log('[handleMessageAsync] LLM response preview:', result.response.substring(0, 100));

    // 응답 전송
    console.log('[handleMessageAsync] Sending reply...');
    if (threadTs) {
      await replyInThread(channel, threadTs, result.response);
    } else {
      // 멘션은 새 스레드 시작
      await replyInThread(channel, ts, result.response);
    }
    console.log('[handleMessageAsync] Reply sent');

    // 컨텍스트 업데이트
    if (Object.keys(result.updatedContext).length > 0 && conversationCtx) {
      await updateConversationContext(effectiveThreadTs, {
        context_data: {
          ...(conversationContextData || {}),
          ...result.updatedContext,
        },
      }).catch((err) => console.error('Context update failed:', err));
    }

    // 완료 이모지
    await addReaction(channel, ts, 'white_check_mark');
  } catch (error: any) {
    console.error('Error processing message:', error);

    // 에러 응답
    try {
      const errorMessage = '죄송합니다, 요청을 처리하는 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.';
      if (threadTs) {
        await replyInThread(channel, threadTs, errorMessage);
      } else {
        await replyInThread(channel, ts, errorMessage);
      }
      await addReaction(channel, ts, 'x');
    } catch {
      // 에러 응답 실패 무시
    }
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  console.log('[Slack Events] Request received:', req.method);

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Raw body 읽기 (서명 검증용)
  const rawBody = await getRawBody(req);
  const event = JSON.parse(rawBody) as SlackEvent;
  console.log('[Slack Events] Event type:', event.type);

  // URL 검증 (Slack 앱 설정 시 필요) - 서명 검증 전에 처리
  if (event.type === 'url_verification') {
    return res.status(200).json({ challenge: event.challenge });
  }

  const signingSecret = process.env.SLACK_SIGNING_SECRET?.trim();
  if (!signingSecret) {
    console.error('[Slack Events] SLACK_SIGNING_SECRET is not configured');
    return res.status(500).json({ error: 'Server configuration error' });
  }

  // 요청 검증
  const signature = req.headers['x-slack-signature'] as string;
  const timestamp = req.headers['x-slack-request-timestamp'] as string;

  console.log('[Slack Events] Signature present:', !!signature);
  console.log('[Slack Events] Timestamp present:', !!timestamp);

  // 헤더가 없으면 거부
  if (!signature || !timestamp) {
    console.log('[Slack Events] Missing headers');
    return res.status(401).json({ error: 'Missing signature headers' });
  }

  // 서명 검증
  if (!verifySlackRequest(signingSecret, signature, timestamp, rawBody)) {
    console.log('[Slack Events] Signature verification failed');
    return res.status(401).json({ error: 'Invalid signature' });
  }

  console.log('[Slack Events] Signature verified');

  // 이벤트 처리
  if (event.type === 'event_callback' && event.event) {
    const slackEvent = event.event;
    console.log('[Slack Events] Inner event type:', slackEvent.type);
    console.log('[Slack Events] User:', slackEvent.user);
    console.log('[Slack Events] Text:', slackEvent.text);

    // 중복 이벤트 체크 (Slack 재시도 방지)
    const eventKey = event.event_id || slackEvent.client_msg_id || `${slackEvent.channel}-${slackEvent.ts}`;
    if (isEventProcessed(eventKey)) {
      console.log('[Slack Events] Duplicate event ignored:', eventKey);
      return res.status(200).json({ ok: true });
    }

    // 봇 메시지 무시 (무한 루프 방지)
    if (slackEvent.bot_id || slackEvent.subtype === 'bot_message') {
      console.log('[Slack Events] Ignoring bot message');
      return res.status(200).json({ ok: true });
    }

    switch (slackEvent.type) {
      case 'app_mention':
        console.log('[Slack Events] Processing app_mention');
        console.log('[Slack Events] ts:', slackEvent.ts);
        console.log('[Slack Events] thread_ts:', slackEvent.thread_ts);
        // 디버그: await로 변경하여 로그 확인
        try {
          await handleMessageAsync(
            slackEvent.user,
            slackEvent.text,
            slackEvent.channel,
            slackEvent.ts,
            slackEvent.thread_ts
          );
          console.log('[Slack Events] handleMessageAsync completed');
        } catch (err) {
          console.error('[Slack Events] handleMessageAsync error:', err);
        }
        break;

      case 'message':
        // DM 처리 (채널 메시지는 멘션만 처리)
        // 채널 ID가 D로 시작하면 DM
        if (slackEvent.channel.startsWith('D')) {
          console.log('[Slack Events] Processing DM message');
          try {
            await handleMessageAsync(
              slackEvent.user,
              slackEvent.text,
              slackEvent.channel,
              slackEvent.ts,
              slackEvent.thread_ts
            );
          } catch (err) {
            console.error('[Slack Events] handleMessageAsync error:', err);
          }
        }
        break;

      default:
        console.log(`[Slack Events] Unhandled event type: ${slackEvent.type}`);
    }
  }

  // 디버그: 처리 완료 후 응답 (Slack retry 가능)
  console.log('[Slack Events] Returning ok');
  return res.status(200).json({ ok: true });
}
