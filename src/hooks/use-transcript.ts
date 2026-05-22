import { useMemo } from 'react';
import type { DisplayMessage } from './use-agent-manager.js';

export interface TranscriptLine {
  text: string;
  color?: string;
  bold?: boolean;
  dim?: boolean;
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

export function wrapText(text: string, width: number): string[] {
  const maxWidth = Math.max(20, width);
  const physicalLines = text.split('\n');
  const wrapped: string[] = [];

  for (const line of physicalLines) {
    if (line.length === 0) {
      wrapped.push('');
      continue;
    }
    for (let i = 0; i < line.length; i += maxWidth) {
      wrapped.push(line.slice(i, i + maxWidth));
    }
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

/**
 * Basic terminal markdown: color code spans, bold headers, list markers.
 */
function markdownColor(line: string): { text: string; color?: string; bold?: boolean } {
  // Headers (## ...)
  const headerMatch = line.match(/^(#{1,3})\s+(.*)/);
  if (headerMatch) return { text: line, color: 'cyan', bold: true };
  // List markers (- item, * item, 1. item)
  if (/^\s*[-*]\s/.test(line) || /^\s*\d+\.\s/.test(line)) return { text: line, color: 'white' };
  // Inline code detection — we just return as-is (ink doesn't support inline spans easily)
  return { text: line };
}

function buildTranscriptLines(messages: DisplayMessage[], width: number): TranscriptLine[] {
  const contentWidth = Math.max(20, width - 6);
  const lines: TranscriptLine[] = [];

  for (const item of messages) {
    const { message, agentName } = item;
    if (message.role === 'system') continue;

    if (message.role === 'user') {
      lines.push({ text: `> ${message.content}`, color: 'blue', bold: true });
      lines.push({ text: '' });
      continue;
    }

    if (message.role === 'tool') {
      lines.push({
        text: `  Tool Result ${message.toolCallId ? `(${message.toolCallId.slice(0, 8)})` : ''}`,
        color: 'gray', dim: true,
      });
      const toolLines = wrapText(message.content.slice(0, 2000), contentWidth - 2);
      for (const line of toolLines) {
        const dc = diffLineColor(line.trimStart());
        lines.push({
          text: `  ${line}`,
          color: dc || 'gray',
          dim: !dc,
          bold: dc === 'cyan',
        });
      }
      lines.push({ text: '' });
      continue;
    }

    const parsed = parseThinking(message.content);
    lines.push({ text: agentName || 'Assistant', color: 'green', bold: true });
    if (parsed.thinking) {
      lines.push({ text: '  [thinking hidden]', color: 'gray', dim: true });
    }
    for (const line of wrapText(parsed.content || '', contentWidth - 2)) {
      const md = markdownColor(line);
      const dc = diffLineColor(line.trimStart());
      lines.push({
        text: `  ${md.text}`,
        color: dc || md.color,
        bold: md.bold,
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
