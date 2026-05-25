/**
 * Track all file edits during a session for multi-file diff summary.
 */
export interface FileDiff {
  filePath: string;
  oldContent: string;
  newContent: string;
  timestamp: number;
}

class DiffTracker {
  private diffs: FileDiff[] = [];

  /** Record a file edit */
  record(filePath: string, oldContent: string, newContent: string): void {
    // If same file edited multiple times, keep the original old content
    const existing = this.diffs.find((d) => d.filePath === filePath);
    if (existing) {
      existing.newContent = newContent;
      existing.timestamp = Date.now();
    } else {
      this.diffs.push({ filePath, oldContent, newContent, timestamp: Date.now() });
    }
  }

  /** Get all recorded diffs */
  getAll(): FileDiff[] {
    return [...this.diffs];
  }

  /** Get count of modified files */
  get fileCount(): number {
    return this.diffs.length;
  }

  /** Pop the last recorded diff (for undo). Returns the diff or null. */
  pop(): FileDiff | null {
    return this.diffs.pop() || null;
  }

  /** Get the last diff without removing it (for preview). */
  peek(): FileDiff | null {
    return this.diffs.length > 0 ? this.diffs[this.diffs.length - 1] : null;
  }

  /** Generate a summary string for /diff command */
  summary(): string {
    if (this.diffs.length === 0) return '本次会话未修改任何文件。';

    const lines: string[] = [`本次会话修改了 ${this.diffs.length} 个文件:\n`];
    for (const diff of this.diffs) {
      const oldLines = diff.oldContent.split('\n').length;
      const newLines = diff.newContent.split('\n').length;
      const delta = newLines - oldLines;
      const sign = delta >= 0 ? '+' : '';
      lines.push(`  📄 ${diff.filePath}  (${oldLines} → ${newLines} lines, ${sign}${delta})`);
    }
    return lines.join('\n');
  }

  /** Clear all diffs (e.g. on session clear) */
  clear(): void {
    this.diffs.length = 0;
  }
}

export const diffTracker = new DiffTracker();
