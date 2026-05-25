/**
 * Security utilities for command validation, URL checking, and path safety.
 */

// Patterns that indicate dangerous bash commands — checked after normalization
const DANGEROUS_PATTERNS: RegExp[] = [
  // Destructive file operations
  /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f|(-\S+\s+)*-[a-zA-Z]*r[a-zA-Z]*\s+-[a-zA-Z]*f)/,  // rm -rf, rm -r -f
  /\brm\s+(-[a-zA-Z]*f[a-zA-Z]*r|(-\S+\s+)*-[a-zA-Z]*f[a-zA-Z]*\s+-[a-zA-Z]*r)/,  // rm -fr, rm -f -r
  /\brm\s+-[a-zA-Z]*\s+\//,              // rm -anything /absolute
  /\bchmod\s+777\b/,
  /\bchmod\s+\+s\b/,
  /\bchown\s+root\b/,

  // Remote code execution
  /\bcurl\b.*\|\s*(bash|sh|zsh|node|python|perl|ruby)\b/,
  /\bwget\b.*\|\s*(bash|sh|zsh|node|python|perl|ruby)\b/,
  /\bcurl\b.*-o\s*-\s*\|\s*\S/,
  /\bsudo\b/,

  // Dangerous eval
  /\beval\s+/,

  // Inline code execution via interpreters
  /\bpython3?\s+-c\s+/,
  /\bnode\s+-e\s+/,
  /\bperl\s+-e\s+/,
  /\bruby\s+-e\s+/,

  // Base64 decode piping (encoding bypass)
  /\bbase64\s+(-d|--decode)\b.*\|\s*(bash|sh|zsh|node|python|perl|ruby)\b/,
  /\|\s*base64\s+(-d|--decode)\b.*\|\s*(bash|sh|zsh)\b/,

  // Heredoc execution with shell
  /<<\s*['"]?(EOF|SHELL|BASH)['"]?.*\|\s*(bash|sh|zsh)\b/,

  // Environment variable exfiltration
  /\b(printenv|env)\s*(\|\s*(grep|cat|head|tail|sort|awk|sed))?\s*$/,
  /\bset\s*\|\s*grep\b/,
  /\bdeclare\s+-p\b/,

  // System-level operations
  /\bmkfs\b/,
  /\bdd\s+.*of=\/dev\//,
  /\bshutdown\b/,
  /\breboot\b/,
  /\binit\s+[06]\b/,

  // Fork bombs
  /:\(\)\s*\{\s*:\|:\s*&\s*\}\s*;/,

  // Credential theft
  /\bcat\b.*\.ssh\b/,
  /\bcat\b.*\.aws\b/,
  /\bcat\b.*\.env\b/,
  /\bcat\b.*\.npmrc\b/,
  /\bcat\b.*\.pypirc\b/,
];

// Normalize a command string for pattern matching
// Strips absolute paths from commands: /bin/rm -> rm, /usr/bin/curl -> curl
// Also expands $() and backtick subshells for deeper inspection
function normalizeCommand(cmd: string): string {
  let normalized = cmd
    .replace(/\/(?:usr\/)?(?:local\/)?(?:s?bin)\//g, '')
    .replace(/\s+/g, ' ')
    .trim();

  // Expand $() subshell references to expose nested commands
  // e.g., "echo $(python3 -c 'import os')" -> "echo  python3 -c 'import os'"
  normalized = normalized.replace(/\$\(([^)]+)\)/g, '$1');

  // Expand backtick subshell references
  // e.g., "echo `python3 -c 'import os'`" -> "echo  python3 -c 'import os'"
  normalized = normalized.replace(/`([^`]+)`/g, '$1');

  return normalized;
}

/**
 * Check if a bash command is potentially dangerous.
 * Returns null if safe, or a reason string if blocked.
 */
export function validateBashCommand(command: string): string | null {
  const normalized = normalizeCommand(command);

  // Check each segment of piped commands
  const segments = normalized.split('|');
  for (const segment of segments) {
    const trimmed = segment.trim();
    for (const pattern of DANGEROUS_PATTERNS) {
      if (pattern.test(trimmed)) {
        return `Blocked: command matches dangerous pattern (${pattern.source})`;
      }
    }
  }

  // Also check the full normalized command (for patterns spanning pipes)
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(normalized)) {
      return `Blocked: command matches dangerous pattern (${pattern.source})`;
    }
  }

  return null;
}

// Private/reserved IP ranges for SSRF protection
const PRIVATE_IP_PATTERNS: RegExp[] = [
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2[0-9]|3[01])\./,
  /^192\.168\./,
  /^169\.254\./,
  /^0\.0\.0\.0$/,
  /^::1$/,
  /^fe80:/i,
  /^fc00:/i,
  /^fd/i,
  /^localhost$/i,
  /^metadata\.google\.internal$/i,
];

/**
 * Validate a URL to prevent SSRF attacks.
 * Returns null if safe, or a reason string if blocked.
 */
export function validateUrl(urlString: string): string | null {
  let url: URL;
  try {
    url = new URL(urlString);
  } catch {
    return 'Blocked: invalid URL';
  }

  // Only allow http and https
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return `Blocked: protocol '${url.protocol}' not allowed (only http/https)`;
  }

  const hostname = url.hostname;

  // Check against private IP ranges
  for (const pattern of PRIVATE_IP_PATTERNS) {
    if (pattern.test(hostname)) {
      return `Blocked: hostname '${hostname}' resolves to a private/reserved address`;
    }
  }

  // Block obvious metadata endpoints
  if (hostname.includes('metadata') || hostname.includes('169.254')) {
    return `Blocked: potential metadata endpoint`;
  }

  return null;
}

/** Maximum allowed timeout for Bash commands (120 seconds) */
export const MAX_BASH_TIMEOUT_MS = 120_000;

/**
 * Clamp a timeout value to the maximum allowed.
 */
export function clampTimeout(timeout: number | undefined): number {
  const t = timeout ?? 30000;
  return Math.min(Math.max(t, 1000), MAX_BASH_TIMEOUT_MS);
}
