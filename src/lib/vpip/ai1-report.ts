/**
 * AI 1 Build Completion Report — a builder self-report, not an audit.
 * File lists are computed by VPIP from the files actually written; the
 * remaining sections come from AI 1's own "AI 1 Build Completion Report".
 */

export const AI1_REPORT_INSTRUCTION = `

MANDATORY AI 1 BUILD COMPLETION REPORT
End EVERY answer (before the Traceability section) with a section headed exactly "## AI 1 Build Completion Report" containing these sub-headings, each with a bullet list (write "- None" when empty; never invent):
### Pages Created
### Routes Created
### Components Created
### Features Implemented
### Limitations Observed
(missing packages, credentials, APIs, environment variables, repository files, services)
### Known Problems
(build errors, runtime errors, type errors, missing routes, placeholder pages, unimplemented features)
### Assumptions Made
(mock data used, temporary implementations, placeholder content, architecture assumptions)
### Next Recommended Actions
This is a self-report, not an audit. Be honest about gaps.`;

const HEAD = /^#{1,3}\s*AI\s*1\s*Build\s*Completion\s*Report\s*$/im;

export function extractSelfReport(answer: string): string {
  const i = answer.search(HEAD);
  if (i === -1) return "";
  let rest = answer.slice(i).replace(HEAD, "");
  const stop = rest.search(/^#{1,2}\s*Traceability\b/im);
  if (stop !== -1) rest = rest.slice(0, stop);
  return rest.trim();
}

const list = (xs: string[]) => (xs.length ? xs.map((x) => `- ${x}`).join("\n") : "- None");

export function composeAi1Report(opts: {
  buildCode: string;
  created: string[];
  modified: string[];
  deleted: string[];
  selfReport: string;
}) {
  return `# AI 1 BUILD COMPLETION REPORT
**BUILD ID:** ${opts.buildCode} · ${new Date().toLocaleString()}

### Files Created
${list(opts.created)}

### Files Modified
${list(opts.modified)}

### Files Deleted
${list(opts.deleted)}

${opts.selfReport || "_AI 1 did not include a self-report in this answer. Pages, routes, features, limitations, problems and assumptions were not reported._"}`;
}
