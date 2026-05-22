import { mkdtempSync, mkdirSync, copyFileSync, existsSync, readdirSync, statSync, writeFileSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve, relative } from 'path';

export interface Workspace {
  id: string;
  rootPath: string;
  originalPath: string;
  agentId: string;
}

export class WorkspaceManager {
  private workspaces: Map<string, Workspace> = new Map();

  createWorkspace(agentId: string, basePath: string = process.cwd()): Workspace {
    const tmpDir = mkdtempSync(join(tmpdir(), `cco-${agentId}-`));

    // Copy essential files (package.json, tsconfig, etc.)
    this.copyWorkspaceFiles(basePath, tmpDir);

    const ws: Workspace = {
      id: `ws_${Date.now()}`,
      rootPath: tmpDir,
      originalPath: basePath,
      agentId,
    };

    this.workspaces.set(agentId, ws);
    return ws;
  }

  private copyWorkspaceFiles(src: string, dest: string): void {
    const essentialFiles = ['package.json', 'tsconfig.json', '.gitignore', 'package-lock.json'];
    for (const file of essentialFiles) {
      const srcPath = join(src, file);
      if (existsSync(srcPath)) {
        copyFileSync(srcPath, join(dest, file));
      }
    }

    // Copy src directory if exists
    const srcDir = join(src, 'src');
    if (existsSync(srcDir)) {
      this.copyDir(srcDir, join(dest, 'src'));
    }
  }

  private copyDir(src: string, dest: string, depth = 0): void {
    if (depth > 20) return; // Prevent stack overflow on deeply nested dirs
    mkdirSync(dest, { recursive: true });
    for (const entry of readdirSync(src, { withFileTypes: true })) {
      const srcPath = join(src, entry.name);
      const destPath = join(dest, entry.name);
      // Skip symlinks to prevent infinite loops
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        this.copyDir(srcPath, destPath, depth + 1);
      } else {
        copyFileSync(srcPath, destPath);
      }
    }
  }

  getWorkspace(agentId: string): Workspace | undefined {
    return this.workspaces.get(agentId);
  }

  // Apply changes from workspace back to original
  mergeChanges(agentId: string): string[] {
    const ws = this.workspaces.get(agentId);
    if (!ws) return [];

    const changed: string[] = [];
    this.findChanges(ws.rootPath, ws.originalPath, '', changed);
    return changed;
  }

  private findChanges(wsRoot: string, origRoot: string, relPath: string, changed: string[]): void {
    const wsPath = join(wsRoot, relPath);
    const origPath = join(origRoot, relPath);

    if (!existsSync(wsPath)) return;

    const stat = statSync(wsPath);
    if (stat.isFile()) {
      if (!existsSync(origPath)) {
        copyFileSync(wsPath, origPath);
        changed.push(relPath);
      } else {
        const wsContent = readFileSync(wsPath);
        const origContent = readFileSync(origPath);
        if (!wsContent.equals(origContent)) {
          copyFileSync(wsPath, origPath);
          changed.push(relPath);
        }
      }
    } else if (stat.isDirectory()) {
      for (const entry of readdirSync(wsPath, { withFileTypes: true })) {
        this.findChanges(wsRoot, origRoot, join(relPath, entry.name), changed);
      }
    }
  }

  cleanup(agentId: string): void {
    const ws = this.workspaces.get(agentId);
    if (ws) {
      try {
        // Safe cleanup using Node.js fs.rmSync instead of shell command
        rmSync(ws.rootPath, { recursive: true, force: true, maxRetries: 3 });
      } catch {
        // ignore cleanup errors
      }
      this.workspaces.delete(agentId);
    }
  }
}

export const workspaceManager = new WorkspaceManager();
