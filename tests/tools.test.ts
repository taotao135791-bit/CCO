import { describe, it, expect } from 'vitest';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { executeTool } from '../src/core/tools/executor.js';

const TMP_DIR = join(process.cwd(), '.tmp-tests');

describe('Tools', () => {
  it('Read should read a file', async () => {
    const result = await executeTool('Read', { file_path: 'package.json' });
    expect(result.isError).toBeFalsy();
    expect(result.content).toContain('claude-code-open');
  });

  it('Glob should find files', async () => {
    const result = await executeTool('Glob', { pattern: 'src/**/*.ts' });
    expect(result.isError).toBeFalsy();
    expect(result.content.length).toBeGreaterThan(0);
  });

  it('Edit should fail if file not found', async () => {
    const result = await executeTool('Edit', {
      file_path: 'nonexistent.ts',
      old_string: 'foo',
      new_string: 'bar',
    });
    expect(result.isError).toBeTruthy();
  });

  it('Write should create parent directories inside the workspace', async () => {
    const filePath = join('.tmp-tests', 'nested', 'created.txt');
    rmSync(TMP_DIR, { recursive: true, force: true });

    const result = await executeTool('Write', {
      file_path: filePath,
      content: 'hello',
    });

    expect(result.isError).toBeFalsy();
    expect(readFileSync(filePath, 'utf-8')).toBe('hello');
    rmSync(TMP_DIR, { recursive: true, force: true });
  });

  it('Write should refuse paths outside the workspace', async () => {
    const result = await executeTool('Write', {
      file_path: '../cco-outside-write-test.txt',
      content: 'nope',
    });

    expect(result.isError).toBeTruthy();
    expect(result.content).toContain('outside the current workspace');
  });

  it('Edit should require old_string to match exactly one location', async () => {
    mkdirSync(TMP_DIR, { recursive: true });
    const filePath = join(TMP_DIR, 'duplicate.txt');
    writeFileSync(filePath, 'same\nsame\n', 'utf-8');

    const result = await executeTool('Edit', {
      file_path: filePath,
      old_string: 'same',
      new_string: 'changed',
    });

    expect(result.isError).toBeTruthy();
    expect(result.content).toContain('matches');
    expect(readFileSync(filePath, 'utf-8')).toBe('same\nsame\n');
    rmSync(TMP_DIR, { recursive: true, force: true });
  });
});
