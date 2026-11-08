import { expect, test } from "vitest";
import { resumesIn, resumeUsage } from "./resumes";

const pdf = (name: string) => ({ id: name, name, mimeType: "application/pdf", webViewLink: `https://drive/${name}` });

test("only PDFs whose names end in resume or CV, in any case, are Resumes", () => {
  const files = [
    pdf("Backend Engineer Resume.pdf"),
    pdf("data-analyst-cv.PDF"),
    pdf("Frontend RESUME"),
    pdf("Product Manager Cv.pdf"),
    pdf("Resume for backend.pdf"),
    pdf("Cover letter.pdf"),
    pdf("JohnDoeResume.pdf"),
    { ...pdf("Backend Resume.docx"), mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
    { ...pdf("Designer Resume"), mimeType: "application/vnd.google-apps.document" },
  ];

  expect(resumesIn(files).map(({ name }) => name)).toEqual([
    "Backend Engineer Resume.pdf",
    "data-analyst-cv.PDF",
    "Frontend RESUME",
    "Product Manager Cv.pdf",
    "JohnDoeResume.pdf",
  ]);
});

test("each Resume counts the Applications that use it, and how many of them were Sent", () => {
  const usage = resumeUsage([
    { resumeFileId: "backend", status: "sent" },
    { resumeFileId: "backend", status: "in-review" },
    { resumeFileId: "backend", status: "sent" },
    { resumeFileId: "frontend", status: "failed" },
    { resumeFileId: null, status: "preparing" },
  ]);
  expect(usage.get("backend")).toEqual({ applications: 3, sent: 2 });
  expect(usage.get("frontend")).toEqual({ applications: 1, sent: 0 });
  expect(usage.get("designer")).toBeUndefined();
});
