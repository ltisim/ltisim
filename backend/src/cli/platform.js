#!/usr/bin/env node
// LMS registration from the command line.
//
//   npm run platform:register   register the LMS described by LMS_* env vars
//   npm run platform:show       show the registered LMS and the tool URLs
//   npm run platform:reset      remove the registered LMS (add -- --force to
//                               also delete all course data tied to it)
require('dotenv').config();
const pool = require('../config/database');
const { setupLTI } = require('../config/lti');
const platforms = require('../services/platforms');

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  if (cmd === 'show') {
    const p = await platforms.activePlatform();
    console.log(p
      ? { issuer: p.url, client_id: p.client_id, status: p.registration_status, registered_at: p.registered_at }
      : 'No LMS registered.');
    console.log(platforms.toolConfig());
    return;
  }
  const lti = await setupLTI();
  if (cmd === 'register') {
    const def = platforms.platformFromEnv();
    if (!def) throw new Error('Set LMS_TYPE, LMS_URL and LMS_CLIENT_ID (see .env.example)');
    const row = await platforms.registerPlatformBoth(lti, def);
    console.log(`Registered ${row.url} (client ${row.client_id}). It is verified on the first launch.`);
  } else if (cmd === 'reset') {
    const n = await platforms.resetPlatforms(lti, { force: args.includes('--force') });
    console.log(`Removed ${n} platform(s). Registration is open again.`);
  } else {
    console.log('Usage: node src/cli/platform.js register|show|reset [--force]');
    process.exitCode = 1;
  }
}

main()
  .catch((err) => { console.error(err.message); process.exitCode = 1; })
  .finally(() => pool.end().then(() => process.exit()));
