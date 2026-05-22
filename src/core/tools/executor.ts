import { mkdirSync, readFileSync, writeFileSync, existsSync, statSync, readdirSync } from 'fs';
import { exec, execSync } from 'child_process';
import { promisify } from 'util';
import { globby } from 'globby';
import { dirname, relative, resolve, isAbsolute, join } from 'path';
import { cwd } from 'process';
import { computerUse } from '../computer-use/controller.js';
import type { ToolDefinition, ToolResult } from './definitions.js';
import { validateBashCommand, validateUrl, clampTimeout } from '../security.js';
import { editLock } from './edit-lock.js';
import { diffTracker } from './diff-tracker.js';

const execAsync = promisify(exec);

// In-memory todo store for TodoWrite tool
const todoStore: Array<{ id: string; content: string; status: string }> = [];

function resolvePath(filePath: string): string {
  if (isAbsolute(filePath)) return filePath;
  return resolve(cwd(), filePath);
}

function isInsideWorkspace(path: string): boolean {
  const rel = relative(cwd(), path);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function ensureWritablePath(path: string): ToolResult | null {
  if (!isInsideWorkspace(path)) {
    return {
      content: `Error: Refusing to write outside the current workspace: ${path}`,
      isError: true,
    };
  }
  return null;
}

function truncateOutput(content: string, maxLines = 200): string {
  const lines = content.split('\n');
  if (lines.length <= maxLines) return content;
  return lines.slice(0, maxLines).join('\n') + `\n\n... (${lines.length - maxLines} more lines)`;
}

/**
 * Strip sensitive environment variables before passing to child processes.
 * Prevents API keys and tokens from leaking via `printenv`, `env`, etc.
 */
const SENSITIVE_ENV_KEYS = [
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'API_KEY',
  'API_SECRET',
  'SECRET_KEY',
  'ACCESS_TOKEN',
  'AUTH_TOKEN',
  'PRIVATE_KEY',
];

function sanitizeEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) continue;
    const upperKey = key.toUpperCase();
    if (SENSITIVE_ENV_KEYS.some((s) => upperKey.includes(s))) continue;
    result[key] = value;
  }
  return result;
}

// ── Helper: generate unified diff ──────────────────────────────────────────
function generateDiff(oldContent: string, newContent: string, filePath: string): string {
  const oldLines = oldContent.split('\n');
  const newLines = newContent.split('\n');
  const relPath = relative(cwd(), filePath) || filePath;
  const output: string[] = [`--- a/${relPath}`, `+++ b/${relPath}`];
  // Simple line-by-line diff with context
  const maxLines = Math.max(oldLines.length, newLines.length);
  let inHunk = false;
  let hunkStart = -1;
  let hunkOldStart = 0;
  let hunkNewStart = 0;
  let hunkLines: string[] = [];
  let oldCount = 0;
  let newCount = 0;
  const contextSize = 3;

  function flushHunk() {
    if (hunkLines.length === 0) return;
    output.push(`@@ -${hunkOldStart + 1},${oldCount} +${hunkNewStart + 1},${newCount} @@`);
    output.push(...hunkLines);
    hunkLines = [];
    inHunk = false;
    oldCount = 0;
    newCount = 0;
  }

  let lastChangeLine = -contextSize - 1;
  for (let i = 0; i < maxLines; i++) {
    const oldLine = i < oldLines.length ? oldLines[i] : undefined;
    const newLine = i < newLines.length ? newLines[i] : undefined;
    const changed = oldLine !== newLine;

    if (changed) {
      if (!inHunk) {
        inHunk = true;
        hunkStart = Math.max(0, i - contextSize);
        hunkOldStart = hunkStart;
        hunkNewStart = hunkStart;
        // Add leading context
        for (let c = hunkStart; c < i; c++) {
          if (c < oldLines.length) {
            hunkLines.push(` ${oldLines[c]}`);
            oldCount++;
            newCount++;
          }
        }
      }
      if (oldLine !== undefined && newLine !== undefined) {
        hunkLines.push(`-${oldLine}`);
        hunkLines.push(`+${newLine}`);
        oldCount++;
        newCount++;
      } else if (oldLine !== undefined) {
        hunkLines.push(`-${oldLine}`);
        oldCount++;
      } else if (newLine !== undefined) {
        hunkLines.push(`+${newLine}`);
        newCount++;
      }
      lastChangeLine = i;
    } else if (inHunk) {
      if (i - lastChangeLine <= contextSize) {
        hunkLines.push(` ${oldLine}`);
        oldCount++;
        newCount++;
      } else {
        flushHunk();
      }
    }
  }
  flushHunk();
  return output.length > 2 ? output.join('\n') : '(no changes)';
}

