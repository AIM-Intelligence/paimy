import { createClient, SupabaseClient } from '@supabase/supabase-js';

// 테이블 Row 타입 정의
export interface UserMapping {
  id: string;
  slack_id: string;
  slack_username: string | null;
  slack_display_name: string | null;
  notion_id: string | null;
  notion_name: string | null;
  google_email: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  aliases: string[] | null; // 한글 별칭 등 추가 이름
  team: string | null; // 소속 팀
}

export interface ConversationContext {
  id: string;
  slack_thread_ts: string;
  slack_channel_id: string;
  slack_user_id: string;
  last_task_id: string | null;
  last_task_name: string | null;
  last_event_id: string | null;
  last_email_id: string | null;
  context_data: Record<string, unknown> | null;
  expires_at: string;
  created_at: string;
  updated_at: string;
}

export interface NotificationSettings {
  id: string;
  slack_id: string;
  morning_briefing: boolean;
  reminder_24h: boolean;
  reminder_3h: boolean;
  meeting_reminder: boolean;
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
  created_at: string;
}

let supabaseClient: SupabaseClient | null = null;

/**
 * Supabase 클라이언트 인스턴스 가져오기 (싱글톤)
 */
export function getSupabaseClient(): SupabaseClient {
  if (supabaseClient) {
    return supabaseClient;
  }

  const supabaseUrl = process.env.SUPABASE_URL?.trim();
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY?.trim();

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing Supabase environment variables');
  }

  supabaseClient = createClient(supabaseUrl, supabaseKey);
  return supabaseClient;
}

// === 사용자 매핑 함수들 ===

/**
 * Slack ID로 사용자 매핑 조회
 */
export async function getUserMappingBySlackId(
  slackId: string
): Promise<UserMapping | null> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('user_mappings')
    .select('*')
    .eq('slack_id', slackId)
    .eq('is_active', true)
    .single();

  if (error) {
    console.error('Error fetching user mapping:', error);
    return null;
  }

  return data as UserMapping;
}

/**
 * Notion ID로 Slack ID 조회
 */
export async function getSlackIdByNotionId(
  notionId: string
): Promise<string | null> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('user_mappings')
    .select('slack_id')
    .eq('notion_id', notionId)
    .eq('is_active', true)
    .single();

  if (error) {
    console.error('Error fetching Slack ID:', error);
    return null;
  }

  return (data as { slack_id: string })?.slack_id ?? null;
}

/**
 * 이름 또는 별칭으로 사용자 검색
 * - slack_display_name, notion_name: ILIKE 검색
 * - aliases: 배열 내 부분 일치 검색 (RPC 함수 사용)
 */
export async function findUsersByName(name: string): Promise<UserMapping[]> {
  const supabase = getSupabaseClient();

  // RPC 함수로 검색 (aliases 포함)
  const { data: rpcData, error: rpcError } = await supabase.rpc(
    'search_users_by_name',
    { search_term: name }
  );

  // RPC 함수가 있으면 그 결과 사용
  if (!rpcError && rpcData) {
    return (rpcData as UserMapping[]) ?? [];
  }

  // RPC 함수가 없거나 실패하면 기존 방식으로 폴백
  // (aliases 컬럼 마이그레이션 전에도 작동)
  console.log('RPC search_users_by_name not available, falling back to basic search');
  const { data, error } = await supabase
    .from('user_mappings')
    .select('*')
    .eq('is_active', true)
    .or(`slack_display_name.ilike.%${name}%,notion_name.ilike.%${name}%`);

  if (error) {
    console.error('Error searching users:', error);
    return [];
  }

  return (data as UserMapping[]) ?? [];
}

/**
 * 모든 활성 사용자 조회
 */
export async function getAllActiveUsers(): Promise<UserMapping[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('user_mappings')
    .select('*')
    .eq('is_active', true);

  if (error) {
    console.error('Error fetching active users:', error);
    return [];
  }

  return (data as UserMapping[]) ?? [];
}

/**
 * 팀별 사용자 조회
 */
