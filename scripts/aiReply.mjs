// SCRIPT: AI REPLY TO QUEST VR CHAT
//
// Appends an AI message to `.vr-chat.json` so the user sees the response
// appear in the headset in real-time.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const text = process.argv.slice(2).join(' ').trim();
if (!text) {
  console.error('Uso: node scripts/aiReply.mjs "<mensagem>"');
  process.exit(1);
}

const chatFile = join(process.cwd(), '.vr-chat.json');
let msgs = [];
if (existsSync(chatFile)) {
  try {
    msgs = JSON.parse(readFileSync(chatFile, 'utf8'));
  } catch (_) {}
}

const time = new Date().toLocaleTimeString();
msgs.push({
  id: Date.now(),
  sender: 'ai',
  time,
  text,
});

writeFileSync(chatFile, JSON.stringify(msgs.slice(-50), null, 2));
console.log(`🤖 [RESPOSTA ENVIADA PARA O QUEST VR]: "${text}"`);
