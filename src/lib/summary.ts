export const REQUIRED_SECTIONS = [
  "What I did",
  "Interface changes",
  "Watch out",
] as const;

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
    const pattern = new RegExp(`^#{2,3}\\s+${escapeRegex(section)}`, "im");
    if (!pattern.test(summary)) {
      missing.push(section);
    }
  }

  return { valid: missing.length === 0, missing };
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
