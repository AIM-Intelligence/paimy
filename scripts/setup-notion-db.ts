/**
 * Notion 태스크 데이터베이스 속성 자동 구성 스크립트
 * 실행: npx ts-node scripts/setup-notion-db.ts
 */

import { Client } from '@notionhq/client';
import * as dotenv from 'dotenv';
import * as path from 'path';

// .env.local 파일 로드
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const notion = new Client({
  auth: process.env.NOTION_INTEGRATION_TOKEN,
});

const DATABASE_ID = process.env.NOTION_TASK_DATABASE_ID!;

async function setupDatabase() {
  console.log('🚀 Notion 태스크 DB 속성 구성 시작...\n');

  try {
    // 현재 데이터베이스 정보 조회
    const database = await notion.databases.retrieve({
      database_id: DATABASE_ID,
    });

    console.log(`📋 데이터베이스: ${(database as any).title?.[0]?.plain_text || 'Untitled'}`);
    console.log(`🔗 ID: ${DATABASE_ID}\n`);

    // 속성 업데이트
    const response = await notion.databases.update({
      database_id: DATABASE_ID,
      properties: {
        // 상태 (Status) - Select
        '상태': {
          select: {
            options: [
              { name: 'Backlog', color: 'gray' },
              { name: 'In Progress', color: 'blue' },
              { name: 'Blocked', color: 'red' },
              { name: 'Done', color: 'green' },
            ],
          },
        },
        // 담당자 (Owner) - Person
        '담당자': {
          people: {},
        },
        // 참여자 - Person (다중)
        '참여자': {
          people: {},
        },
        // 마감일 - Date
        '마감일': {
          date: {},
        },
        // 우선순위 - Select
        '우선순위': {
          select: {
            options: [
              { name: 'High', color: 'red' },
              { name: 'Medium', color: 'yellow' },
              { name: 'Low', color: 'gray' },
            ],
          },
        },
        // 실행 상세 - Rich Text
        '실행 상세': {
          rich_text: {},
        },
        // 소스 (Source) - Select
        '소스': {
          select: {
            options: [
              { name: 'Manual', color: 'default' },
              { name: 'Slack', color: 'purple' },
              { name: 'Gmail', color: 'red' },
              { name: 'Calendar', color: 'blue' },
            ],
          },
        },
        // 원본 링크 - URL
        '원본 링크': {
          url: {},
        },
        // Slack Thread ID - Rich Text
        'Slack Thread ID': {
          rich_text: {},
        },
      },
    });

    console.log('✅ 속성 구성 완료!\n');
    console.log('추가된 속성:');
    console.log('  - 상태 (Backlog, In Progress, Blocked, Done)');
    console.log('  - 담당자');
    console.log('  - 참여자');
    console.log('  - 마감일');
    console.log('  - 우선순위 (High, Medium, Low)');
    console.log('  - 실행 상세');
    console.log('  - 소스 (Manual, Slack, Gmail, Calendar)');
    console.log('  - 원본 링크');
    console.log('  - Slack Thread ID');
    console.log('\n🎉 태스크 DB 설정 완료!');

  } catch (error: any) {
    console.error('❌ 오류 발생:', error.message);

    if (error.code === 'object_not_found') {
      console.error('\n💡 해결 방법:');
      console.error('   1. 노션에서 해당 데이터베이스 페이지 열기');
      console.error('   2. 우측 상단 ··· → Connections → Paimy 연결 확인');
    }

    process.exit(1);
  }
}

setupDatabase();
