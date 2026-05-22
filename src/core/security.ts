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

  // Dangerous eval/exec
  /\beval\s+/,
  /\bexec\s+/,

  // System-level operations
  /\bmkfs\b/,
  /\bdd\s+.*of=\/dev\//,
  /\bshutdown\b/,
  /\breboot\b/,
  /\binit\s+[06]\b/,

  // Fork bombs
  /:\(\)\s*\{\s*:\|:\s*&\s*\}\s*;/,

  // Credential theft
  /\bcat\b.*\b\.ssh\b/,
  /\bcat\b.*\b\.aws\b/,
  /\bcat\b.*\b\.env\b/,
];

// Normalize a command string for pattern matching
// Strips absolute paths from commands: /bin/rm -> rm, /usr/bin/curl -> curl
function normalizeCommand(cmd: string): string {
  return cmd
    .replace(/\/(?:usr\/)?(?:local\/)?(?:s?bin)\//g, '')
    .replace(/\s+/g, ' ')
    .trim();
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
