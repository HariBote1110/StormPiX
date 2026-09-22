declare module 'node:fs' {
  export function existsSync(path: string): boolean;
  export function readdirSync(path: string): string[];
  export function readFileSync(path: string, encoding: 'utf8'): string;
  export function readFileSync(path: string): Uint8Array;
}

declare module 'node:module' {
  export function stripTypeScriptTypes(source: string, options?: { readonly mode?: 'strip' | 'transform' }): string;
}

declare module 'node:url' {
  export function pathToFileURL(path: string): URL;
}

declare module 'node:zlib' {
  export function inflateSync(data: Uint8Array): Uint8Array;
}

declare const process: {
  readonly argv: string[];
  readonly env: Record<string, string | undefined>;
  readonly stdout: { write(value: string): void };
  readonly stderr: { write(value: string): void };
  exitCode?: number;
};
