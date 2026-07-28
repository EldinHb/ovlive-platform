// Drives /v1/stream the way apps/web does: send a protobuf Subscribe for a bbox, then
// report the ENTER/MOVE/LEAVE diffs the server ticks out. curl cannot exercise this
// endpoint — the first client frame must be a valid ClientMessage or the server ignores it.
//
//   node .claude/skills/run/scripts/ws-smoke.mjs [ws://host:port]
//
// Loaded WITHOUT keepCase, so decoded keys are camelCase (entered/moved/left, isSnapshot).
// packages/api-types uses keepCase:true and sees snake_case instead — don't mix them up.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const protobuf = createRequire(path.join(repoRoot, 'package.json'))('protobufjs');

const root = await protobuf.load(path.join(repoRoot, 'packages/proto/ovlive.proto'));
const ClientMessage = root.lookupType('ovlive.v1.ClientMessage');
const ServerMessage = root.lookupType('ovlive.v1.ServerMessage');

const url = process.argv[2] ?? 'ws://127.0.0.1:8080/v1/stream';
const ws = new WebSocket(url);
ws.binaryType = 'arraybuffer';

ws.onopen = () => {
  ws.send(
    ClientMessage.encode({
      subscribe: {
        // Amsterdam. Stay under MAX_VIEWPORT_AREA (2.0 deg²) or the server rejects it.
        viewport: { minLat: 52.30, minLon: 4.75, maxLat: 52.45, maxLon: 5.05, zoom: 12 },
        filters: {},
        pinned: [],
      },
    }).finish(),
  );
  console.log('sent Subscribe for Amsterdam bbox');
};

let frames = 0;
ws.onmessage = (ev) => {
  const m = ServerMessage.decode(new Uint8Array(ev.data));
  const kind = Object.keys(m).find((k) => m[k] != null) ?? '(empty)';
  if (kind === 'error') {
    console.error(`server error ${m.error.code}: ${m.error.message}`);
    process.exit(1);
  }
  const p = m[kind] ?? {};
  const counts = ['entered', 'moved', 'left'].map((k) => `${k}=${(p[k] ?? []).length}`).join(' ');
  console.log(`frame ${++frames}: ${kind} ${counts} snapshot=${!!p.isSnapshot}`);
  if (frames === 1) {
    if (!p.isSnapshot) console.error('  WARNING: first frame should have isSnapshot=true');
    if (p.entered?.[0]) console.log('  sample:', JSON.stringify(p.entered[0]).slice(0, 320));
    else console.error('  WARNING: empty snapshot — is the KV6 feed flowing? check /health');
  }
  if (frames >= 4) {
    ws.close();
    process.exit(0);
  }
};

ws.onerror = (e) => {
  console.error(`WS error connecting to ${url}:`, e.message ?? e);
  process.exit(1);
};
setTimeout(() => {
  console.error(`timeout: only ${frames} frame(s) in 15s`);
  process.exit(1);
}, 15000);
