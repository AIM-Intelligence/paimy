/**
 * Slack 응답 발송 모듈
 * 메시지 전송 및 포맷팅
 */

import { WebClient } from '@slack/web-api';

// Slack 클라이언트 싱글톤
let slackClient: WebClient | null = null;

export function getSlackClient(): WebClient {
  if (slackClient) {
    return slackClient;
  }

  const token = process.env.SLACK_BOT_TOKEN?.trim();
  if (!token) {
    throw new Error('SLACK_BOT_TOKEN is not configured');
  }

  slackClient = new WebClient(token);
  return slackClient;
}

// === 메시지 전송 함수 ===

/**
 * 채널/DM에 메시지 전송
 */
export async function sendMessage(
  channel: string,
  text: string,
  options?: {
    threadTs?: string;
    blocks?: any[];
    unfurlLinks?: boolean;
  }
): Promise<string | undefined> {
  const client = getSlackClient();

  const result = await client.chat.postMessage({
    channel,
    text,
    thread_ts: options?.threadTs,
    blocks: options?.blocks,
    unfurl_links: options?.unfurlLinks ?? false,
  });

  return result.ts;
}

/**
 * 스레드에 답장
 */
export async function replyInThread(
  channel: string,
  threadTs: string,
  text: string,
  blocks?: any[]
): Promise<string | undefined> {
  return sendMessage(channel, text, { threadTs, blocks });
}

/**
 * DM 전송
 */
export async function sendDM(
  userId: string,
  text: string,
  blocks?: any[]
): Promise<string | undefined> {
  const client = getSlackClient();

  // DM 채널 열기
  const conversation = await client.conversations.open({
    users: userId,
  });

  if (!conversation.channel?.id) {
    throw new Error('Failed to open DM channel');
  }

  return sendMessage(conversation.channel.id, text, { blocks });
}

/**
 * 임시 메시지 전송 (본인만 볼 수 있음)
 */
export async function sendEphemeral(
  channel: string,
  userId: string,
  text: string,
  options?: {
    threadTs?: string;
    blocks?: any[];
  }
): Promise<void> {
  const client = getSlackClient();

  await client.chat.postEphemeral({
    channel,
    user: userId,
    text,
    thread_ts: options?.threadTs,
    blocks: options?.blocks,
  });
}

/**
 * 타이핑 표시 (사용자 경험 향상)
 */
export async function showTypingIndicator(
  channel: string,
  threadTs?: string
): Promise<{ messageTs: string; cleanup: () => Promise<void> }> {
  const client = getSlackClient();

  // "처리 중..." 메시지 전송
  const result = await client.chat.postMessage({
    channel,
    text: '🤔 처리 중...',
    thread_ts: threadTs,
  });

  const messageTs = result.ts!;

  // 정리 함수 반환
  return {
    messageTs,
    cleanup: async () => {
      try {
        await client.chat.delete({
          channel,
          ts: messageTs,
        });
      } catch {
        // 삭제 실패 무시
      }
    },
  };
}

/**
 * 메시지 업데이트
 */
export async function updateMessage(
  channel: string,
  ts: string,
  text: string,
  blocks?: any[]
): Promise<void> {
  const client = getSlackClient();

  await client.chat.update({
    channel,
    ts,
    text,
    blocks,
  });
}

/**
 * 메시지 삭제
 */
export async function deleteMessage(
  channel: string,
  ts: string
): Promise<void> {
  const client = getSlackClient();

  await client.chat.delete({
    channel,
    ts,
  });
}

// === 리액션 함수 ===

/**
 * 리액션 추가
 */
export async function addReaction(
  channel: string,
  ts: string,
  emoji: string
): Promise<void> {
  const client = getSlackClient();

  try {
    await client.reactions.add({
      channel,
      timestamp: ts,
      name: emoji,
    });
  } catch (error: any) {
    // 이미 리액션이 있으면 무시
    if (error.data?.error !== 'already_reacted') {
      throw error;
    }
  }
}

/**
 * 리액션 제거
 */
export async function removeReaction(
  channel: string,
  ts: string,
  emoji: string
): Promise<void> {
  const client = getSlackClient();

  try {
    await client.reactions.remove({
      channel,
      timestamp: ts,
      name: emoji,
    });
  } catch (error: any) {
    // 리액션이 없으면 무시
    if (error.data?.error !== 'no_reaction') {
      throw error;
    }
  }
}

// === 사용자 정보 조회 ===

export interface SlackUserInfo {
  id: string;
  name: string;
  displayName: string;
  realName: string;
  email?: string;
}

/**
 * 사용자 정보 조회
 */
export async function getUserInfo(userId: string): Promise<SlackUserInfo | null> {
  const client = getSlackClient();

  try {
    const result = await client.users.info({ user: userId });

    if (!result.user) {
      return null;
    }

    return {
      id: result.user.id!,
      name: result.user.name || '',
      displayName: result.user.profile?.display_name || result.user.name || '',
      realName: result.user.real_name || result.user.name || '',
      email: result.user.profile?.email,
    };
  } catch {
    return null;
  }
}

// === 채널 정보 ===

/**
 * 채널 참여
 */
export async function joinChannel(channelId: string): Promise<boolean> {
  const client = getSlackClient();

  try {
    await client.conversations.join({ channel: channelId });
    return true;
  } catch {
    return false;
  }
}
