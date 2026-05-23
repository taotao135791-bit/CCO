import { globby } from 'globby';
import { readFileSync, statSync } from 'fs';
import { createHash } from 'crypto';
import { resolve } from 'path';

interface FileIndex {
  path: string;
  content: string;
  size: number;
  mtime: number;
  hash: string;
  summary?: string;
}

export class CodeIndexer {
  private index: Map<string, FileIndex> = new Map();
  private patterns = ['src/**/*.{ts,tsx,js,jsx}', 'lib/**/*.{ts,tsx,js,jsx}'];
  private maxFileSize = 500 * 1024; // 500KB

  async buildIndex(): Promise<number> {
    const files = await globby(this.patterns, {
      cwd: process.cwd(),
      gitignore: true,
    });

    let count = 0;
    const baseDir = process.cwd();
    for (const file of files) {
      try {
        const absPath = resolve(baseDir, file);
        const stat = statSync(absPath);
        if (stat.size > this.maxFileSize) continue;

        const content = readFileSync(absPath, 'utf-8');
        const hash = createHash('sha256').update(content).digest('hex').slice(0, 16);

        const existing = this.index.get(file);
        if (existing && existing.hash === hash) {
          continue; // unchanged
        }

        this.index.set(file, {
          path: file,
          content: content.slice(0, 5000), // truncate for memory
          size: stat.size,
          mtime: stat.mtimeMs,
          hash,
        });
        count++;
      } catch {
        // ignore unreadable files
      }
    }

    return count;
  }

  search(query: string): FileIndex[] {
    const terms = query.toLowerCase().split(/\s+/);
    const results: Array<{ file: FileIndex; score: number }> = [];

    for (const file of this.index.values()) {
      const content = file.content.toLowerCase();
      let score = 0;
      for (const term of terms) {
        if (content.includes(term)) score++;
        if (file.path.toLowerCase().includes(term)) score += 2;
      }
      if (score > 0) {
        results.push({ file, score });
      }
    }

    return results.sort((a, b) => b.score - a.score).map((r) => r.file).slice(0, 10);
  }

  getFile(path: string): FileIndex | undefined {
    return this.index.get(path);
  }

  getStats(): { totalFiles: number; totalSize: number } {
    const files = Array.from(this.index.values());
    return {
      totalFiles: files.length,
      totalSize: files.reduce((sum, f) => sum + f.size, 0),
    };
  }
}

export const codeIndexer = new CodeIndexer();
