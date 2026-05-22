import { describe, it, expect } from 'vitest';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { executeTool } from '../src/core/tools/executor.js';
import { editLock } from '../src/core/tools/edit-lock.js';

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

  it('MultiEdit should apply multiple edits in one call', async () => {
    mkdirSync(TMP_DIR, { recursive: true });
    const filePath = join(TMP_DIR, 'multi.txt');
    writeFileSync(filePath, 'hello world\nfoo bar\nbaz qux\n', 'utf-8');

    const result = await executeTool('MultiEdit', {
      file_path: filePath,
      edits: [
        { old_string: 'hello', new_string: 'hi' },
        { old_string: 'foo', new_string: 'baz' },
      ],
    });

    expect(result.isError).toBeFalsy();
    expect(result.content).toContain('Applied 2/2');
    const content = readFileSync(filePath, 'utf-8');
    expect(content).toContain('hi world');
    expect(content).toContain('baz bar');
    rmSync(TMP_DIR, { recursive: true, force: true });
  });

  it('MultiEdit should report partial failures', async () => {
    mkdirSync(TMP_DIR, { recursive: true });
    const filePath = join(TMP_DIR, 'partial.txt');
    writeFileSync(filePath, 'only this line\n', 'utf-8');

    const result = await executeTool('MultiEdit', {
      file_path: filePath,
      edits: [
        { old_string: 'only this line', new_string: 'replaced' },
        { old_string: 'nonexistent', new_string: 'nope' },
      ],
    });

    expect(result.content).toContain('Applied 1/2');
    expect(result.content).toContain('Failed');
    rmSync(TMP_DIR, { recursive: true, force: true });
  });

  it('Edit should produce a unified diff in result', async () => {
    mkdirSync(TMP_DIR, { recursive: true });
    const filePath = join(TMP_DIR, 'diff-test.txt');
    writeFileSync(filePath, 'line1\nline2\nline3\n', 'utf-8');

    const result = await executeTool('Edit', {
      file_path: filePath,
      old_string: 'line2',
      new_string: 'LINE_TWO',
    });

    expect(result.isError).toBeFalsy();
    expect(result.content).toContain('---');
    expect(result.content).toContain('+++');
    expect(result.content).toContain('-line2');
    expect(result.content).toContain('+LINE_TWO');
    rmSync(TMP_DIR, { recursive: true, force: true });
  });
});

describe('EditLock', () => {
  it('should acquire and release a lock', async () => {
    const release = await editLock.acquire('/tmp/test-lock-file');
    expect(editLock.isLocked('/tmp/test-lock-file')).toBe(true);
    release();
    expect(editLock.isLocked('/tmp/test-lock-file')).toBe(false);
  });

  it('should serialize concurrent edits on the same file', async () => {
    const order: number[] = [];
    const release1 = await editLock.acquire('/tmp/serial-lock');

    const p2 = (async () => {
      const release2 = await editLock.acquire('/tmp/serial-lock');
      order.push(2);
      release2();
    })();

    order.push(1);
    // Give p2 a chance to start waiting
    await new Promise((r) => setTimeout(r, 50));
    release1();
    await p2;

    expect(order).toEqual([1, 2]);
  });
});
