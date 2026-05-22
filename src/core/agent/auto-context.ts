import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, extname, relative } from 'path';
import { cwd } from 'process';

/**
 * Analyze user message and suggest relevant files to inject as context.
 * Uses keyword matching on filenames and content snippets.
 */
export function suggestContextFiles(userMessage: string, maxFiles = 5): string[] {
  const keywords = extractKeywords(userMessage);
  if (keywords.length === 0) return [];

  const projectFiles = scanProjectFiles(cwd(), 200);
  const scored: Array<{ path: string; score: number }> = [];

  for (const file of projectFiles) {
    let score = 0;
    const lowerPath = file.toLowerCase();
    const baseName = lowerPath.split('/').pop() || '';

    // Filename match (high weight)
    for (const kw of keywords) {
      if (baseName.includes(kw)) score += 10;
      if (lowerPath.includes(kw)) score += 5;
    }

    // Extension relevance
    if (isCodeFile(file)) score += 2;

    if (score > 0) {
      scored.push({ path: file, score });
    }
  }

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, maxFiles)
    .map((s) => s.path);
}

/**
 * Extract meaningful keywords from user message.
 * Filters out common stop words and short tokens.
 */
function extractKeywords(message: string): string[] {
  const stopWords = new Set([
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
    'could', 'should', 'may', 'might', 'can', 'shall', 'to', 'of',
    'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as', 'into',
    'about', 'it', 'its', 'this', 'that', 'and', 'or', 'but', 'not',
    'no', 'if', 'then', 'than', 'so', 'my', 'me', 'i', 'you',
    'we', 'they', 'he', 'she', 'what', 'which', 'who', 'how',
    'all', 'each', 'every', 'both', 'few', 'more', 'most', 'other',
    'some', 'such', 'only', 'own', 'same', 'just', 'also', 'very',
    'please', 'help', 'want', 'need', 'make', 'add', 'fix', 'create',
    '修改', '添加', '修复', '创建', '删除', '查看', '帮我', '请',
  ]);

  // Extract identifiers (camelCase, snake_case, PascalCase)
  const identifiers = message.match(/[a-zA-Z_][a-zA-Z0-9_]+/g) || [];
  // Extract quoted strings
  const quoted = message.match(/["'`]([^"'`]+)["'`]/g)?.map((s) => s.slice(1, -1)) || [];

  const all = [...identifiers, ...quoted];
  const keywords: string[] = [];

  for (const word of all) {
    const lower = word.toLowerCase();
    if (lower.length < 3) continue;
    if (stopWords.has(lower)) continue;
    if (!keywords.includes(lower)) keywords.push(lower);
  }

  return keywords.slice(0, 10);
}

/**
 * Scan project for code files (respects .gitignore conceptually).
 * Returns relative paths.
 */
function scanProjectFiles(root: string, maxFiles: number): string[] {
  const files: string[] = [];
  const skipDirs = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'coverage', '__pycache__', '.venv', 'vendor']);
  const codeExts = new Set([
    '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
    '.py', '.rb', '.go', '.rs', '.java', '.kt',
    '.c', '.cpp', '.h', '.hpp', '.cs', '.swift',
    '.vue', '.svelte', '.html', '.css', '.scss',
    '.json', '.yaml', '.yml', '.toml', '.xml',
    '.md', '.sql', '.sh', '.bash', '.zsh',
  ]);

  function scan(dir: string, depth: number): void {
    if (files.length >= maxFiles || depth > 4) return;
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (files.length >= maxFiles) break;
        if (entry.name.startsWith('.') && entry.name !== '.gitignore') continue;
        if (skipDirs.has(entry.name)) continue;

        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          scan(fullPath, depth + 1);
        } else if (entry.isFile()) {
          const ext = extname(entry.name);
          if (codeExts.has(ext)) {
            try {
              const stat = statSync(fullPath);
              if (stat.size < 100 * 1024) { // Skip files > 100KB
                files.push(relative(root, fullPath));
              }
            } catch { /* skip */ }
          }
        }
      }
    } catch { /* skip unreadable dirs */ }
  }

  scan(root, 0);
  return files;
}

function isCodeFile(path: string): boolean {
  const ext = extname(path);
  return ['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs', '.java', '.c', '.cpp', '.rb'].includes(ext);
}

/**
 * Build a context injection block from file paths.
 * Returns formatted string to append to user message or system prompt.
 */
export function buildContextBlock(files: string[]): string {
  if (files.length === 0) return '';

  const parts: string[] = ['\n[RELEVANT PROJECT FILES — you may want to Read these]:'];
  for (const file of files) {
    parts.push(`  - ${file}`);
  }
  return parts.join('\n');
}
