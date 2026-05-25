/**
 * Post-edit lint/typecheck runner.
 * Detects project type and runs the appropriate linter after file edits.
 * Results are appended to tool output as warnings (non-blocking).
 */
import { existsSync, readFileSync } from 'fs';
import { execSync } from 'child_process';
import { dirname, join, extname } from 'path';
import { cwd } from 'process';

export interface LintResult {
  command: string;
  success: boolean;
  output: string;
}

const LINT_TIMEOUT_MS = 10_000;

interface ProjectLintConfig {
  command: string;
  label: string;
}

/**
 * Detect the lint/typecheck command for the current project.
 * Looks for config files in order of specificity.
 */
function detectLintCommand(filePath: string): ProjectLintConfig | null {
  const ext = extname(filePath).toLowerCase();
  const root = findProjectRoot(filePath);

  // TypeScript / JavaScript projects
  if (['.ts', '.tsx', '.js', '.jsx', '.mts', '.mjs'].includes(ext)) {
    const pkgPath = join(root, 'package.json');
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
        // Prefer explicit lint script
        if (pkg.scripts?.lint) {
          return { command: 'npm run lint', label: 'npm run lint' };
        }
        // Fallback: try tsc --noEmit if typescript is a dep
        if (pkg.devDependencies?.typescript || pkg.dependencies?.typescript) {
          return { command: 'npx tsc --noEmit', label: 'tsc --noEmit' };
        }
      } catch { /* ignore parse errors */ }
    }
    // tsconfig.json without package.json
    if (existsSync(join(root, 'tsconfig.json'))) {
      return { command: 'npx tsc --noEmit', label: 'tsc --noEmit' };
    }
  }

  // Python projects
  if (['.py', '.pyi'].includes(ext)) {
    if (existsSync(join(root, 'pyproject.toml'))) {
      const content = readFileSync(join(root, 'pyproject.toml'), 'utf-8');
      if (content.includes('[tool.ruff]')) {
        return { command: 'ruff check .', label: 'ruff check' };
      }
    }
    if (existsSync(join(root, 'setup.cfg')) || existsSync(join(root, '.flake8'))) {
      return { command: 'flake8 .', label: 'flake8' };
    }
  }

  // Rust projects
  if (ext === '.rs') {
    if (existsSync(join(root, 'Cargo.toml'))) {
      return { command: 'cargo check 2>&1', label: 'cargo check' };
    }
  }

  // Go projects
  if (ext === '.go') {
    if (existsSync(join(root, 'go.mod'))) {
      return { command: 'go vet ./...', label: 'go vet' };
    }
  }

  return null;
}

/**
 * Walk up from filePath to find the project root (nearest config file).
 */
function findProjectRoot(filePath: string): string {
  const markers = [
    'package.json', 'tsconfig.json', 'pyproject.toml', 'Cargo.toml',
    'go.mod', '.git', 'setup.py', 'setup.cfg',
  ];
  let dir = dirname(filePath);
  const root = '/';
  while (dir !== root) {
    for (const marker of markers) {
      if (existsSync(join(dir, marker))) return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return cwd();
}

/**
 * Run lint check after a file edit.
 * Returns null if no linter is configured, or a LintResult.
 */
export function runPostEditLint(filePath: string): LintResult | null {
  const config = detectLintCommand(filePath);
  if (!config) return null;

  try {
    const stdout = execSync(config.command, {
      timeout: LINT_TIMEOUT_MS,
      cwd: findProjectRoot(filePath),
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
    });
    return { command: config.label, success: true, output: stdout.trim() };
  } catch (err: any) {
    const output = (err.stdout || '') + (err.stderr || '');
    return { command: config.label, success: false, output: output.trim().slice(0, 2000) };
  }
}

/**
 * Format a lint result as a warning string to append to tool output.
 */
export function formatLintWarning(result: LintResult): string {
  if (result.success) {
    return `\n\n[Lint: ${result.command} ✓ passed]`;
  }
  const preview = result.output ? `\n${result.output.slice(0, 1000)}` : '';
  return `\n\n[Lint: ${result.command} ✗ issues found]${preview}`;
}
