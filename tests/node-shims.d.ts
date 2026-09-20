declare module 'node:child_process' {
  export function spawnSync(
    command: string,
    args: readonly string[],
    options: { readonly input: string; readonly encoding: 'utf8' },
  ): { readonly error?: { readonly code?: string }; readonly status: number | null; readonly stderr: string };
}
