#!/usr/bin/env node
// Quest dev server. Vite on every interface, with the URLs a headset can open.
//
// WebXR only runs in a secure context. http://localhost is one (use adb reverse
// from the headset). http://192.168.x.x is not: the page loads and navigator.xr
// stays missing, so Enter VR never appears. --https mints a self-signed cert;
// a certificate warning on the Quest often blocks WebXR too. The reliable
// wireless path is a tunnel with a publicly trusted certificate
// (docs/TESTING-ON-QUEST.md).

import { createServer } from 'vite';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { join } from 'node:path';

const wantHttps = process.argv.includes('--https');
const port = Number(process.env.QUEST_PORT || 5173);

function lanAddrs() {
  const out = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const net of list ?? []) {
      if (net.internal) continue;
      if (net.family !== 'IPv4' && net.family !== 4) continue;
      out.push(net.address);
    }
  }
  return out;
}

function localCerts() {
  const dir = join(process.cwd(), '.quest-certs');
  const keyPath = join(dir, 'key.pem');
  const certPath = join(dir, 'cert.pem');
  if (!existsSync(certPath) || !existsSync(keyPath)) {
    mkdirSync(dir, { recursive: true });
    const gen = spawnSync('openssl', [
      'req', '-x509', '-newkey', 'rsa:2048',
      '-keyout', keyPath, '-out', certPath,
      '-days', '825', '-nodes',
      '-subj', '/CN=daggerfall-vr-quest',
    ], { stdio: 'inherit' });
    if (gen.status !== 0) {
      console.error('openssl could not write .quest-certs/. Use USB and http://localhost instead.');
      process.exit(gen.status || 1);
    }
  }
  return { key: readFileSync(keyPath), cert: readFileSync(certPath) };
}

const serverOptions = { host: '0.0.0.0', port, strictPort: false };
if (wantHttps) serverOptions.https = localCerts();

const server = await createServer({ server: serverOptions });
await server.listen();

const addr = server.httpServer?.address();
const actualPort = typeof addr === 'object' && addr ? addr.port : port;
const scheme = wantHttps ? 'https' : 'http';
const dungeon = `${scheme}://localhost:${actualPort}/play/?dungeon&class=16&vr`;
const play = `${scheme}://localhost:${actualPort}/play/`;
const lab = `${scheme}://localhost:${actualPort}/vr.html`;

const adb = spawnSync('adb', ['reverse', `tcp:${actualPort}`, `tcp:${actualPort}`], { encoding: 'utf8' });

console.log('');
console.log('Quest VR dev server');
console.log(`  dungeon:   ${dungeon}`);
console.log(`  flat game: ${play}   (no Enter VR; the online flow is flat)`);
console.log(`  lab:       ${lab}`);
console.log(`  arena2:    ${process.env.ARENA2_PATH || './arena2'}   served at /arena2/ by the dev server`);
console.log('  logs:      this terminal and .quest-vr.log  (/api/vr-log)');
if (adb.status === 0) {
  console.log('  adb reverse: applied. In the Quest Browser open the localhost dungeon URL.');
} else {
  const why = adb.error ? 'adb is not installed' : (adb.stderr || 'no device').trim();
  console.log(`  adb reverse: not applied (${why}).`);
  console.log(`  Headset on USB, debugging allowed, then: adb reverse tcp:${actualPort} tcp:${actualPort}`);
  console.log(`  Quest Browser: ${dungeon}`);
}
if (!wantHttps) {
  console.log('  LAN http is not a secure context. The page can load; Enter VR will not:');
  for (const ip of lanAddrs()) console.log(`    http://${ip}:${actualPort}/play/?dungeon&class=16&vr`);
  console.log(`  Wireless with a trusted certificate: cloudflared tunnel --url http://127.0.0.1:${actualPort}`);
  console.log('  Self-signed LAN (often blocked by the headset warning): npm run dev:quest:https');
} else {
  console.log('  Self-signed HTTPS. Accepting the warning on the Quest often still hides WebXR.');
  console.log('  Prefer adb reverse and http://localhost, or a cloudflared/ngrok https URL.');
  for (const ip of lanAddrs()) console.log(`    https://${ip}:${actualPort}/play/?dungeon&class=16&vr`);
}
console.log('');
