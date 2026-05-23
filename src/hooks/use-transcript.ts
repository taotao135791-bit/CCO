import { useMemo } from 'react';
import type { DisplayMessage } from './use-agent-manager.js';

export interface TranscriptLine {
  text: string;
  color?: string;
  bold?: boolean;
  dim?: boolean;
  italic?: boolean;
}

export function parseThinking(content: string): { thinking?: string; content: string } {
  const match = content.match(/<(thinking|think)>([\s\S]*?)<\/(thinking|think)>/);
  if (match) {
    return {
      thinking: match[2].trim(),
      content: content.replace(/<(thinking|think)>[\s\S]*?<\/(thinking|think)>/, '').trim(),
    };
  }
  return { content };
}

/** Estimate display width accounting for wide (CJK) characters */
function displayWidth(str: string): number {
  let w = 0;
  for (const ch of str) {
    const code = ch.codePointAt(0) || 0;
    if (
      (code >= 0x1100 && code <= 0x115F) ||
      code === 0x2329 || code === 0x232A ||
      (code >= 0x2E80 && code <= 0x303E) ||
      (code >= 0x3040 && code <= 0x33BF) ||
      (code >= 0x3400 && code <= 0x4DBF) ||
      (code >= 0x4E00 && code <= 0xA4CF) ||
      (code >= 0xA960 && code <= 0xA97C) ||
      (code >= 0xAC00 && code <= 0xD7A3) ||
      (code >= 0xF900 && code <= 0xFAFF) ||
      (code >= 0xFE10 && code <= 0xFE6F) ||
      (code >= 0xFF01 && code <= 0xFF60) ||
      (code >= 0xFFE0 && code <= 0xFFE6) ||
      (code >= 0x1F300 && code <= 0x1F9FF) ||
      (code >= 0x20000 && code <= 0x2FFFF)
    ) {
      w += 2;
    } else {
      w += 1;
    }
  }
  return w;
}

export function wrapText(text: string, width: number): string[] {
  const maxWidth = Math.max(20, width);
  const physicalLines = text.split('\n');
  const wrapped: string[] = [];

  for (const line of physicalLines) {
    if (line.length === 0) {
      wrapped.push('');
      continue;
    }
    // Column-aware wrapping for wide characters (CJK = 2 cols)
    let current = '';
    let currentW = 0;
    for (const ch of line) {
      const chW = displayWidth(ch);
      if (currentW + chW > maxWidth && current.length > 0) {
        wrapped.push(current);
        current = ch;
        currentW = chW;
      } else {
        current += ch;
        currentW += chW;
      }
    }
    if (current.length > 0) wrapped.push(current);
  }

  return wrapped;
}

/**
 * Detect if a line is part of a unified diff and return its color.
 */
function diffLineColor(line: string): string | undefined {
  if (line.startsWith('+') && !line.startsWith('+++')) return 'green';
  if (line.startsWith('-') && !line.startsWith('---')) return 'red';
  if (line.startsWith('@@')) return 'cyan';
  if (line.startsWith('---') || line.startsWith('+++')) return 'yellow';
  return undefined;
}

/** Max tool result lines shown before collapsing */
const TOOL_COLLAPSE_THRESHOLD = 15;
const TOOL_COLLAPSE_PREVIEW = 5;

/**
 * Enhanced markdown: code blocks, inline code, headers, lists, bold/italic.
 * Returns styled line info.
 */
