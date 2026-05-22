import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import { configManager } from '../config/manager.js';
import type { AgentMessage } from './engine.js';

export interface SessionData {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  messages: AgentMessage[];
  agentId: string;
  parentAgent?: string;
}

const SESSIONS_DIR = join(configManager.getConfigDir(), 'sessions');

export class SessionPersistence {
  private ensureDir(): void {
    mkdirSync(SESSIONS_DIR, { recursive: true });
  }

  saveSession(session: SessionData): void {
    this.ensureDir();
    const path = join(SESSIONS_DIR, `${session.agentId}.json`);
    writeFileSync(
      path,
      JSON.stringify(
        {
          ...session,
          updatedAt: Date.now(),
        },
        null,
        2
      )
    );
  }

  loadSession(agentId: string): SessionData | null {
    const path = join(SESSIONS_DIR, `${agentId}.json`);
    if (!existsSync(path)) return null;
    try {
      return JSON.parse(readFileSync(path, 'utf-8'));
    } catch {
      return null;
    }
  }

  listSessions(): SessionData[] {
    this.ensureDir();
    const files = readdirSync(SESSIONS_DIR)
      .filter((f: string) => f.endsWith('.json'));
    return files
      .map((f: string) => {
        try {
          return JSON.parse(readFileSync(join(SESSIONS_DIR, f), 'utf-8'));
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .sort((a: SessionData, b: SessionData) => b.updatedAt - a.updatedAt);
  }

  deleteSession(agentId: string): void {
    const path = join(SESSIONS_DIR, `${agentId}.json`);
    if (existsSync(path)) {
      unlinkSync(path);
    }
  }

  autoSave(agentId: string, name: string, messages: AgentMessage[], parentAgent?: string): void {
    this.saveSession({
      id: `${agentId}_${Date.now()}`,
      name,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages,
      agentId,
      parentAgent,
    });
  }
}

export const sessionPersistence = new SessionPersistence();
