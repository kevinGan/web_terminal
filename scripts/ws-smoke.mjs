import { WebSocket } from '../node_modules/.pnpm/ws@8.20.0/node_modules/ws/wrapper.mjs';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const token = readFileSync(join(homedir(), '.web_terminal', 'token'), 'utf8').trim();
const url = `ws://127.0.0.1:${process.env.WT_PORT ?? 7681}/ws/terminal?token=${token}`;
const ws = new WebSocket(url);

const lines = [];
const send = (s) => ws.send(Buffer.from(s, 'utf8'), { binary: true });
ws.on('open', () => {
  ws.send(JSON.stringify({ type: 'init', cols: 120, rows: 30 }));
  setTimeout(() => { console.log('>> SEND echo'); send('echo MARK1_$WEB_TERMINAL\n'); }, 2000);
  setTimeout(() => { console.log('>> SEND shell'); send('echo MARK2_$SHELL\n'); }, 3500);
  setTimeout(() => { console.log('>> SEND cd'); send('cd /tmp && echo MARK3_$PWD\n'); }, 5000);
  setTimeout(() => { console.log('>> CLOSE'); ws.close(); }, 7500);
});
ws.on('message', (d, isBinary) => {
  if (!isBinary) {
    console.log('[CTL]', d.toString());
    return;
  }
  const s = d.toString('utf8');
  lines.push(s);
  process.stdout.write('[OUT-RAW:' + JSON.stringify(s).slice(0, 200) + ']\n');
});
ws.on('close', () => {
  const all = lines.join('').replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\x1b\][^\x07]*\x07/g, '').replace(/\r/g, '');
  console.log('---OUTPUT (cleaned)---');
  console.log(all);
  process.exit(0);
});
ws.on('error', (e) => { console.error('ERR', e.message); process.exit(1); });