function markdownColor(line: string): { text: string; color?: string; bold?: boolean; italic?: boolean } {
  // Headers (## ...)
  const headerMatch = line.match(/^(#{1,3})\s+(.*)/);
  if (headerMatch) return { text: `  ${line}`, color: 'cyan', bold: true };
  // Bold text **...**
  if (/\*\*[^*]+\*\*/.test(line)) return { text: line, bold: true };
  // Italic *...*
  if (/^\s*\*[^*]+\*\s*$/.test(line)) return { text: line, italic: true };
  // List markers (- item, * item, 1. item)
  if (/^\s*[-*]\s/.test(line) || /^\s*\d+\.\s/.test(line)) return { text: line, color: 'white' };
  return { text: line };
}

function buildTranscriptLines(messages: DisplayMessage[], width: number): TranscriptLine[] {
  const contentWidth = Math.max(20, width - 8); // extra margin for scrollbar + padding
  const lines: TranscriptLine[] = [];

  for (const item of messages) {
    const { message, agentName } = item;
    if (message.role === 'system') continue;

    if (message.role === 'user') {
      const userContent = message.content.length > 500
        ? message.content.slice(0, 500) + '...'
        : message.content;
      const wrappedLines = wrapText(userContent, contentWidth - 2);
      lines.push({ text: `❯ ${wrappedLines[0] || ''}`, color: 'blue', bold: true });
      for (let i = 1; i < wrappedLines.length; i++) {
        lines.push({ text: `  ${wrappedLines[i]}`, color: 'blue' });
      }
      lines.push({ text: '' });
      continue;
    }

    if (message.role === 'tool') {
      const rawLines = wrapText(message.content.slice(0, 4000), contentWidth - 2);
      const isLong = rawLines.length > TOOL_COLLAPSE_THRESHOLD;
      const toolLabel = message.toolCallId ? `(${message.toolCallId.slice(0, 8)})` : '';

      if (isLong) {
        // Collapsed: show first N lines + expand hint
        lines.push({
          text: `  ▸ Tool Result ${toolLabel} [${rawLines.length} lines — scroll to expand]`,
          color: 'yellow', dim: true,
        });
        for (const line of rawLines.slice(0, TOOL_COLLAPSE_PREVIEW)) {
          const dc = diffLineColor(line.trimStart());
          lines.push({ text: `  ${line}`, color: dc || 'gray', dim: !dc, bold: dc === 'cyan' });
        }
        lines.push({ text: `    ... (${rawLines.length - TOOL_COLLAPSE_PREVIEW} more lines)`, color: 'gray', dim: true });
      } else {
        lines.push({
          text: `  Tool Result ${toolLabel}`,
          color: 'gray', dim: true,
        });
        for (const line of rawLines) {
          const dc = diffLineColor(line.trimStart());
          lines.push({ text: `  ${line}`, color: dc || 'gray', dim: !dc, bold: dc === 'cyan' });
        }
      }
      lines.push({ text: '' });
      continue;
    }

    const parsed = parseThinking(message.content);
    lines.push({ text: agentName || 'Assistant', color: 'green', bold: true });
    if (parsed.thinking) {
      lines.push({ text: '  [thinking hidden]', color: 'gray', dim: true });
    }
    // Track code block state across lines
    let inCodeBlock = false;
    let codeBlockLang = '';
    for (const rawLine of wrapText(parsed.content || '', contentWidth - 2)) {
      // Code fence detection (``` or ~~~)
      const fenceMatch = rawLine.trimStart().match(/^(`{3,}|~{3,})\s*(\w*)/);
      if (fenceMatch) {
        if (!inCodeBlock) {
          inCodeBlock = true;
          codeBlockLang = fenceMatch[2] || '';
          lines.push({
            text: `  ┌─${codeBlockLang ? ` ${codeBlockLang} ` : ''}${'─'.repeat(Math.max(0, contentWidth - codeBlockLang.length - 8))}┐`,
            color: 'magenta', dim: true,
          });
        } else {
          inCodeBlock = false;
          codeBlockLang = '';
          lines.push({
            text: `  └${'─'.repeat(Math.max(0, contentWidth - 4))}┘`,
            color: 'magenta', dim: true,
          });
        }
        continue;
      }

      if (inCodeBlock) {
        // Code block content — dimmed background feel
        lines.push({ text: `  │ ${rawLine}`, color: 'magenta', dim: false });
        continue;
      }

      const dc = diffLineColor(rawLine.trimStart());
      const md = markdownColor(rawLine);
      // Inline code highlighting: `code`
      const hasInlineCode = /`[^`]+`/.test(rawLine);
      lines.push({
        text: `  ${md.text}`,
        color: dc || md.color || (hasInlineCode ? 'yellow' : undefined),
        bold: md.bold,
        italic: md.italic,
      });
    }
    if (message.toolCalls?.length) {
      for (const toolCall of message.toolCalls) {
        const args = toolCall.function.arguments;
        lines.push({
          text: `  ● ${toolCall.function.name}(${args.slice(0, 90)}${args.length > 90 ? '...' : ''})`,
          color: 'yellow', dim: true,
        });
      }
    }
    lines.push({ text: '' });
  }

  return lines.length ? lines : [{ text: '' }];
}

/**
 * Hook to compute transcript lines from display messages.
 */
export function useTranscript(messages: DisplayMessage[], width: number) {
  const transcriptLines = useMemo(
    () => buildTranscriptLines(messages, width),
    [messages, width],
  );
  return { transcriptLines };
}