export async function getUsersByTeam(teamName: string): Promise<UserMapping[]> {
  const supabase = getSupabaseClient();

  // RPC 함수로 검색
  const { data: rpcData, error: rpcError } = await supabase.rpc(
    'get_users_by_team',
    { team_name: teamName }
  );

  if (!rpcError && rpcData) {
    return (rpcData as UserMapping[]) ?? [];
  }

  // RPC 함수가 없으면 직접 쿼리
  console.log('RPC get_users_by_team not available, falling back to direct query');
  const { data, error } = await supabase
    .from('user_mappings')
    .select('*')
    .eq('is_active', true)
    .ilike('team', `%${teamName}%`);

  if (error) {
    console.error('Error fetching users by team:', error);
    return [];
  }

  return (data as UserMapping[]) ?? [];
}

/**
 * Notion ID로 담당자의 팀 조회
 */
export async function getTeamByNotionId(notionId: string): Promise<string | null> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('user_mappings')
    .select('team')
    .eq('notion_id', notionId)
    .eq('is_active', true)
    .single();

  if (error || !data) {
    return null;
  }

  return (data as { team: string | null }).team;
}

// === 사용자 별칭 관리 함수들 ===

/**
 * 사용자 별칭 추가
 */
export async function addUserAlias(
  slackId: string,
  newAlias: string
): Promise<boolean> {
  const supabase = getSupabaseClient();

  // 현재 aliases 조회
  const { data: user, error: fetchError } = await supabase
    .from('user_mappings')
    .select('aliases')
    .eq('slack_id', slackId)
    .single();

  if (fetchError) {
    console.error('Error fetching user:', fetchError);
    return false;
  }

  // 중복 체크 후 추가
  const currentAliases = (user?.aliases as string[]) ?? [];
  if (currentAliases.includes(newAlias)) {
    return true; // 이미 존재
  }

  const updatedAliases = [...currentAliases, newAlias];

  const { error: updateError } = await supabase
    .from('user_mappings')
    .update({ aliases: updatedAliases })
    .eq('slack_id', slackId);

  if (updateError) {
    console.error('Error adding alias:', updateError);
    return false;
  }

  return true;
}

/**
 * 사용자 별칭 제거
 */
export async function removeUserAlias(
  slackId: string,
  aliasToRemove: string
): Promise<boolean> {
  const supabase = getSupabaseClient();

  const { data: user, error: fetchError } = await supabase
    .from('user_mappings')
    .select('aliases')
    .eq('slack_id', slackId)
    .single();

  if (fetchError) {
    console.error('Error fetching user:', fetchError);
    return false;
  }

  const currentAliases = (user?.aliases as string[]) ?? [];
  const updatedAliases = currentAliases.filter((a) => a !== aliasToRemove);

  const { error: updateError } = await supabase
    .from('user_mappings')
    .update({ aliases: updatedAliases })
    .eq('slack_id', slackId);

  if (updateError) {
    console.error('Error removing alias:', updateError);
    return false;
  }

  return true;
}

/**
 * 사용자 별칭 전체 설정
 */
export async function setUserAliases(
  slackId: string,
  aliases: string[]
): Promise<boolean> {
  const supabase = getSupabaseClient();

  const { error } = await supabase
    .from('user_mappings')
    .update({ aliases })
    .eq('slack_id', slackId);

  if (error) {
    console.error('Error setting aliases:', error);
    return false;
  }

  return true;
}

// === 대화 컨텍스트 함수들 ===

/**
 * 대화 컨텍스트 조회/생성
 */
export async function getOrCreateConversationContext(
  threadTs: string,
  channelId: string,
  userId: string
): Promise<ConversationContext | null> {
  const supabase = getSupabaseClient();

  // 기존 컨텍스트 조회
  const { data: existing } = await supabase
    .from('conversation_context')
    .select('*')
    .eq('slack_thread_ts', threadTs)
    .single();

  if (existing) {
    return existing as ConversationContext;
  }

  // 새 컨텍스트 생성
  const { data: newContext, error } = await supabase
    .from('conversation_context')
    .insert({
      slack_thread_ts: threadTs,
      slack_channel_id: channelId,
      slack_user_id: userId,
    })
    .select()
    .single();

  if (error) {
    console.error('Error creating conversation context:', error);
    return null;
  }

  return newContext as ConversationContext;
}

