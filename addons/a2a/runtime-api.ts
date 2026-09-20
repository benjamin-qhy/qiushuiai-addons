import type { PublicOperation } from "./task-store.js";
export interface OperationClient {
  version: 1;
  admit(input: {
    target: string;
    idempotencyKey: string;
    text: string;
  }): Promise<{
    created: boolean;
    admission: string;
    operation: PublicOperation | null;
  }>;
  get(id: string): Promise<PublicOperation>;
  events?(
    id: string,
    after?: number,
  ): Promise<{
    snapshot: PublicOperation;
    events: Array<{ sequence: number; snapshot: PublicOperation }>;
    gap: boolean;
  }>;
  cancel(id: string): Promise<{ outcome: string; operation: PublicOperation }>;
  continue(
    id: string,
    text: string,
  ): Promise<{ resumed: boolean; operation: PublicOperation }>;
  resume(
    id: string,
  ): Promise<{ resumed: boolean; operation: PublicOperation | null }>;
}
export interface OperationAdapter {
  forPrincipal(principalId: string): OperationClient;
  admitOutbound?: () => { workId: string; chatJid: string; allowed: boolean };
}
export interface A2aHostApi {
  lifecycle: {
    version: 1;
    onShutdown(callback: () => void | Promise<void>): () => void;
  };
  messaging: { version: 1; getAddonDataDir(addonId: string): string };
  operations: { version: 1; register(): OperationAdapter };
  externalRoutes: {
    version: 1;
    register(input: {
      addonId: string;
      prefix: string;
      methods: string[];
      maxBodyBytes: number;
      handler: (req: Request, path: string) => Promise<Response> | Response;
    }): () => void;
  };
}
/** No fallback to raw enqueue when an older runtime lacks admitted operations. */
export function a2aHostApi(): A2aHostApi | null {
  const api = (globalThis as any).__qiushuiai_runtime;
  return api?.operations?.version === 1 &&
    api?.messaging?.version === 1 &&
    api?.lifecycle?.version === 1 &&
    api?.externalRoutes?.version === 1
    ? api
    : null;
}