// ── Helper: try system-level grep (rg or grep) ────────────────────────────
async function trySystemGrep(
  pattern: string,
  searchPath: string,
  include: string | undefined,
  contextLines: number,
  caseInsensitive: boolean | undefined,
): Promise<ToolResult | null> {
  // Try ripgrep first
  try {
    execSync('rg --version', { stdio: 'ignore' });
    const rgArgs = [
      'rg',
      '--no-heading',
      '--line-number',
      '-C', String(contextLines),
      '--max-count', '50',
    ];
    if (caseInsensitive) rgArgs.push('-i');
    if (include) rgArgs.push('--glob', include);
    rgArgs.push('--', JSON.stringify(pattern), JSON.stringify(searchPath));
    const cmd = rgArgs.join(' ');
    const { stdout } = await execAsync(cmd, {
      timeout: 30000,
      cwd: cwd(),
      env: { ...sanitizeEnv(process.env), FORCE_COLOR: '0', NO_COLOR: '1' },
    });
    if (stdout.trim()) {
      return { content: truncateOutput(stdout.trim(), 300) };
    }
    return { content: `No matches found for pattern: ${pattern}` };
  } catch (e: any) {
    // rg not available or failed — try grep if it's not an rg error
    if (e.message?.includes('command not found') || e.code === 'ENOENT' || e.stderr?.includes('No such file')) {
      // fall through to grep
    } else if (e.stdout === '' || e.stdout === undefined) {
      return { content: `No matches found for pattern: ${pattern}` };
    } else if (e.stdout) {
      return { content: truncateOutput(e.stdout.trim(), 300) };
    }
  }

  // Try system grep
  try {
    execSync('grep --version', { stdio: 'ignore' });
    const grepArgs = [
      'grep',
      '-rn',
      '-C', String(contextLines),
      '--max-count=50',
    ];
    if (caseInsensitive) grepArgs.push('-i');
    if (include) grepArgs.push(`--include=${include}`);
    grepArgs.push('-E', '--', JSON.stringify(pattern), JSON.stringify(searchPath));
    const cmd = grepArgs.join(' ');
    const { stdout } = await execAsync(cmd, {
      timeout: 30000,
      cwd: cwd(),
      env: { ...sanitizeEnv(process.env), FORCE_COLOR: '0', NO_COLOR: '1' },
    });
    if (stdout.trim()) {
      return { content: truncateOutput(stdout.trim(), 300) };
    }
    return { content: `No matches found for pattern: ${pattern}` };
  } catch (e: any) {
    if (e.message?.includes('command not found') || e.code === 'ENOENT') {
      return null; // fall through to JS
    }
    if (e.stdout) {
      return { content: truncateOutput(e.stdout.trim(), 300) };
    }
    return null; // JS fallback
  }
}

