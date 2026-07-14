// Client-side text extraction for uploaded knowledge-base files. Done in the
// browser (not the Deno edge function) because mammoth/exceljs's zip/inflate
// internals are unverified in Supabase's constrained edge runtime — see the
// project plan's RAG ingestion section for the full rationale.

// ExcelJS gives non-primitive `.value` shapes for several cell kinds —
// formulas (`{formula, result}`), rich text (`{richText: [...]}`), and
// hyperlinks (`{text, hyperlink}`). A bare `String(cell)` on any of these
// stringifies the object itself ("[object Object]") instead of its content,
// silently feeding garbage into the RAG embeddings with no visible error.
function cellToText(cell: unknown): string {
  if (cell == null) return "";
  if (typeof cell !== "object") return String(cell);
  if (cell instanceof Date) return cell.toISOString();
  const obj = cell as Record<string, unknown>;
  if ("result" in obj) return cellToText(obj.result); // formula cell
  if (Array.isArray(obj.richText)) {
    return (obj.richText as { text: string }[]).map((run) => run.text).join("");
  }
  if (typeof obj.text === "string") return obj.text; // hyperlink cell
  if (typeof obj.error === "string") return `#${obj.error}`;
  return String(cell);
}

export async function extractText(file: File): Promise<string> {
  const name = file.name.toLowerCase();

  if (name.endsWith(".docx")) {
    const mammoth = await import("mammoth/mammoth.browser");
    const arrayBuffer = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer });
    return result.value;
  }

  if (name.endsWith(".xlsx")) {
    const ExcelJS = (await import("exceljs")).default;
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await file.arrayBuffer());
    const lines: string[] = [];
    workbook.eachSheet((sheet) => {
      lines.push(`# ${sheet.name}`);
      sheet.eachRow((row) => {
        const cells = (row.values as unknown[]).slice(1).map(cellToText);
        if (cells.some((cell) => cell.trim() !== "")) {
          lines.push(cells.join("\t"));
        }
      });
    });
    return lines.join("\n");
  }

  throw new Error("Unsupported file type. Upload a .docx or .xlsx file.");
}
