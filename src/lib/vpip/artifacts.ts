import type { ArtifactType } from "./types";

/** Classify a build-session file path into an artifact type. */
export function classifyArtifact(path: string): ArtifactType {
  const p = path.toLowerCase();
  const ext = p.includes(".") ? p.slice(p.lastIndexOf(".") + 1) : "";
  if (ext === "sql") return "SQL Scripts";
  if (ext === "md" || ext === "mdx" || ext === "txt" || p.startsWith("docs/")) {
    return "Documentation";
  }
  if (ext === "log") return "Logs";
  if (
    ext === "json" ||
    ext === "yml" ||
    ext === "yaml" ||
    ext === "toml" ||
    ext === "ini" ||
    ext === "env" ||
    p.endsWith(".config.js") ||
    p.endsWith(".config.ts")
  ) {
    return "Configuration Files";
  }
  if (p.startsWith("dist/") || p.startsWith("build/") || p.startsWith("out/")) {
    return "Build Outputs";
  }
  return "Source Files";
}

export function artifactSize(content: string) {
  return new TextEncoder().encode(content).length;
}

export function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
