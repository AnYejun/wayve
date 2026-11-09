import type { Server } from 'node:http';
import type { RequestHandler, Express } from 'express';
export function listen(app: Express, port: number, cb?: () => void): Server;
export const lifecycle: RequestHandler;
export function onShutdown(fn: (sig: string) => void): void;
export function graceful(server: Server, opts?: { db?: { exec(sql: string): void; close(): void } }): void;
export function lifecycleState(): { state: 'up' | 'draining'; inflight: number; intervals: number };
