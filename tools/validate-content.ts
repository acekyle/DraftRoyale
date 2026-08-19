/** Validates every content file against the shared schemas. Exit 1 on any error. */
import { validateArena, validateFighter, validateWildcard, hasErrors, type ValidationIssue } from '@arena/contracts';
import { loadContent } from './load-content';

const content = loadContent();
let all: ValidationIssue[] = [];

for (const f of content.fighterFiles) {
  const issues = validateFighter(f.data);
  report(f.file, issues);
  all = all.concat(issues);
}
for (const w of content.wildcardFiles) {
  const issues = validateWildcard(w.data);
  report(w.file, issues);
  all = all.concat(issues);
}
for (const a of content.arenaFiles) {
  const issues = validateArena(a.data);
  report(a.file, issues);
  all = all.concat(issues);
}

function report(file: string, issues: ValidationIssue[]) {
  for (const i of issues) console.log(`${i.severity.toUpperCase().padEnd(7)} ${i.path}: ${i.message}`);
  if (issues.length === 0) console.log(`OK      ${file.split('/content/')[1]}`);
}

const errors = all.filter((i) => i.severity === 'error').length;
const warnings = all.filter((i) => i.severity === 'warning').length;
console.log(`\n${content.fighterFiles.length} fighters, ${content.wildcardFiles.length} wildcards, ${content.arenaFiles.length} arenas — ${errors} errors, ${warnings} warnings`);
if (hasErrors(all)) process.exit(1);
