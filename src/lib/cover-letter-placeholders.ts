export const NAME_PLACEHOLDER = "{{name}}";
export const RESUME_LINK_PLACEHOLDER = "{{resume_link}}";
/** Filled in with the Job's company name as soon as the Cover Letter is written, so Review shows the real name. */
export const COMPANY_PLACEHOLDER = "{{company}}";

const PLACEHOLDERS = new RegExp(`(${NAME_PLACEHOLDER}|${RESUME_LINK_PLACEHOLDER})`);

/** A Cover Letter as its plain text and the placeholders filled in for each email, in order, so they can be highlighted. */
export function splitPlaceholders(coverLetter: string) {
  return coverLetter
    .split(PLACEHOLDERS)
    .filter(Boolean)
    .map((text) => ({ text, placeholder: text === NAME_PLACEHOLDER || text === RESUME_LINK_PLACEHOLDER }));
}
