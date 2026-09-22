declare module 'node:child_process' {
  export function spawnSync(
    command: string,
    args: readonly string[],
    options: { readonly input: string; readonly encoding: 'utf8'; readonly maxBuffer?: number },
  ): { readonly error?: { readonly code?: string }; readonly status: number | null; readonly stderr: string; readonly stdout?: string };
}

declare module 'node:fs' {
  export function existsSync(path: string): boolean;
  export function readFileSync(path: string, encoding: 'utf8'): string;
  export function writeFileSync(path: string, data: string, encoding: 'utf8'): void;
  export function rmSync(path: string, options: { readonly force: boolean }): void;
}

declare module 'node:path' {
  export function join(...paths: readonly string[]): string;
}
