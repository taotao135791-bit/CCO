import { existsSync, readdirSync, readFileSync } from 'fs';
import { join, extname } from 'path';
import { homedir } from 'os';

/**
 * Plugin definition loaded from ~/.cco/plugins/
 */
export interface Plugin {
  name: string;
  description: string;
  command: string;      // slash command name (e.g. 'lint')
  handler: (args: string[]) => Promise<string> | string;
}

const PLUGINS_DIR = join(homedir(), '.cco', 'plugins');

class PluginLoader {
  private plugins: Map<string, Plugin> = new Map();
  private loaded = false;

  /** Scan and load all plugins from the plugins directory */
  load(): number {
    this.plugins.clear();
    if (!existsSync(PLUGINS_DIR)) return 0;

    const files = readdirSync(PLUGINS_DIR).filter((f: string) =>
      f.endsWith('.js') || f.endsWith('.mjs') || f.endsWith('.json')
    );

    for (const file of files) {
      try {
        const fullPath = join(PLUGINS_DIR, file);
        if (file.endsWith('.json')) {
          const config = JSON.parse(readFileSync(fullPath, 'utf-8'));
          if (config.name && config.command) {
            this.plugins.set(config.command, {
              name: config.name,
              description: config.description || '',
              command: config.command,
              handler: async (args: string[]) => {
                if (config.type === 'bash' && config.script) {
                  const { execSync } = await import('child_process');
                  const cmd = config.script + (args.length ? ' ' + args.join(' ') : '');
                  return execSync(cmd, { encoding: 'utf-8', timeout: 30000 }).trim();
                }
                return `Plugin ${config.name}: no handler defined`;
              },
            });
          }
        }
        // .js/.mjs plugins would need dynamic import — skip for security
      } catch {
        // skip broken plugins
      }
    }

    this.loaded = true;
    return this.plugins.size;
  }

  /** List all loaded plugins */
  list(): Plugin[] {
    if (!this.loaded) this.load();
    return Array.from(this.plugins.values());
  }

  /** Get a plugin by command name */
  get(command: string): Plugin | undefined {
    if (!this.loaded) this.load();
    return this.plugins.get(command);
  }

  /** Execute a plugin command */
  async run(command: string, args: string[]): Promise<string> {
    const plugin = this.get(command);
    if (!plugin) return `未找到插件: ${command}`;
    try {
      return await plugin.handler(args);
    } catch (err: any) {
      return `插件 ${plugin.name} 执行失败: ${err.message || String(err)}`;
    }
  }
}

export const pluginLoader = new PluginLoader();
