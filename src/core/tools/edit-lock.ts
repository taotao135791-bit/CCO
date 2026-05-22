/**
 * File-level mutex lock to prevent concurrent edits by multiple agents.
 * Ensures only one Edit/MultiEdit/Write operates on a file at a time.
 */
class EditLockManager {
  private locks = new Map<string, Promise<void>>();

  /**
   * Acquire a lock on a file path. Returns a release function.
   * If the file is already locked, waits for the previous lock to release.
   */
  async acquire(filePath: string): Promise<() => void> {
    const normalizedPath = filePath;
    const existing = this.locks.get(normalizedPath);

    let releaseFn!: () => void;
    const newLock = new Promise<void>((resolve) => {
      releaseFn = () => {
        this.locks.delete(normalizedPath);
        resolve();
      };
    });

    if (existing) {
      // Wait for the existing lock to finish, with a timeout
      await Promise.race([
        existing,
        new Promise((resolve) => setTimeout(resolve, 10000)), // 10s timeout
      ]);
    }

    this.locks.set(normalizedPath, newLock);
    return releaseFn;
  }

  /** Check if a file is currently locked */
  isLocked(filePath: string): boolean {
    return this.locks.has(filePath);
  }

  /** Get count of active locks */
  get activeLocks(): number {
    return this.locks.size;
  }
}

export const editLock = new EditLockManager();
