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
  symbols?: CodeSymbol[];
}

export interface CodeSymbol {
  name: string;
  kind: 'function' | 'class' | 'interface' | 'type' | 'enum' | 'const' | 'method' | 'struct' | 'trait' | 'impl';
  line: number;
  file: string;
}

export class CodeIndexer {
  private index: Map<string, FileIndex> = new Map();
  private symbolIndex: Map<string, CodeSymbol[]> = new Map(); // symbolName -> symbols
  private patterns = [
    'src/**/*.{ts,tsx,js,jsx,mts,mjs}',
    'lib/**/*.{ts,tsx,js,jsx}',
    '**/*.py',
    '**/*.rs',
    '**/*.go',
    '**/*.java',
  ];
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

        const symbols = extractSymbols(content, file);

        this.index.set(file, {
          path: file,
          content: content.slice(0, 5000), // truncate for memory
          size: stat.size,
          mtime: stat.mtimeMs,
          hash,
          symbols,
        });

        // Update symbol index
        for (const sym of symbols) {
          const key = sym.name.toLowerCase();
          if (!this.symbolIndex.has(key)) this.symbolIndex.set(key, []);
          this.symbolIndex.get(key)!.push(sym);
        }

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

  /**
   * Search for symbols by name. Supports prefix queries.
   * Use "func:handleCommand" or "class:Agent" format for kind-specific search.
   */
  searchSymbols(query: string): CodeSymbol[] {
    const parts = query.split(':');
    let kindFilter: string | null = null;
    let nameQuery: string;

    if (parts.length === 2 && ['func', 'class', 'interface', 'type', 'enum', 'const', 'method', 'struct', 'trait', 'impl'].includes(parts[0])) {
      kindFilter = parts[0];
      nameQuery = parts[1].toLowerCase();
    } else {
      nameQuery = query.toLowerCase();
    }

    const results: CodeSymbol[] = [];
    const seen = new Set<string>();

    for (const [key, symbols] of this.symbolIndex) {
      if (key.includes(nameQuery)) {
        for (const sym of symbols) {
          const uid = `${sym.file}:${sym.line}:${sym.name}`;
          if (seen.has(uid)) continue;
          if (kindFilter && sym.kind !== kindFilter) continue;
          seen.add(uid);
          results.push(sym);
        }
      }
    }

    return results.slice(0, 30);
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

// ── Symbol extraction via regex (lightweight tree-sitter alternative) ───────

const SYMBOL_PATTERNS: Record<string, Array<{ regex: RegExp; kind: CodeSymbol['kind'] }>> = {
  '.ts': [
    { regex: /^export\s+(?:async\s+)?function\s+(\w+)/gm, kind: 'function' },
    { regex: /^(?:export\s+)?(?:async\s+)?function\s+(\w+)/gm, kind: 'function' },
    { regex: /^export\s+(?:abstract\s+)?class\s+(\w+)/gm, kind: 'class' },
    { regex: /^export\s+interface\s+(\w+)/gm, kind: 'interface' },
    { regex: /^export\s+type\s+(\w+)/gm, kind: 'type' },
    { regex: /^export\s+(?:const|let)\s+(\w+)/gm, kind: 'const' },
    { regex: /^\s+(?:async\s+)?(\w+)\s*\([^)]*\)\s*[:{]/gm, kind: 'method' },
  ],
  '.tsx': [
    { regex: /^export\s+(?:async\s+)?function\s+(\w+)/gm, kind: 'function' },
    { regex: /^(?:export\s+)?(?:async\s+)?function\s+(\w+)/gm, kind: 'function' },
    { regex: /^export\s+(?:abstract\s+)?class\s+(\w+)/gm, kind: 'class' },
    { regex: /^export\s+interface\s+(\w+)/gm, kind: 'interface' },
    { regex: /^export\s+type\s+(\w+)/gm, kind: 'type' },
  ],
  '.js': [
    { regex: /^(?:export\s+)?(?:async\s+)?function\s+(\w+)/gm, kind: 'function' },
    { regex: /^(?:export\s+)?class\s+(\w+)/gm, kind: 'class' },
    { regex: /^(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s+)?\(/gm, kind: 'function' },
  ],
  '.py': [
    { regex: /^(?:async\s+)?def\s+(\w+)/gm, kind: 'function' },
    { regex: /^class\s+(\w+)/gm, kind: 'class' },
  ],
  '.rs': [
    { regex: /^(?:pub\s+)?(?:async\s+)?fn\s+(\w+)/gm, kind: 'function' },
    { regex: /^(?:pub\s+)?struct\s+(\w+)/gm, kind: 'struct' },
    { regex: /^(?:pub\s+)?trait\s+(\w+)/gm, kind: 'trait' },
    { regex: /^impl\s+(\w+)/gm, kind: 'impl' },
    { regex: /^(?:pub\s+)?enum\s+(\w+)/gm, kind: 'enum' },
  ],
  '.go': [
    { regex: /^func\s+(?:\([^)]+\)\s+)?(\w+)/gm, kind: 'function' },
    { regex: /^type\s+(\w+)\s+struct/gm, kind: 'struct' },
    { regex: /^type\s+(\w+)\s+interface/gm, kind: 'interface' },
  ],
  '.java': [
    { regex: /^(?:public|private|protected)?\s*(?:static\s+)?(?:\w+\s+)+(\w+)\s*\([^)]*\)\s*\{/gm, kind: 'method' },
    { regex: /^(?:public\s+)?(?:abstract\s+)?class\s+(\w+)/gm, kind: 'class' },
    { regex: /^(?:public\s+)?interface\s+(\w+)/gm, kind: 'interface' },
    { regex: /^(?:public\s+)?enum\s+(\w+)/gm, kind: 'enum' },
  ],
};

function extractSymbols(content: string, filePath: string): CodeSymbol[] {
  const ext = filePath.match(/\.\w+$/)?.[0] || '';
  const patterns = SYMBOL_PATTERNS[ext];
  if (!patterns) return [];

  const symbols: CodeSymbol[] = [];
  const lines = content.split('\n');

  for (const { regex, kind } of patterns) {
    regex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(content)) !== null) {
      const name = match[1];
      if (!name || name.length < 2) continue;
      // Calculate line number from match index
      const beforeMatch = content.slice(0, match.index);
      const line = beforeMatch.split('\n').length;
      symbols.push({ name, kind, line, file: filePath });
    }
  }

  return symbols;
}
