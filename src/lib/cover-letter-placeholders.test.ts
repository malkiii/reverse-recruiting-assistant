import { expect, test } from "vitest";
import { splitPlaceholders } from "./cover-letter-placeholders";

test("a Cover Letter splits into its text and the placeholders filled in for each email", () => {
  expect(splitPlaceholders("Hi {{name}},\n\nI'd love to help.\n\n{{resume_link}}")).toEqual([
    { text: "Hi ", placeholder: false },
    { text: "{{name}}", placeholder: true },
    { text: ",\n\nI'd love to help.\n\n", placeholder: false },
    { text: "{{resume_link}}", placeholder: true },
  ]);
});
