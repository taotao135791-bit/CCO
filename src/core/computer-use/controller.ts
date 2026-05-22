import { exec, execFile } from 'child_process';
import { promisify } from 'util';
import { configManager } from '../config/manager.js';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

export interface ScreenshotResult {
  success: boolean;
  data?: string; // base64
  error?: string;
}

export class ComputerUseController {
  private enabled: boolean;

  constructor() {
    this.enabled = configManager.get().computerUse.enabled;
  }

  async screenshot(): Promise<ScreenshotResult> {
    if (!this.enabled) {
      return { success: false, error: 'Computer use is disabled in config' };
    }

    const platform = process.platform;
    const tmpPath = `/tmp/cco_screenshot_${Date.now()}.png`;

    try {
      if (platform === 'darwin') {
        await execAsync(`screencapture -x "${tmpPath}"`);
      } else if (platform === 'linux') {
        await execAsync(`import -window root "${tmpPath}"`);
      } else {
        return { success: false, error: `Unsupported platform: ${platform}` };
      }

      const fs = await import('fs');
      const data = fs.readFileSync(tmpPath);
      const base64 = data.toString('base64');
      fs.unlinkSync(tmpPath);

      return { success: true, data: `data:image/png;base64,${base64}` };
    } catch (err: any) {
      return { success: false, error: err.message || String(err) };
    }
  }

  async click(x: number, y: number): Promise<string> {
    if (!this.enabled) return 'Computer use disabled';
    const platform = process.platform;
    try {
      // Validate coordinates are numbers
      const safeX = Math.round(Number(x));
      const safeY = Math.round(Number(y));
      if (!Number.isFinite(safeX) || !Number.isFinite(safeY)) {
        return 'Error: invalid coordinates';
      }
      if (platform === 'darwin') {
        await execFileAsync('cliclick', [`c:${safeX},${safeY}`]);
      } else if (platform === 'linux') {
        await execFileAsync('xdotool', ['mousemove', String(safeX), String(safeY), 'click', '1']);
      }
      return `Clicked at (${safeX}, ${safeY})`;
    } catch (err: any) {
      return `Error: ${err.message}`;
    }
  }

  async type(text: string): Promise<string> {
    if (!this.enabled) return 'Computer use disabled';
    const platform = process.platform;
    try {
      // Whitelist: only allow printable ASCII + basic unicode
      const safeText = text.replace(/[^\x20-\x7E\n\r\t]/g, '');
      if (safeText.length === 0) return 'Error: no valid characters to type';

      if (platform === 'darwin') {
        await execFileAsync('cliclick', [`t:${safeText}`]);
      } else if (platform === 'linux') {
        await execFileAsync('xdotool', ['type', '--', safeText]);
      }
      return `Typed: ${safeText.slice(0, 50)}${safeText.length > 50 ? '...' : ''}`;
    } catch (err: any) {
      return `Error: ${err.message}`;
    }
  }

  async key(keyName: string): Promise<string> {
    if (!this.enabled) return 'Computer use disabled';
    const platform = process.platform;
    try {
      // Whitelist allowed keys
      const allowedKeys = new Set([
        'enter', 'escape', 'tab', 'space', 'backspace',
        'up', 'down', 'left', 'right',
        'home', 'end', 'pageup', 'pagedown',
        'delete', 'insert', 'f1', 'f2', 'f3', 'f4', 'f5', 'f6',
        'f7', 'f8', 'f9', 'f10', 'f11', 'f12',
      ]);
      const key = keyName.toLowerCase();
      if (!allowedKeys.has(key)) {
        return `Error: key '${keyName}' not in allowed list`;
      }

      if (platform === 'darwin') {
        const keyMap: Record<string, string> = {
          enter: 'kp:return',
          escape: 'kp:esc',
          tab: 'kp:tab',
          space: 'kp:space',
          backspace: 'kp:delete',
          up: 'kp:up',
          down: 'kp:down',
          left: 'kp:left',
          right: 'kp:right',
        };
        const k = keyMap[key] || `kp:${key}`;
        await execFileAsync('cliclick', [k]);
      } else if (platform === 'linux') {
        await execFileAsync('xdotool', ['key', key]);
      }
      return `Pressed: ${key}`;
    } catch (err: any) {
      return `Error: ${err.message}`;
    }
  }
}

export const computerUse = new ComputerUseController();
