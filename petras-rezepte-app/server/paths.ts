/** Speicherorte. Daten liegen getrennt vom Programm und bleiben bei Updates erhalten. */
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const APP_NAME = 'Petras Rezepte App';
export const APP_VERSION = '1.3.0';

export function dataDir(): string {
  const dir = process.env.PRA_DATA_DIR
    || (process.platform === 'win32'
      ? join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), APP_NAME)
      : join(homedir(), '.petras-rezepte-app'));
  for (const sub of ['', 'backups', 'logs']) mkdirSync(join(dir, sub), { recursive: true });
  return dir;
}
