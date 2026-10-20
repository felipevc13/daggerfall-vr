// VR VOICE WATCHER
//
// Monitors `.vr-user-request.json` for new voice requests emitted by
// the player inside the Meta Quest headset. When detected, logs an alert
// to stdout so the AI agent is immediately awakened.

import { existsSync, readFileSync, watchFile } from 'node:fs';
import { join } from 'node:path';

const requestFile = join(process.cwd(), '.vr-user-request.json');
let lastTimestamp = 0;

console.log('🎧 [VR VOICE WATCHER ATIVO] Monitorando pedidos de voz vindos do Quest...');

function check() {
  if (!existsSync(requestFile)) return;
  try {
    const raw = readFileSync(requestFile, 'utf8');
    const data = JSON.parse(raw);
    if (data.timestamp && data.timestamp > lastTimestamp) {
      lastTimestamp = data.timestamp;
      console.log('\n============================================================');
      console.log(`🔔 [NOVO PEDIDO DE VOZ DO USUÁRIO NO QUEST] (${data.time}):`);
      console.log(`🗣️  "${data.text}"`);
      console.log('============================================================\n');
    }
  } catch (_) {}
}

check();
watchFile(requestFile, { interval: 500 }, check);
setInterval(check, 1000);
