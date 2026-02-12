export const REQUIRED_SECTIONS = ['What I did', 'Interface changes', 'Watch out'] as const;

export interface ValidationResult {
  valid: boolean;
  missing: string[];
}

/**
 * Validate a paw done summary for required section headers.
 * Checks for ## or ### headings matching the required sections (case-insensitive).
 */
export function validateSummary(summary: string): ValidationResult {
  const missing: string[] = [];

  for (const section of REQUIRED_SECTIONS) {
    const pattern = new RegExp(`^#{2,3}\\s+${escapeRegex(section)}`, 'im');
    if (!pattern.test(summary)) {
      missing.push(section);
    }
  }

  return { valid: missing.length === 0, missing };
}

/** Generate the error-display template from REQUIRED_SECTIONS. Single source of truth. */
export function generateErrorTemplate(): string {
  const sectionTemplates: Record<string, string> = {
    'What I did': '- [Major accomplishment 1]\n- [Major accomplishment 2]',
    'Interface changes':
      '- [Type/export/API changes other agents need to know about]\n- [New exports, renamed functions, changed signatures]',
    'Watch out':
      "- [Non-obvious things: env vars, ordering dependencies, breaking changes]\n- [Anything that isn't clear from the diff alone]",
  };

  return REQUIRED_SECTIONS.map((s) => `## ${s}\n${sectionTemplates[s] ?? '- [Details]'}`).join(
    '\n\n',
  );
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
