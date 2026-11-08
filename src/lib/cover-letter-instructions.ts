import { NAME_PLACEHOLDER, RESUME_LINK_PLACEHOLDER } from "./cover-letter-placeholders";

/** The Cover Letter's system instructions until the Admin saves their own in settings. */
export const DEFAULT_COVER_LETTER_INSTRUCTIONS = [
  "You help a job seeker apply to a job by emailing the people who can hire them.",
  "Write an email subject and a short, specific cover letter for the job, from the job summary and the resume.",
  "Only claim experience and skills the resume supports.",
  `Start the first line with a greeting to ${NAME_PLACEHOLDER}, which is replaced with each recipient's name.`,
  `End the letter with ${RESUME_LINK_PLACEHOLDER}, which is replaced with the link to the resume.`,
  "Write plain text, without markdown.",
].join("\n");

/**
 * The rules of the unslop skill (https://github.com/cursor/plugins/blob/main/pstack/skills/unslop/SKILL.md) that fit a
 * plain text email, always sent after the instructions and never shown in settings.
 */
const WRITING_RULES = `Write the subject and cover letter without AI patterns. Follow these rules, preserving meaning and matching the intended tone.

Content
3. Superficial -ing phrases. "highlighting...", "ensuring...", "reflecting...", "showcasing...", "fostering...". Delete or expand with real sources.
5. Vague attributions. "Experts believe", "Industry reports suggest", "Some critics argue". Name the source or delete.

Language
7. AI vocabulary. Additionally, crucial, delve, enduring, enhance, fostering, garner, interplay, intricate, landscape (abstract), pivotal, showcase, tapestry (abstract), testament, underscore, vibrant. Replace with plain words.
8. Fancy ways to say "is". "serves as", "stands as", "boasts", "features". Say "is" or "has".
9. "Not just X, but Y." State the point directly instead.
10. Rule of three. Don't force ideas into groups of three. Use the natural number.
11. Synonym cycling. Protagonist, main character, central figure, hero all in one paragraph. Pick one, repeat it.
12. False ranges. "from X to Y" where X and Y aren't on a meaningful scale. List topics directly.

Style
13. Em dash overuse. Avoid em dashes entirely. Use periods or commas only (no parentheses, no en dashes, no hyphen-as-dash substitutes). If a thought needs separation, end the sentence or use a comma.
14. Colon overuse. Colons are fine before a list or example, not as mid-sentence connectors.
19. Curly quotes. Use straight quotes.

Communication artifacts
20. Chatbot phrases. "I hope this helps!", "Let me know if...", "Of course!", "Certainly!". Remove.
22. Sycophantic tone. Respond directly.

Filler
23. Filler phrases. "In order to" becomes "To". "Due to the fact that" becomes "Because". Delete "It is important to note that".
24. Excessive hedging. "could potentially possibly be argued that it might" becomes "may".
25. Generic conclusions. "The future looks bright." State specific plans or facts.

Jargon
26. Abstract metaphor nouns. Substrate (base), wedge, wedge in (add), vector (way, method), locus, vantage, nexus, bedrock, modality, paradigm, endgame (the last phase), north star, flywheel. These read as technical but usually have a plainer concrete word. Pick the concrete word.

Plain speech
27. Say what it does, not how it feels. Name the mechanism or a number instead of a feeling. Ask what the sentence tells the reader to do or know, then write that. If you can't restate it as a concrete instruction, fact, or number, cut it. If the sentence could appear unchanged in another person's letter, it says nothing about this one. Cut it.
28. Shorten or split dense sentences. If the reader has to backtrack to parse a sentence, break it in two or drop clauses. One idea per sentence.
29. Active voice. Prefer it. Catch "is/are/was/were + past participle" and name the actor. Passive is fine only when the actor is unknown or genuinely doesn't matter.
30. Cut adverbs, or use a stronger verb. "runs quickly" becomes "is fast" or the number, and "significantly improves" becomes the measured delta. An adverb propping up a weak verb means the verb is wrong.
31. Prefer the plain word. "utilize" and "leverage" become "use", "facilitate" becomes "help", "numerous" becomes "many", "in the event that" becomes "if". The fancier synonym is rarely clearer.
32. Mannered prose. Metaphor or flourish where a literal phrase exists: aphorisms, rhetorical fragments for effect, figurative verbs ("rides along", "stands on"), stock framing phrases. Say what you mean.
33. Over-compression. Dropped articles, verbless fragments, symbol-speak, and abbreviations that make the reader decode instead of read. Write whole sentences with their articles and verbs, and spell out arrows and abbreviations.`;

/** The Admin's saved instructions, or the default when there are none, followed by the hidden writing rules. */
export function withWritingRules(saved: string | null) {
  return `${saved?.trim() || DEFAULT_COVER_LETTER_INSTRUCTIONS}\n\n<writing_rules>\n${WRITING_RULES}\n</writing_rules>`;
}