export async function executeTool(name: string, args: Record<string, any>): Promise<ToolResult> {
  try {
    switch (name) {
      case 'Read': {
        const path = resolvePath(args.file_path);
        if (!existsSync(path)) return { content: `Error: File not found: ${path}`, isError: true };
        const stat = statSync(path);
        if (stat.isDirectory()) return { content: `Error: ${path} is a directory`, isError: true };
        let content = readFileSync(path, 'utf-8');
        if (args.offset || args.limit) {
          const lines = content.split('\n');
          const start = (args.offset ?? 1) - 1;
          const end = args.limit ? start + args.limit : lines.length;
          content = lines.slice(start, end).join('\n');
        }
        return { content: truncateOutput(content) };
      }

      case 'Write': {
        const path = resolvePath(args.file_path);
        const guard = ensureWritablePath(path);
        if (guard) return guard;
        const releaseWrite = await editLock.acquire(path);
        try {
          mkdirSync(dirname(path), { recursive: true });
          const oldContent = existsSync(path) ? readFileSync(path, 'utf-8') : '';
          writeFileSync(path, args.content, 'utf-8');
          diffTracker.record(path, oldContent, args.content);
          return { content: `Successfully wrote ${args.content.length} bytes to ${path}` };
        } finally {
          releaseWrite();
        }
      }

      case 'Edit': {
        const path = resolvePath(args.file_path);
        const guard = ensureWritablePath(path);
        if (guard) return guard;
        const releaseEdit = await editLock.acquire(path);
        try {
          if (!existsSync(path)) return { content: `Error: File not found: ${path}`, isError: true };
          let content = readFileSync(path, 'utf-8');
          if (!content.includes(args.old_string)) {
            return { content: `Error: Could not find the specified text in ${path}`, isError: true };
          }
          const occurrences = content.split(args.old_string).length - 1;
          if (occurrences > 1) {
            return {
              content: `Error: Found ${occurrences} matches in ${path}. Edit requires old_string to match exactly one location.`,
              isError: true,
            };
          }
          const oldContent = content;
          content = content.replace(args.old_string, args.new_string);
          writeFileSync(path, content, 'utf-8');
          diffTracker.record(path, oldContent, content);
          const diff = generateDiff(oldContent, content, path);
          return { content: `Successfully edited ${path}\n\n${diff}` };
        } finally {
          releaseEdit();
        }
      }

      case 'MultiEdit': {
        const path = resolvePath(args.file_path);
        const guard = ensureWritablePath(path);
        if (guard) return guard;
        const releaseMulti = await editLock.acquire(path);
        try {
          if (!existsSync(path)) return { content: `Error: File not found: ${path}`, isError: true };
          let content = readFileSync(path, 'utf-8');
          const oldContent = content;
          const edits: Array<{ old_string: string; new_string: string }> = args.edits || [];
          if (!Array.isArray(edits) || edits.length === 0) {
            return { content: 'Error: edits must be a non-empty array of {old_string, new_string}', isError: true };
          }
          const applied: number[] = [];
          const failed: string[] = [];
          for (let i = 0; i < edits.length; i++) {
            const { old_string, new_string } = edits[i];
            if (!old_string || new_string === undefined) {
              failed.push(`Edit #${i + 1}: missing old_string or new_string`);
              continue;
            }
            if (!content.includes(old_string)) {
              failed.push(`Edit #${i + 1}: text not found`);
              continue;
            }
            const occ = content.split(old_string).length - 1;
            if (occ > 1) {
              failed.push(`Edit #${i + 1}: ${occ} matches (ambiguous)`);
              continue;
            }
            content = content.replace(old_string, new_string);
            applied.push(i + 1);
          }
          writeFileSync(path, content, 'utf-8');
          diffTracker.record(path, oldContent, content);
          const diff = generateDiff(oldContent, content, path);
          const summary = `Applied ${applied.length}/${edits.length} edits to ${path}`;
          const failInfo = failed.length > 0 ? `\nFailed:\n${failed.join('\n')}` : '';
          return { content: `${summary}${failInfo}\n\n${diff}` };
        } finally {
          releaseMulti();
        }
      }

      case 'Bash': {
        const command = args.command;

        // Security: validate command before execution
        const blockReason = validateBashCommand(command);
        if (blockReason) {
          return { content: `Error: ${blockReason}. If you believe this is safe, add an allow rule to permissions.`, isError: true };
        }

        const timeout = clampTimeout(args.timeout);
        const { stdout, stderr } = await execAsync(command, {
          timeout,
          cwd: cwd(),
          env: { ...sanitizeEnv(process.env), FORCE_COLOR: '0', NO_COLOR: '1' },
        });
        let output = stdout;
        if (stderr) output += `\n${stderr}`;
        return { content: truncateOutput(output || '(no output)', 300) };
      }

      case 'Glob': {
        const files = await globby(args.pattern, { cwd: cwd(), gitignore: true });
        return { content: files.join('\n') || '(no matches)' };
      }

      case 'WebSearch': {
        const query = encodeURIComponent(args.query);
        const url = `https://duckduckgo.com/html/?q=${query}`;
        const resp = await fetch(url, {
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ClaudeCodeOpen/0.1)' },
        });
        const html = await resp.text();
        const snippets = html.match(/class="result__snippet"[^>]*>([^<]+)/g);
        if (snippets) {
          const texts = snippets.map((s) => s.replace(/<[^>]+>/g, '').trim()).slice(0, 5);
          return { content: texts.join('\n\n') };
        }
        return { content: 'No search results found.' };
      }

      case 'WebFetch': {
        // Security: SSRF protection
        const urlError = validateUrl(args.url);
        if (urlError) {
          return { content: `Error: ${urlError}`, isError: true };
        }

        const resp = await fetch(args.url, {
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ClaudeCodeOpen/0.1)' },
          redirect: 'follow',
          signal: AbortSignal.timeout(30000),
        });
        const text = await resp.text();
        const stripped = text
          .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
          .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        return { content: truncateOutput(stripped, 200) };
      }

      case 'NotebookRead': {
        const path = resolvePath(args.file_path);
        if (!existsSync(path)) return { content: `Error: File not found: ${path}`, isError: true };
        const nb = JSON.parse(readFileSync(path, 'utf-8'));
        const cells = nb.cells.map((c: any, i: number) => {
          const source = Array.isArray(c.source) ? c.source.join('') : c.source;
          return `[Cell ${i}] (${c.cell_type}):\n${source}`;
        });
        return { content: cells.join('\n\n---\n\n') };
      }

      case 'NotebookEdit': {
        const path = resolvePath(args.file_path);
        const guard = ensureWritablePath(path);
        if (guard) return guard;
        if (!existsSync(path)) return { content: `Error: File not found: ${path}`, isError: true };
        const nb = JSON.parse(readFileSync(path, 'utf-8'));
        if (args.cell_index >= nb.cells.length) {
          return { content: `Error: Cell index ${args.cell_index} out of range`, isError: true };
        }
        nb.cells[args.cell_index].source = args.new_source.split('\n');
        writeFileSync(path, JSON.stringify(nb, null, 2), 'utf-8');
        return { content: `Successfully updated cell ${args.cell_index} in ${path}` };
      }

      // Computer Use tools
      case 'ComputerScreenshot': {
        const result = await computerUse.screenshot();
        if (result.success && result.data) {
          return {
            content: `Screenshot taken. Image data: ${result.data.slice(0, 100)}... (base64 encoded, ${result.data.length} chars)`,
          };
        }
        return { content: `Error: ${result.error}`, isError: true };
      }

      case 'ComputerClick': {
        const result = await computerUse.click(args.x, args.y);
        return { content: result };
      }

      case 'ComputerType': {
        const result = await computerUse.type(args.text);
        return { content: result };
      }

      case 'ComputerKey': {
        const result = await computerUse.key(args.key);
        return { content: result };
      }

      case 'Grep': {
        const searchPath = args.path ? resolvePath(args.path) : cwd();
        if (!existsSync(searchPath)) return { content: `Error: Path not found: ${searchPath}`, isError: true };

        const contextLines = args.context_lines ?? 2;

        // Try system-level search first (rg > grep > JS fallback)
        const systemResult = await trySystemGrep(args.pattern, searchPath, args.include, contextLines, args.case_insensitive);
        if (systemResult !== null) {
          return systemResult;
        }

        // JS fallback
        const flags = args.case_insensitive ? 'gi' : 'g';
        let regex: RegExp;
        try {
          regex = new RegExp(args.pattern, flags);
        } catch (e: any) {
          return { content: `Error: Invalid regex pattern: ${e.message}`, isError: true };
        }

        let files: string[];
        if (statSync(searchPath).isFile()) {
          files = [searchPath];
        } else {
          const includePattern = args.include || '**/*';
          files = await globby(includePattern, {
            cwd: searchPath,
            gitignore: true,
            onlyFiles: true,
            absolute: true,
          });
        }

        const results: string[] = [];
        let totalMatches = 0;
        const maxResults = 50;

        for (const file of files) {
          if (totalMatches >= maxResults) break;
          try {
            const stat = statSync(file);
            if (stat.size > 1024 * 1024) continue;
            const content = readFileSync(file, 'utf-8');
            const lines = content.split('\n');

            for (let i = 0; i < lines.length; i++) {
              if (totalMatches >= maxResults) break;
              regex.lastIndex = 0;
              if (regex.test(lines[i])) {
                totalMatches++;
                const start = Math.max(0, i - contextLines);
                const end = Math.min(lines.length, i + contextLines + 1);
                const relFile = relative(cwd(), file) || file;
                const contextBlock = lines.slice(start, end).map((line, idx) => {
                  const lineNum = start + idx + 1;
                  const marker = start + idx === i ? '>' : ' ';
                  return `${marker} ${lineNum}: ${line.slice(0, 200)}`;
                }).join('\n');
                results.push(`${relFile}:${i + 1}\n${contextBlock}`);
              }
            }
          } catch {
            // skip unreadable files
          }
        }

        if (results.length === 0) {
          return { content: `No matches found for pattern: ${args.pattern}` };
        }
        const output = results.join('\n---\n');
        const truncated = totalMatches >= maxResults ? `\n\n... (${maxResults}+ matches, truncated)` : '';
        return { content: truncateOutput(output + truncated, 300) };
      }

      case 'LS': {
        const lsPath = args.path ? resolvePath(args.path) : cwd();
        if (!existsSync(lsPath)) return { content: `Error: Path not found: ${lsPath}`, isError: true };
        if (!statSync(lsPath).isDirectory()) return { content: `Error: Not a directory: ${lsPath}`, isError: true };

        const maxDepth = args.max_depth ?? 3;
        const entries: string[] = [];
        const maxEntries = 200;

        function listDir(dir: string, depth: number, prefix: string): void {
          if (entries.length >= maxEntries) return;
          if (depth > maxDepth) return;

          try {
            const items = readdirSync(dir, { withFileTypes: true })
              .filter((d) => !d.name.startsWith('.') || d.name === '.gitignore')
              .sort((a, b) => {
                if (a.isDirectory() && !b.isDirectory()) return -1;
                if (!a.isDirectory() && b.isDirectory()) return 1;
                return a.name.localeCompare(b.name);
              });

            for (const item of items) {
              if (entries.length >= maxEntries) break;
              const fullPath = join(dir, item.name);
              const relPath = relative(cwd(), fullPath) || fullPath;

              if (item.isDirectory()) {
                if (item.name === 'node_modules' || item.name === '.git' || item.name === 'dist') {
                  entries.push(`${prefix}${item.name}/ (skipped)`);
                  continue;
                }
                entries.push(`${prefix}${item.name}/`);
                if (args.recursive) {
                  listDir(fullPath, depth + 1, prefix + '  ');
                }
              } else {
                try {
                  const size = statSync(fullPath).size;
                  const sizeStr = size > 1024 ? `${(size / 1024).toFixed(1)} KB` : `${size} B`;
                  entries.push(`${prefix}${item.name} (${sizeStr})`);
                } catch {
                  entries.push(`${prefix}${item.name}`);
                }
              }
            }
          } catch {
            // skip unreadable dirs
          }
        }

        listDir(lsPath, 0, '');
        if (entries.length === 0) return { content: '(empty directory)' };
        const truncated = entries.length >= maxEntries ? `\n... (${maxEntries}+ entries, truncated)` : '';
        return { content: entries.join('\n') + truncated };
      }

      case 'TodoWrite': {
        // In-memory todo store managed via module-level variable
        const todos = args.todos || [];
        const merge = args.merge !== false;

        if (merge) {
          for (const todo of todos) {
            const existingIdx = todoStore.findIndex((t: any) => t.id === todo.id);
            if (existingIdx >= 0) {
              todoStore[existingIdx] = { ...todoStore[existingIdx], ...todo };
            } else {
              todoStore.push(todo);
            }
          }
        } else {
          todoStore.length = 0;
          todoStore.push(...todos);
        }

        const statusIcons: Record<string, string> = {
          PENDING: '○',
          IN_PROGRESS: '◐',
          COMPLETE: '✓',
          CANCELLED: '✗',
        };

        const lines = todoStore.map((t: any) => {
          const icon = statusIcons[t.status] || '○';
          return `  ${icon} [${t.id}] ${t.content} (${t.status})`;
        });

        const done = todoStore.filter((t: any) => t.status === 'COMPLETE').length;
        const total = todoStore.length;
        return { content: `Todo list updated: ${done}/${total} complete\n${lines.join('\n')}` };
      }

      default:
        return { content: `Error: Unknown tool: ${name}`, isError: true };
    }
  } catch (err: any) {
    return { content: `Error: ${err.message || String(err)}`, isError: true };
  }
}
