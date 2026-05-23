/**
 * Secure credential storage for API keys.
 * Keys are stored in ~/.cco/auth.json with file permissions 0o600.
 * This keeps secrets out of the main config file.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync, chmodSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const AUTH_DIR = join(homedir(), '.cco');
const AUTH_FILE = join(AUTH_DIR, 'auth.json');

export interface AuthEntry {
  type: 'api';
  key: string;
  /** Optional metadata (e.g. key prefix for display) */
  metadata?: Record<string, string>;
}

type AuthData = Record<string, AuthEntry>;

export class AuthStore {
  private data: AuthData = {};

  constructor() {
    this.load();
  }

  private load(): void {
    try {
      if (existsSync(AUTH_FILE)) {
        const raw = readFileSync(AUTH_FILE, 'utf-8');
        this.data = JSON.parse(raw);
      }
    } catch {
      this.data = {};
    }
  }

  private save(): void {
    try {
      mkdirSync(AUTH_DIR, { recursive: true });
      writeFileSync(AUTH_FILE, JSON.stringify(this.data, null, 2), { mode: 0o600 });
      // Ensure file permissions even if file already existed
      try { chmodSync(AUTH_FILE, 0o600); } catch { /* ignore on Windows */ }
    } catch {
      // Ignore write errors
    }
  }

  /** Get API key for a provider, or undefined if not stored. */
  getKey(providerName: string): string | undefined {
    return this.data[providerName]?.key;
  }

  /** Check if a provider has credentials stored. */
  hasKey(providerName: string): boolean {
    return !!this.data[providerName]?.key;
  }

  /** Store an API key for a provider. */
  setKey(providerName: string, key: string, metadata?: Record<string, string>): void {
    this.data[providerName] = { type: 'api', key, metadata };
    this.save();
  }

  /** Remove stored credentials for a provider. */
  removeKey(providerName: string): void {
    delete this.data[providerName];
    this.save();
  }

  /** List all providers that have stored credentials. */
  listProviders(): string[] {
    return Object.keys(this.data);
  }

  /** Get a masked version of the key for display (e.g. "sk-ant-...abc1") */
  getMaskedKey(providerName: string): string | undefined {
    const key = this.getKey(providerName);
    if (!key) return undefined;
    if (key.length <= 8) return '****';
    return `${key.slice(0, 6)}...${key.slice(-4)}`;
  }

  /** Get all entries (for migration or export). */
  getAll(): AuthData {
    return { ...this.data };
  }
}

export const authStore = new AuthStore();
