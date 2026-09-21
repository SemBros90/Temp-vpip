/** Minimal, dependency-free Markdown renderer for AI output. */
import type { JSX } from "react";

function inline(text: string) {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return escaped
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>")
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
}

export function Markdown({ source, className = "" }: { source: string; className?: string }) {
  const lines = source.split("\n");
  const out: JSX.Element[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i] ?? "";

    if (line.trim().startsWith("```")) {
      const lang = line.trim().slice(3);
      const buf: string[] = [];
      i++;
      while (i < lines.length && !(lines[i] ?? "").trim().startsWith("```")) {
        buf.push(lines[i] ?? "");
        i++;
      }
      i++;
      out.push(
        <pre key={key++}>
          <code data-lang={lang}>{buf.join("\n")}</code>
        </pre>,
      );
      continue;
    }

    if (/^\|.*\|\s*$/.test(line) && /^\|[\s:-]+\|\s*$/.test(lines[i + 1] ?? "")) {
      const header = line.split("|").slice(1, -1).map((c) => c.trim());
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && /^\|.*\|\s*$/.test(lines[i] ?? "")) {
        rows.push((lines[i] ?? "").split("|").slice(1, -1).map((c) => c.trim()));
        i++;
      }
      out.push(
        <table key={key++}>
          <thead>
            <tr>
              {header.map((h, n) => (
                <th key={n} dangerouslySetInnerHTML={{ __html: inline(h) }} />
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, n) => (
              <tr key={n}>
                {r.map((c, m) => (
                  <td key={m} dangerouslySetInnerHTML={{ __html: inline(c) }} />
                ))}
              </tr>
            ))}
          </tbody>
        </table>,
      );
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      const level = Math.min(heading[1]!.length, 6);
      const Tag = `h${level}` as keyof JSX.IntrinsicElements;
      out.push(<Tag key={key++} dangerouslySetInnerHTML={{ __html: inline(heading[2] ?? "") }} />);
      i++;
      continue;
    }

    if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*+]|\d+\.)\s+/.test(lines[i] ?? "")) {
        items.push((lines[i] ?? "").replace(/^\s*([-*+]|\d+\.)\s+/, ""));
        i++;
      }
      const ListTag = ordered ? "ol" : "ul";
      out.push(
        <ListTag key={key++}>
          {items.map((it, n) => (
            <li key={n} dangerouslySetInnerHTML={{ __html: inline(it) }} />
          ))}
        </ListTag>,
      );
      continue;
    }

    if (/^\s*>/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i] ?? "")) {
        buf.push((lines[i] ?? "").replace(/^\s*>\s?/, ""));
        i++;
      }
      out.push(<blockquote key={key++} dangerouslySetInnerHTML={{ __html: inline(buf.join(" ")) }} />);
      continue;
    }

    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
      out.push(<hr key={key++} />);
      i++;
      continue;
    }

    if (!line.trim()) {
      i++;
      continue;
    }

    const buf: string[] = [];
    while (i < lines.length && (lines[i] ?? "").trim() && !/^(#{1,6}\s|\s*([-*+]|\d+\.)\s|\s*>|```|\|)/.test(lines[i] ?? "")) {
      buf.push(lines[i] ?? "");
      i++;
    }
    if (buf.length) {
      out.push(<p key={key++} dangerouslySetInnerHTML={{ __html: inline(buf.join(" ")) }} />);
    } else {
      i++;
    }
  }

  return <div className={`prose-vpip ${className}`}>{out}</div>;
}
