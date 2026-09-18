import fs from 'fs/promises';
import path from 'path';

/**
 * Migration Script: Migrate store.json to multi-tenant with ownerId.
 * Sets ownerId for all channels, videos, promptRuns, scripts, logs, usage logs, deletedVideos and settings.
 * Creates the primary owner user record and backs up the original database file.
 */

const TARGET_OWNER_ID = process.argv[2] || 'legacy-account-1';
const TARGET_OWNER_EMAIL = process.argv[3] || 'askerzade135@gmail.com';
const TARGET_OWNER_NAME = process.argv[4] || 'Primary Owner';

const DATA_DIR = path.join(process.cwd(), 'data');
const DB_FILE = path.join(DATA_DIR, 'store.json');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');

async function runMigration() {
  console.log('====================================================');
  console.log('  STARTING DATABASE MIGRATION TO MULTI-TENANT (STAGE 2)');
  console.log('====================================================');
  console.log(`Target Owner ID   : ${TARGET_OWNER_ID}`);
  console.log(`Target Owner Email: ${TARGET_OWNER_EMAIL}`);
  console.log(`Database File     : ${DB_FILE}`);

  try {
    // 1. Read existing DB
    const rawData = await fs.readFile(DB_FILE, 'utf-8');
    const db = JSON.parse(rawData);

    // 2. Count objects BEFORE migration
    const beforeCounts = {
      channels: db.channels?.length || 0,
      videos: db.videos?.length || 0,
      scripts: db.scripts?.length || 0,
      deletedVideos: db.deletedVideos?.length || 0,
      logs: db.logs?.length || 0,
      geminiUsageLogs: db.geminiUsageLogs?.length || 0,
      supadataUsageLogs: db.supadataUsageLogs?.length || 0,
      chocodataUsageLogs: db.chocodataUsageLogs?.length || 0,
      promptTemplates: db.promptTemplates?.length || 0,
      promptRuns: 0,
    };

    if (db.videos) {
      for (const v of db.videos) {
        if (v.promptRuns) {
          beforeCounts.promptRuns += v.promptRuns.length;
        }
      }
    }

    console.log('\n--- Object Counts BEFORE Migration ---');
    console.table(beforeCounts);

    // 3. Create Backup
    await fs.mkdir(BACKUP_DIR, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFile = path.join(BACKUP_DIR, `store.json.bak-pre-stage2-migration-${timestamp}`);
    await fs.writeFile(backupFile, rawData, 'utf-8');
    console.log(`\n[Backup] Saved snapshot to: ${backupFile}`);

    // 4. Migrate users list
    if (!db.users) {
      db.users = [];
    }

    let primaryUser = db.users.find((u: any) => u.id === TARGET_OWNER_ID || u.email === TARGET_OWNER_EMAIL);
    if (!primaryUser) {
      primaryUser = {
        id: TARGET_OWNER_ID,
        email: TARGET_OWNER_EMAIL,
        name: TARGET_OWNER_NAME,
        role: 'owner',
        createdAt: new Date().toISOString(),
        legacyOwnerIdMapped: TARGET_OWNER_ID === 'legacy-account-1' ? undefined : 'legacy-account-1',
      };
      db.users.push(primaryUser);
      console.log(`[User] Created primary owner account: ${primaryUser.email} (id: ${primaryUser.id})`);
    } else {
      primaryUser.id = TARGET_OWNER_ID;
      primaryUser.role = 'owner';
      console.log(`[User] Updated existing primary owner account: ${primaryUser.email}`);
    }

    // 5. Stamp Channels
    if (db.channels) {
      for (const ch of db.channels) {
        ch.ownerId = TARGET_OWNER_ID;
      }
    }

    // 6. Stamp Videos and their promptRuns
    if (db.videos) {
      for (const v of db.videos) {
        v.ownerId = TARGET_OWNER_ID;
        if (v.promptRuns && Array.isArray(v.promptRuns)) {
          for (const pr of v.promptRuns) {
            pr.ownerId = TARGET_OWNER_ID;
          }
        }
      }
    }

    // 7. Stamp Scripts
    if (db.scripts) {
      for (const s of db.scripts) {
        s.ownerId = TARGET_OWNER_ID;
      }
    }

    // 8. Stamp Deleted Videos
    if (db.deletedVideos) {
      for (const dv of db.deletedVideos) {
        dv.ownerId = TARGET_OWNER_ID;
      }
    }

    // 9. Stamp Logs
    if (db.logs) {
      for (const l of db.logs) {
        l.ownerId = TARGET_OWNER_ID;
      }
    }

    // 10. Stamp Usage Logs
    if (db.geminiUsageLogs) {
      for (const gl of db.geminiUsageLogs) {
        gl.ownerId = TARGET_OWNER_ID;
      }
    }
    if (db.supadataUsageLogs) {
      for (const sl of db.supadataUsageLogs) {
        sl.ownerId = TARGET_OWNER_ID;
      }
    }
    if (db.chocodataUsageLogs) {
      for (const cl of db.chocodataUsageLogs) {
        cl.ownerId = TARGET_OWNER_ID;
      }
    }

    // 11. Settings & User Settings
    if (db.settings) {
      db.settings.ownerId = TARGET_OWNER_ID;
      if (!db.userSettings) {
        db.userSettings = {};
      }
      db.userSettings[TARGET_OWNER_ID] = {
        ...db.settings,
        ownerId: TARGET_OWNER_ID,
      };
    }

    // 12. Add audit migration log
    db.logs.push({
      id: `migration-${Date.now()}`,
      ownerId: TARGET_OWNER_ID,
      timestamp: new Date().toISOString(),
      type: 'info',
      message: `Миграция базы данных на мульти-пользовательский режим завершена. Владелец: ${TARGET_OWNER_EMAIL} (${TARGET_OWNER_ID}). Объектов обработано: ${beforeCounts.videos} видео, ${beforeCounts.channels} каналов, ${beforeCounts.scripts} сценариев.`,
    });

    // 13. Save migrated DB
    const finalRawData = JSON.stringify(db, null, 2);
    await fs.writeFile(DB_FILE, finalRawData, 'utf-8');

    // 14. Count objects AFTER migration
    const afterCounts = {
      channels: db.channels?.length || 0,
      videos: db.videos?.length || 0,
      scripts: db.scripts?.length || 0,
      deletedVideos: db.deletedVideos?.length || 0,
      logs: db.logs?.length || 0,
      geminiUsageLogs: db.geminiUsageLogs?.length || 0,
      supadataUsageLogs: db.supadataUsageLogs?.length || 0,
      chocodataUsageLogs: db.chocodataUsageLogs?.length || 0,
      promptTemplates: db.promptTemplates?.length || 0,
      promptRuns: 0,
    };

    if (db.videos) {
      for (const v of db.videos) {
        if (v.promptRuns) {
          afterCounts.promptRuns += v.promptRuns.length;
        }
      }
    }

    console.log('\n--- Object Counts AFTER Migration ---');
    console.table(afterCounts);

    // 15. Verify ownerId integrity
    let channelsWithCorrectOwner = db.channels.filter((c: any) => c.ownerId === TARGET_OWNER_ID).length;
    let videosWithCorrectOwner = db.videos.filter((v: any) => v.ownerId === TARGET_OWNER_ID).length;
    let scriptsWithCorrectOwner = db.scripts.filter((s: any) => s.ownerId === TARGET_OWNER_ID).length;

    console.log('\n--- Integrity Verification ---');
    console.log(`Channels with ownerId='${TARGET_OWNER_ID}': ${channelsWithCorrectOwner} / ${afterCounts.channels} (${channelsWithCorrectOwner === afterCounts.channels ? 'OK' : 'MISMATCH'})`);
    console.log(`Videos with ownerId='${TARGET_OWNER_ID}'  : ${videosWithCorrectOwner} / ${afterCounts.videos} (${videosWithCorrectOwner === afterCounts.videos ? 'OK' : 'MISMATCH'})`);
    console.log(`Scripts with ownerId='${TARGET_OWNER_ID}' : ${scriptsWithCorrectOwner} / ${afterCounts.scripts} (${scriptsWithCorrectOwner === afterCounts.scripts ? 'OK' : 'MISMATCH'})`);

    const hasMismatch =
      beforeCounts.channels !== afterCounts.channels ||
      beforeCounts.videos !== afterCounts.videos ||
      beforeCounts.scripts !== afterCounts.scripts ||
      beforeCounts.deletedVideos !== afterCounts.deletedVideos ||
      beforeCounts.promptRuns !== afterCounts.promptRuns;

    if (hasMismatch) {
      console.error('\n❌ ERROR: Count mismatch detected! Check output.');
      process.exit(1);
    } else {
      console.log('\n SUCCESS: Migration finished. All counts match exactly. No data was lost.');
    }
  } catch (err: any) {
    console.error('Migration failed with error:', err);
    process.exit(1);
  }
}

runMigration();
