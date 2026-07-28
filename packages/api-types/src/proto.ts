// Protobuf codec for the OVLive WS contract, built at runtime with protobufjs from the
// canonical ovlive.proto (no codegen step). `keepCase` preserves the snake_case field
// names exactly as declared, so wire objects match the .proto.

import protobuf from "protobufjs";
// Vite raw-imports the proto source as a string.
import protoSrc from "../../proto/ovlive.proto?raw";

const root = protobuf.parse(protoSrc as string, { keepCase: true }).root;

export const ClientMessage = root.lookupType("ovlive.v1.ClientMessage");
export const ServerMessage = root.lookupType("ovlive.v1.ServerMessage");

export function encodeClient(payload: Record<string, unknown>): Uint8Array {
  const err = ClientMessage.verify(payload);
  if (err) throw new Error(`ClientMessage: ${err}`);
  return ClientMessage.encode(ClientMessage.fromObject(payload)).finish();
}

export function decodeServer(bytes: Uint8Array): Record<string, any> {
  const msg = ServerMessage.decode(bytes);
  return ServerMessage.toObject(msg, { defaults: true, arrays: true, enums: Number });
}
