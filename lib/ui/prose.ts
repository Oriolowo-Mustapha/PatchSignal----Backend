export type InlineSegment = {
  kind: "text" | "bold" | "code-file" | "code-error" | "code-symbol";
  value: string;
};

export type ProseBlock =
  | { kind: "paragraph"; segments: InlineSegment[] }
  | { kind: "ordered"; items: InlineSegment[][] }
  | { kind: "bullet"; items: InlineSegment[][] };

const ERROR_CODE_RE =
  /Exception|Error|Failure|Failed|Timeout|EndOfStream|InvalidOperation|NullReference|Attempted to read/i;
const FILE_EXT_RE =
  /\.(cs|ts|tsx|js|jsx|mjs|cjs|json|yml|yaml|csproj|sln|slnx|py|go|rs|css|md|sql)$/i;

function classifyCodeToken(value: string): InlineSegment["kind"] {
  if (ERROR_CODE_RE.test(value)) return "code-error";
  if (!value.includes(" ") && (FILE_EXT_RE.test(value) || value.includes("/"))) {
    return "code-file";
  }
  return "code-symbol";
}

/**
 * Tokenizes inline markdown (`code`, **bold**, *emphasis*) into safe React segments
 * with zero HTML injection and typed styling for filenames, exceptions, and symbols.
 */
export function parseInlineSegments(text: string): InlineSegment[] {
  const tokenRe = /`([^`\n]+)`|\*\*([^*\n]+)\*\*|\*([^*\s][^*\n]*?)\*/g;
  const segments: InlineSegment[] = [];
  let cursor = 0;

  for (const match of text.matchAll(tokenRe)) {
    const index = match.index ?? 0;
    if (index > cursor) {
      segments.push({ kind: "text", value: text.slice(cursor, index) });
    }
    if (match[1] !== undefined) {
      segments.push({ kind: classifyCodeToken(match[1]), value: match[1] });
    } else if (match[2] !== undefined) {
      segments.push({ kind: "bold", value: match[2] });
    } else if (match[3] !== undefined) {
      segments.push({ kind: "bold", value: match[3] });
    }
    cursor = index + match[0].length;
  }

  if (cursor < text.length) {
    segments.push({ kind: "text", value: text.slice(cursor) });
  }
  return segments;
}

/**
 * Normalizes dense LLM diagnostic prose (including inline `1. ... 2. ...` and `- ... - ...`
 * sequences) into distinct paragraphs, ordered lists, and bullet lists.
 */
export function parseDiagnosisProse(raw: string): ProseBlock[] {
  const trimmed = raw.replace(/\r/g, "").trim();
  if (!trimmed) return [];

  // Break inline numbered items ("issues: 1. Foo. 2. Bar") and inline bullet items ("both: - In X. - In Y")
  // onto separate lines while leaving decimal numbers or hyphenated words untouched.
  const normalized = trimmed
    .replace(/([:.])\s+(\d+)\.\s+(?=[A-Z`*]|\*\*)/g, "$1\n$2. ")
    .replace(/([:.])\s+-\s+(?=[A-Z`*]|\*\*)/g, "$1\n- ");

  const lines = normalized.split("\n");
  const blocks: ProseBlock[] = [];
  let paragraphLines: string[] = [];
  let orderedItems: string[] = [];
  let bulletItems: string[] = [];

  const flushParagraph = () => {
    if (paragraphLines.length === 0) return;
    const text = paragraphLines.join(" ").trim();
    if (text) blocks.push({ kind: "paragraph", segments: parseInlineSegments(text) });
    paragraphLines = [];
  };

  const flushOrdered = () => {
    if (orderedItems.length === 0) return;
    blocks.push({ kind: "ordered", items: orderedItems.map(parseInlineSegments) });
    orderedItems = [];
  };

  const flushBullet = () => {
    if (bulletItems.length === 0) return;
    blocks.push({ kind: "bullet", items: bulletItems.map(parseInlineSegments) });
    bulletItems = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      flushParagraph();
      flushOrdered();
      flushBullet();
      continue;
    }

    const orderedMatch = line.match(/^\d+\.\s+(.+)$/);
    if (orderedMatch) {
      flushParagraph();
      flushBullet();
      orderedItems.push(orderedMatch[1].trim());
      continue;
    }

    const bulletMatch = line.match(/^[-*]\s+(.+)$/);
    if (bulletMatch) {
      flushParagraph();
      flushOrdered();
      bulletItems.push(bulletMatch[1].trim());
      continue;
    }

    flushOrdered();
    flushBullet();
    paragraphLines.push(line);
  }

  flushParagraph();
  flushOrdered();
  flushBullet();

  return blocks;
}
