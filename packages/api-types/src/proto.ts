// Protobuf codec for the OVLive WS contract. `src/gen` is a protobufjs *static module*
// generated from the canonical packages/proto/ovlive.proto (`pnpm run generate`; CI fails
// if it drifts). Static rather than runtime reflection because the clients include React
// Native: Metro has no equivalent of Vite's `?raw` import, and protobufjs's reflection path
// builds codecs with `Function()`, which is off the table under Hermes. `--keep-case`
// preserves the snake_case field names exactly as declared, so wire objects match the .proto.

import { ovlive } from "./gen/ovlive.js";

export const ClientMessage = ovlive.v1.ClientMessage;
export const ServerMessage = ovlive.v1.ServerMessage;

export function encodeClient(payload: Record<string, unknown>): Uint8Array {
  const err = ClientMessage.verify(payload);
  if (err) throw new Error(`ClientMessage: ${err}`);
  return ClientMessage.encode(ClientMessage.fromObject(payload)).finish();
}

export function decodeServer(bytes: Uint8Array): Record<string, any> {
  const msg = ServerMessage.decode(bytes);
  return ServerMessage.toObject(msg, { defaults: true, arrays: true, enums: Number });
}
