// Bare worklet entry: the whole Frith backend on a thread inside the app.
// The React Native side speaks length-prefixed JSON frames over BareKit.IPC
// (see common/protocol.ts); the first call must be `init` with the app's
// sandbox documents directory — mobile's stand-in for the desktop data dir.
import { FrameDecoder, encodeFrame } from '../common/protocol.js';
import { createBackend, RpcError } from './backend.js';
import { serve } from './serve.js';

declare const BareKit: { IPC: import('./serve.js').IpcLike };

const backend = createBackend();
serve(backend, BareKit.IPC, { FrameDecoder, encodeFrame, RpcError });
