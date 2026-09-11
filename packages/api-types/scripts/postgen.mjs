// Post-processes the pbjs static module so one file loads everywhere it is consumed.
//
// pbjs emits `import * as $protobuf from "protobufjs/minimal"`. protobufjs/minimal is CommonJS,
// and a namespace import of CommonJS only works through a bundler's interop (Vite, Metro);
// under strict Node ESM the namespace is `{ default }` and `$protobuf.roots` is undefined, and
// the bare specifier has no extension. A default import of the extension-qualified file is
// what Node, Vite and Metro all agree on: `module.exports` itself.
import { readFileSync, writeFileSync } from "node:fs";

const f = new URL("../src/gen/ovlive.js", import.meta.url);
const src = readFileSync(f, "utf8");
const out = src.replace(
  'import * as $protobuf from "protobufjs/minimal";',
  'import $protobuf from "protobufjs/minimal.js";',
);
if (out === src) throw new Error("postgen: expected protobufjs/minimal import not found");
writeFileSync(f, out);
