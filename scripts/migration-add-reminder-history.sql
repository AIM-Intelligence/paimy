-- Migration: Add reminder_history table for tracking sent reminders
-- This prevents duplicate reminders within the same day

CREATE TABLE IF NOT EXISTS reminder_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slack_id VARCHAR(20) NOT NULL,
  notion_task_id VARCHAR(50) NOT NULL,
  reminder_type VARCHAR(20) NOT NULL,  -- '3_day', '1_day', 'overdue', 'overdue_weekly'
  sent_at TIMESTAMPTZ DEFAULT NOW(),
  sent_date DATE DEFAULT CURRENT_DATE  -- 중복 체크용 날짜 컬럼
);

-- Unique index for daily deduplication (same user, task, type per day)
CREATE UNIQUE INDEX IF NOT EXISTS idx_reminder_history_daily_unique
ON reminder_history(slack_id, notion_task_id, reminder_type, sent_date);

-- Index for checking today's reminders by user
CREATE INDEX IF NOT EXISTS idx_reminder_history_user_date
ON reminder_history(slack_id, sent_at);

-- Index for task-based lookups
CREATE INDEX IF NOT EXISTS idx_reminder_history_task
ON reminder_history(notion_task_id);

-- Enable RLS (Row Level Security)
ALTER TABLE reminder_history ENABLE ROW LEVEL SECURITY;

-- Policy: Service role can do everything
CREATE POLICY "Service role full access" ON reminder_history
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Function to clean up old reminder history (optional, can be called periodically)
CREATE OR REPLACE FUNCTION cleanup_old_reminders(days_to_keep INTEGER DEFAULT 30)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM reminder_history
  WHERE sent_at < NOW() - (days_to_keep || ' days')::INTERVAL;

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;
