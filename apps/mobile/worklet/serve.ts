// Pump RPC frames between a duplex IPC stream and the backend. Split from
// entry.ts so the smoke tests can drive the exact same loop over a mock pipe.
import type { Backend } from './backend.js';
import type { FrameDecoder as FrameDecoderT, encodeFrame as encodeFrameT } from '../common/protocol.js';
import type { RpcError as RpcErrorT } from './backend.js';

export interface IpcLike {
  on(event: 'data', listener: (chunk: Uint8Array) => void): void;
  write(chunk: Uint8Array): void;
}

interface Deps {
  FrameDecoder: typeof FrameDecoderT;
  encodeFrame: typeof encodeFrameT;
  RpcError: typeof RpcErrorT;
}

export function serve(backend: Backend, ipc: IpcLike, { FrameDecoder, encodeFrame, RpcError }: Deps): void {
  const decoder = new FrameDecoder();

  backend.onEvent((event) => ipc.write(encodeFrame({ event })));

  ipc.on('data', (chunk) => {
    for (const frame of decoder.push(chunk)) {
      const { id, method, params } = frame as { id?: number; method?: string; params?: unknown };
      if (typeof id !== 'number' || typeof method !== 'string') continue; // not a request — ignore
      void backend
        .handle(method, params)
        .then((result) => ipc.write(encodeFrame({ id, ok: true, result: result ?? null })))
        .catch((err: unknown) => {
          const code = err instanceof RpcError ? err.code : 'internal';
          const error = err instanceof Error ? err.message : 'something went wrong';
          ipc.write(encodeFrame({ id, ok: false, error, code }));
        });
    }
  });
}
