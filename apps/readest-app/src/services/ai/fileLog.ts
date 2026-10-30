import { isTauriAppPlatform } from '@/services/environment';

// aiLogger is console-only and compiled out in release builds, which makes
// field diagnosis impossible. The desktop app already runs tauri-plugin-log
// with a LogDir target, so these lines land in
// ~/.local/share/<bundle-id>/logs/<app>.log next to the Rust logs.
type LogFn = (message: string) => void;

let writer: Promise<LogFn> | null = null;

function getWriter(): Promise<LogFn> | null {
  if (!isTauriAppPlatform()) return null;
  writer ??= import('@tauri-apps/plugin-log')
    .then((plugin) => (message: string) => void plugin.info(message))
    .catch(() => () => {});
  return writer;
}

export function aiFileLog(message: string): void {
  const pending = getWriter();
  if (!pending) return;
  void pending.then((write) => write(`[AI] ${message}`));
}