/**
 * 대화 컨텍스트 업데이트
 */
export async function updateConversationContext(
  threadTs: string,
  updates: Partial<Omit<ConversationContext, 'id' | 'created_at'>>
): Promise<boolean> {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from('conversation_context')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('slack_thread_ts', threadTs);

  if (error) {
    console.error('Error updating conversation context:', error);
    return false;
  }

  return true;
}

// === 리마인더 히스토리 함수들 ===

export type ReminderType = '3_day' | '1_day' | 'today' | 'overdue' | 'overdue_weekly';

export interface ReminderHistoryRecord {
  id: string;
  slack_id: string;
  notion_task_id: string;
  reminder_type: ReminderType;
  sent_at: string;
  sent_date: string;  // YYYY-MM-DD 형식
}

/**
 * 오늘 해당 리마인더가 이미 발송되었는지 확인
 */
export async function wasReminderSentToday(
  slackId: string,
  taskId: string,
  reminderType: ReminderType
): Promise<boolean> {
  const supabase = getSupabaseClient();

  // 오늘 날짜 범위 계산 (KST 기준)
  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(now);
  todayEnd.setHours(23, 59, 59, 999);

  const { data, error } = await supabase
    .from('reminder_history')
    .select('id')
    .eq('slack_id', slackId)
    .eq('notion_task_id', taskId)
    .eq('reminder_type', reminderType)
    .gte('sent_at', todayStart.toISOString())
    .lte('sent_at', todayEnd.toISOString())
    .limit(1);

  if (error) {
    console.error('Error checking reminder history:', error);
    return false; // 에러 시 발송 허용
  }

  return (data?.length ?? 0) > 0;
}

/**
 * 리마인더 발송 기록 저장
 */
export async function recordReminderSent(
  slackId: string,
  taskId: string,
  reminderType: ReminderType
): Promise<boolean> {
  const supabase = getSupabaseClient();

  // 오늘 날짜 (YYYY-MM-DD 형식)
  const today = new Date().toISOString().split('T')[0];

  const { error } = await supabase.from('reminder_history').insert({
    slack_id: slackId,
    notion_task_id: taskId,
    reminder_type: reminderType,
    sent_date: today,
  });

  if (error) {
    // unique constraint 위반은 무시 (이미 기록됨)
    if (error.code === '23505') {
      return true;
    }
    console.error('Error recording reminder:', error);
    return false;
  }

  return true;
}

/**
 * 오늘 사용자에게 발송된 모든 리마인더 조회
 */
export async function getTodayReminders(
  slackId: string
): Promise<{ taskId: string; reminderType: ReminderType }[]> {
  const supabase = getSupabaseClient();

  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);

  const { data, error } = await supabase
    .from('reminder_history')
    .select('notion_task_id, reminder_type')
    .eq('slack_id', slackId)
    .gte('sent_at', todayStart.toISOString());

  if (error) {
    console.error('Error fetching today reminders:', error);
    return [];
  }

  return (data ?? []).map((row) => ({
    taskId: row.notion_task_id,
    reminderType: row.reminder_type as ReminderType,
  }));
}

/**
 * 마감 초과 태스크의 마지막 리마인더 날짜 조회 (재알림 주기 체크용)
 */
export async function getLastOverdueReminderDate(
  slackId: string,
  taskId: string
): Promise<Date | null> {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from('reminder_history')
    .select('sent_at')
    .eq('slack_id', slackId)
    .eq('notion_task_id', taskId)
    .in('reminder_type', ['overdue', 'overdue_weekly'])
    .order('sent_at', { ascending: false })
    .limit(1);

  if (error || !data || data.length === 0) {
    return null;
  }

  return new Date(data[0].sent_at);
}

/**
 * 오래된 리마인더 히스토리 정리 (30일 이상)
 */
export async function cleanupOldReminders(
  daysToKeep: number = 30
): Promise<number> {
  const supabase = getSupabaseClient();

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

  const { data, error } = await supabase
    .from('reminder_history')
    .delete()
    .lt('sent_at', cutoffDate.toISOString())
    .select('id');

  if (error) {
    console.error('Error cleaning up old reminders:', error);
    return 0;
  }

  return data?.length ?? 0;
}
