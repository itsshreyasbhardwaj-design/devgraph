'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Minimal Markdown renderer.
 *
 * Renders to React elements rather than an HTML string, so model-authored text
 * can never inject markup — there is no `dangerouslySetInnerHTML` anywhere in
 * this path. Supports exactly the subset DevGraph emits: level-3 headings,
 * bullet lists, tables, blockquotes, paragraphs, bold, inline code and links.
 *
 * Anything outside that subset renders as literal text, which is the correct
 * failure mode for a renderer handling untrusted input.
 */

export interface MarkdownProps {
  content: string;
  className?: string;
  /** Called when an inline code span matches a known file path. */
  onFileClick?: (path: string) => void;
  /** Paths that should render as clickable references. */
  knownPaths?: Set<string>;
}

export function Markdown({ content, className, onFileClick, knownPaths }: MarkdownProps) {
  const blocks = React.useMemo(() => parseBlocks(content), [content]);

  return (
    <div className={cn('prose-devgraph', className)}>
      {blocks.map((block, index) => (
        <Block key={index} block={block} onFileClick={onFileClick} knownPaths={knownPaths} />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Block parsing
// ---------------------------------------------------------------------------

type Block =
  | { type: 'heading'; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'list'; items: string[] }
  | { type: 'quote'; text: string }
  | { type: 'table'; header: string[]; rows: string[][] }
  | { type: 'code'; text: string };

function parseBlocks(source: string): Block[] {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const blocks: Block[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();

    if (!trimmed) {
      index += 1;
      continue;
    }

    // Fenced code.
    if (trimmed.startsWith('```')) {
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].trim().startsWith('```')) {
        body.push(lines[index]);
        index += 1;
      }
      index += 1;
      blocks.push({ type: 'code', text: body.join('\n') });
      continue;
    }

    // Headings — every level renders at the same visual weight.
    const heading = /^#{1,6}\s+(.*)$/.exec(trimmed);
    if (heading) {
      blocks.push({ type: 'heading', text: heading[1] });
      index += 1;
      continue;
    }

    // Table: a header row followed by a separator row.
    if (trimmed.startsWith('|') && lines[index + 1]?.trim().startsWith('|')) {
      const separator = lines[index + 1].trim();
      if (/^\|[\s:|-]+\|$/.test(separator)) {
        const header = splitRow(trimmed);
        const rows: string[][] = [];
        index += 2;
        while (index < lines.length && lines[index].trim().startsWith('|')) {
          rows.push(splitRow(lines[index].trim()));
          index += 1;
        }
        blocks.push({ type: 'table', header, rows });
        continue;
      }
    }

    // Bullet list.
    if (/^[-*+]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (index < lines.length && /^\s*[-*+]\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\s*[-*+]\s+/, ''));
        index += 1;
        // Fold hanging continuation lines into the current item.
        while (index < lines.length && /^\s{2,}\S/.test(lines[index]) && !/^\s*[-*+]\s/.test(lines[index])) {
          items[items.length - 1] += ` ${lines[index].trim()}`;
          index += 1;
        }
      }
      blocks.push({ type: 'list', items });
      continue;
    }

    // Blockquote.
    if (trimmed.startsWith('>')) {
      const body: string[] = [];
      while (index < lines.length && lines[index].trim().startsWith('>')) {
        body.push(lines[index].trim().replace(/^>\s?/, ''));
        index += 1;
      }
      blocks.push({ type: 'quote', text: body.join(' ') });
      continue;
    }

    // Paragraph: consume until a blank line or the start of another block.
    const paragraph: string[] = [];
    while (index < lines.length) {
      const current = lines[index].trim();
      if (!current) break;
      if (/^([-*+]\s|>|#{1,6}\s|\|)/.test(current) || current.startsWith('```')) break;
      paragraph.push(current);
      index += 1;
    }
    if (paragraph.length) blocks.push({ type: 'paragraph', text: paragraph.join(' ') });
  }

  return blocks;
}

function splitRow(row: string): string[] {
  return row
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

interface RenderProps {
  onFileClick?: (path: string) => void;
  knownPaths?: Set<string>;
}

function Block({ block, ...rest }: { block: Block } & RenderProps) {
  switch (block.type) {
    case 'heading':
      return (
        <h3>
          <Inline text={block.text} {...rest} />
        </h3>
      );
    case 'paragraph':
      return (
        <p>
          <Inline text={block.text} {...rest} />
        </p>
      );
    case 'list':
      return (
        <ul>
          {block.items.map((item, index) => (
            <li key={index}>
              <Inline text={item} {...rest} />
            </li>
          ))}
        </ul>
      );
    case 'quote':
      return (
        <blockquote>
          <Inline text={block.text} {...rest} />
        </blockquote>
      );
    case 'code':
      return (
        <pre className="my-3 overflow-x-auto rounded-md border border-line bg-pit p-3">
          <code className="tabular text-[12px] text-ink-muted">{block.text}</code>
        </pre>
      );
    case 'table':
      return (
        <div className="overflow-x-auto">
          <table>
            <thead>
              <tr>
                {block.header.map((cell, index) => (
                  <th key={index}>
                    <Inline text={cell} {...rest} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex}>
                      <Inline text={cell} {...rest} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
  }
}

/**
 * Inline formatting. The tokenizer walks the string once and emits React nodes;
 * unmatched syntax falls through as plain text.
 */
function Inline({ text, onFileClick, knownPaths }: { text: string } & RenderProps) {
  const nodes: React.ReactNode[] = [];
  const pattern = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\[[^\]]+\]\([^)]+\))|(\*[^*]+\*)/g;
  let cursor = 0;
  let key = 0;
  let match = pattern.exec(text);

  while (match !== null) {
    if (match.index > cursor) nodes.push(text.slice(cursor, match.index));

    const token = match[0];
    if (token.startsWith('`')) {
      const value = token.slice(1, -1);
      const path = value.split(':')[0];
      const clickable = onFileClick && knownPaths?.has(path);
      nodes.push(
        clickable ? (
          <button
            key={key}
            type="button"
            onClick={() => onFileClick(path)}
            className="cursor-pointer border-b border-dotted border-edge/40 transition-colors hover:border-edge"
            title={`Show ${path} in the graph`}
          >
            <code>{value}</code>
          </button>
        ) : (
          <code key={key}>{value}</code>
        ),
      );
    } else if (token.startsWith('**')) {
      nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith('[')) {
      const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token);
      if (link && /^https?:\/\//.test(link[2])) {
        nodes.push(
          <a key={key} href={link[2]} target="_blank" rel="noreferrer noopener">
            {link[1]}
          </a>,
        );
      } else {
        nodes.push(link ? link[1] : token);
      }
    } else {
      nodes.push(<em key={key}>{token.slice(1, -1)}</em>);
    }

    cursor = match.index + token.length;
    key += 1;
    match = pattern.exec(text);
  }

  if (cursor < text.length) nodes.push(text.slice(cursor));
  return <>{nodes}</>;
}
