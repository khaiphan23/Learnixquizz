/// <reference types="vite/client" />
import { Question, EssayGrade } from '../types';

// ─── Config ──────────────────────────────────────────────────────────────────

const GEMINI_API_KEY = (
  import.meta.env.VITE_GEMINI_API_KEY ||
  (typeof process !== 'undefined' ? process.env.GEMINI_API_KEY : '')
) as string;

const USE_API_ROUTE =
  typeof window !== 'undefined' && window.location.hostname !== 'localhost';

// ─── Core API call ───────────────────────────────────────────────────────────

async function callGemini(prompt: string, maxTokens = 4096): Promise<string> {
  if (USE_API_ROUTE) {
    const response = await fetch('/api/gemini', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt }),
    });
    const ct = response.headers.get('content-type') ?? '';
    if (!ct.includes('application/json')) {
      const text = await response.text();
      throw new Error(`Server trả về định dạng không hợp lệ: ${text.slice(0, 200)}`);
    }
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'API request failed');
    return data.text as string;
  }

  if (!GEMINI_API_KEY) {
    throw new Error('Thiếu VITE_GEMINI_API_KEY — vui lòng kiểm tra biến môi trường');
  }

  const MODELS = ['gemini-1.5-flash', 'gemini-1.5-pro', 'gemini-2.0-flash-exp'];
  let lastError = '';

  for (const model of MODELS) {
    try {
      const ctrl = new AbortController();
      const tid = setTimeout(() => ctrl.abort(), 30_000);

      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.4, maxOutputTokens: maxTokens },
          }),
          signal: ctrl.signal,
        }
      );

      clearTimeout(tid);

      if (res.status === 429) { lastError = `${model}: quota exceeded`; continue; }
      if (res.status === 404) { lastError = `${model}: model not found`; continue; }
      if (!res.ok) {
        lastError = `${model}: ${res.status} ${await res.text().catch(() => '')}`;
        continue;
      }

      const data = await res.json();
      const text: string | undefined = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (text) return text;
      lastError = `${model}: empty response`;
    } catch (err: any) {
      lastError = err.name === 'AbortError' ? `${model}: timeout` : `${model}: ${err.message}`;
    }
  }

  throw new Error(`Gemini API lỗi: ${lastError}`);
}

// ─── JSON helpers ─────────────────────────────────────────────────────────────

/**
 * Extracts and repairs a JSON array from raw AI output.
 * Handles markdown fences, control chars, trailing commas, etc.
 */
function extractJsonArray(raw: string): unknown[] {
  // Strip markdown fences
  let text = raw.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim();

  // Remove control characters except standard whitespace
  text = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, '');

  // Fix trailing commas: ,] or ,}
  text = text.replace(/,\s*([}\]])/g, '$1');

  // Try to find the outermost JSON array
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start !== -1 && end > start) {
    text = text.slice(start, end + 1);
  }

  return JSON.parse(text) as unknown[];
}

// ─── Question validator ───────────────────────────────────────────────────────

function isValidQuestion(q: unknown): q is Partial<Question> {
  if (!q || typeof q !== 'object') return false;
  const item = q as Record<string, unknown>;

  if (typeof item.text !== 'string' || !item.text.trim()) return false;

  const type = item.type as string;
  if (!['multiple-choice', 'true-false', 'essay'].includes(type)) return false;

  if (type === 'multiple-choice') {
    return (
      Array.isArray(item.options) &&
      (item.options as unknown[]).length === 4 &&
      typeof item.correctAnswerIndex === 'number' &&
      item.correctAnswerIndex >= 0 &&
      item.correctAnswerIndex <= 3
    );
  }

  if (type === 'true-false') {
    return (
      Array.isArray(item.options) &&
      (item.options as unknown[]).length === 2 &&
      typeof item.correctAnswerIndex === 'number' &&
      item.correctAnswerIndex >= 0 &&
      item.correctAnswerIndex <= 1
    );
  }

  // essay
  return true;
}

function normaliseQuestion(raw: Record<string, unknown>): Omit<Question, 'id'> {
  const type = raw.type as Question['type'];
  return {
    type,
    text: String(raw.text ?? '').trim(),
    options: Array.isArray(raw.options)
      ? (raw.options as unknown[]).map(String)
      : [],
    correctAnswerIndex:
      typeof raw.correctAnswerIndex === 'number' ? raw.correctAnswerIndex : 0,
    explanation: typeof raw.explanation === 'string' ? raw.explanation.trim() : '',
    sampleAnswer: typeof raw.sampleAnswer === 'string' ? raw.sampleAnswer.trim() : undefined,
  };
}

// ─── Generate quiz from topic (AI-authored) ───────────────────────────────────

const TOPIC_PROMPT = (
  topic: string,
  num: number,
  difficulty: string,
  lang: string
) => `You are an expert quiz author. Create ${num} quiz questions about "${topic}".
Difficulty: ${difficulty}. Language: ${lang === 'vi' ? 'Vietnamese' : 'English'}.

Rules:
- Mix types: mostly multiple-choice, optionally 1-2 true-false or essay.
- Each question must be distinct, accurate, and educationally valuable.
- For multiple-choice: exactly 4 options, one clearly correct.
- For true-false: options must be ${lang === 'vi' ? '["Đúng","Sai"]' : '["True","False"]'}.
- For essay: set options to [] and provide a sampleAnswer.
- Explanation must be concise (1–2 sentences).

Return ONLY a valid JSON array — no markdown, no extra text:
[
  {
    "type": "multiple-choice",
    "text": "Question text",
    "options": ["Option A", "Option B", "Option C", "Option D"],
    "correctAnswerIndex": 0,
    "explanation": "Why this is correct."
  }
]`;

export async function generateQuizAI(
  topic: string,
  numQuestions: number,
  difficulty: string,
  language: string
): Promise<Question[]> {
  const lang = language === 'en' ? 'en' : 'vi';

  for (let attempt = 0; attempt < 3; attempt++) {
    const prompt =
      attempt === 0
        ? TOPIC_PROMPT(topic, numQuestions, difficulty, lang)
        : // Simpler fallback on retry
          `Generate ${numQuestions} ${difficulty} quiz questions about "${topic}" in ${lang === 'vi' ? 'Vietnamese' : 'English'}.
Return ONLY JSON array:
[{"type":"multiple-choice","text":"...","options":["A","B","C","D"],"correctAnswerIndex":0,"explanation":"..."}]`;

    try {
      const raw = await callGemini(prompt);
      const parsed = extractJsonArray(raw);

      const valid = parsed
        .filter(isValidQuestion)
        .map((q) => normaliseQuestion(q as Record<string, unknown>));

      if (valid.length > 0) return valid as Question[];
      throw new Error('No valid questions in response');
    } catch (err: any) {
      console.warn(`[generateQuizAI] attempt ${attempt + 1} failed:`, err.message);
      if (attempt === 2) throw new Error('Không tạo được câu hỏi — vui lòng thử lại.');
    }
  }

  throw new Error('Không tạo được câu hỏi — vui lòng thử lại.');
}

// ─── Generate questions from pasted / extracted content ────────────────────────

/**
 * System prompt for extracting questions from document content.
 * Mirrors the system prompt in document index 43.
 */
const EXTRACT_SYSTEM = `You are an AI system specialized in extracting quiz questions from educational documents with ABSOLUTE FIDELITY.

CORE GUARANTEES:
1. Extract EVERY question — no skipping, no merging.
2. Preserve EXACT original text — do not paraphrase, fix grammar, or rewrite.
3. Maintain original ORDER — sort by appearance, not by numbering.
4. DO NOT fabricate answers — if the answer is not explicitly marked, set correctAnswerIndex to 0.
5. DO NOT merge separate questions even if numbering is duplicated.

QUESTION RECOGNITION — include ALL of the following:
- Numbered items (1. 2. 3. / Câu 1. Câu 2.)
- Items with A/B/C/D options
- True/False items
- Fill-in-the-blank / cloze items
- Writing / transformation / word-form exercises
- Open-ended questions

TYPE CLASSIFICATION:
- "multiple-choice" → exactly 4 options (A B C D)
- "true-false"      → 2 options: ["Đúng","Sai"] or ["True","False"]
- "essay"           → everything else (transformation, word form, open-ended, fill-blank)

ANSWER DETECTION (strict priority):
1. Explicit label: "Đáp án:", "Answer:", "Key:"
2. Marked option: (*), ✓, bold, underline, →text← markers
3. No marker found → correctAnswerIndex: 0  (DO NOT guess)

OUTPUT — return ONLY valid JSON, no markdown, no preamble:
[
  {
    "type": "multiple-choice" | "true-false" | "essay",
    "text": "exact original question text including its number",
    "options": ["option A text", "option B text", "option C text", "option D text"],
    "correctAnswerIndex": 0,
    "explanation": "",
    "sampleAnswer": ""
  }
]

For essay questions: options = [], sampleAnswer = "" (leave empty — do not invent).
For true-false: options = ["Đúng","Sai"] or ["True","False"] as appropriate.`;

const MAX_CHUNK_CHARS = 4000;

/** Split content at question boundaries to avoid cutting mid-question. */
function smartChunk(content: string, maxChars: number): string[] {
  if (content.length <= maxChars) return [content];

  const lines = content.split('\n');
  const chunks: string[] = [];
  let current = '';

  for (const line of lines) {
    const isQuestionStart = /^(câu\s+)?\d+[.)]/i.test(line.trim());

    if (isQuestionStart && current.length + line.length > maxChars && current.trim()) {
      chunks.push(current.trim());
      current = '';
    }
    current += line + '\n';
  }

  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

/** Process a single chunk with up to 3 attempts (progressively simpler prompts). */
async function extractFromChunk(chunk: string, chunkIndex: number): Promise<Partial<Question>[]> {
  const safeChunk = chunk
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');

  const prompts = [
    // Attempt 0 — full system prompt
    `${EXTRACT_SYSTEM}\n\nCONTENT:\n${safeChunk}\n\nJSON ARRAY:`,

    // Attempt 1 — shorter directive
    `Extract quiz questions from the text below. Return ONLY a JSON array.
Text:\n${safeChunk}\n
Format: [{"type":"multiple-choice","text":"...","options":["A","B","C","D"],"correctAnswerIndex":0,"explanation":"","sampleAnswer":""}]
JSON:`,

    // Attempt 2 — minimal
    `Return a JSON array of quiz questions from:\n${safeChunk.slice(0, 3000)}\n
[{"type":"multiple-choice","text":"Q","options":["A","B","C","D"],"correctAnswerIndex":0,"explanation":"","sampleAnswer":""}]`,
  ];

  for (let attempt = 0; attempt < prompts.length; attempt++) {
    try {
      const raw = await callGemini(prompts[attempt], 4096);
      const parsed = extractJsonArray(raw);
      const valid = parsed.filter(isValidQuestion) as Partial<Question>[];
      if (valid.length > 0) {
        console.log(`[extractFromChunk] chunk ${chunkIndex}, attempt ${attempt}: ${valid.length} questions`);
        return valid;
      }
    } catch (err: any) {
      console.warn(`[extractFromChunk] chunk ${chunkIndex}, attempt ${attempt} failed:`, err.message);
    }
  }

  // Last resort: manual regex extraction
  console.warn(`[extractFromChunk] chunk ${chunkIndex}: falling back to manual extraction`);
  return manualExtract(chunk);
}

/** Regex-based extraction as absolute last resort. */
function manualExtract(text: string): Partial<Question>[] {
  const questions: Partial<Question>[] = [];
  const lines = text.split('\n');
  let current: Partial<Question> | null = null;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    // Question line: "1." / "Câu 1." / "1)"
    const qm = line.match(/^(?:câu\s+)?(\d+)[.)]\s+(.+)/i);
    if (qm) {
      if (current && current.text) questions.push(current);
      current = {
        type: 'multiple-choice',
        text: line,
        options: [],
        correctAnswerIndex: 0,
        explanation: '',
      };
      continue;
    }

    // Option line: "A. ..." / "A) ..."
    const om = line.match(/^([A-D])[.)]\s+(.+)/);
    if (om && current) {
      if (!current.options) current.options = [];
      (current.options as string[]).push(om[2].trim());

      // Detect explicit answer markers
      if (line.includes('[→') || line.includes('✓') || line.includes('(*)')) {
        current.correctAnswerIndex = 'ABCD'.indexOf(om[1]);
      }
      // If we have 4 options, decide type
      if ((current.options as string[]).length === 4) current.type = 'multiple-choice';
      if ((current.options as string[]).length === 2) current.type = 'true-false';
    }
  }

  if (current && current.text) questions.push(current);
  return questions.filter(isValidQuestion);
}

/** Deduplicate by text similarity to avoid cross-chunk duplicates. */
function deduplicateQuestions(questions: Partial<Question>[]): Partial<Question>[] {
  const seen = new Set<string>();
  return questions.filter((q) => {
    const key = (q.text ?? '').trim().slice(0, 80).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function generateQuestionsFromContent(
  content: string,
  language: string
): Promise<Question[]> {
  if (!content.trim()) {
    throw new Error('Nội dung trống — vui lòng nhập hoặc trích xuất nội dung trước');
  }

  const chunks = smartChunk(content.trim(), MAX_CHUNK_CHARS);
  console.log(`[generateQuestionsFromContent] ${chunks.length} chunk(s) from ${content.length} chars`);

  const allRaw: Partial<Question>[] = [];

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const extracted = await extractFromChunk(chunk, i + 1);
    allRaw.push(...extracted);
  }

  const deduped = deduplicateQuestions(allRaw);

  // Sort by question number if detectable
  const withNum = deduped.map((q) => ({
    q,
    num: parseInt((q.text ?? '').match(/(\d+)/)?.[1] ?? '0', 10),
  }));
  withNum.sort((a, b) => a.num - b.num);

  const finalQuestions = withNum.map(({ q }) =>
    normaliseQuestion(q as Record<string, unknown>)
  ) as Question[];

  console.log(`[generateQuestionsFromContent] Final: ${finalQuestions.length} questions`);

  if (finalQuestions.length === 0) {
    throw new Error(
      'AI không trích xuất được câu hỏi hợp lệ nào. Vui lòng kiểm tra định dạng nội dung.'
    );
  }

  return finalQuestions;
}

// ─── AI explanation for wrong answers ────────────────────────────────────────

export async function getAIExplanation(
  question: string,
  userAnswer: string,
  correctAnswer: string
): Promise<string> {
  const prompt = `Quiz question: "${question}"
User answered: "${userAnswer}"
Correct answer: "${correctAnswer}"
Explain in 2-3 sentences why the correct answer is right and why the user's answer is wrong. Be concise and educational.`;

  return callGemini(prompt, 512);
}

// ─── Essay grading ────────────────────────────────────────────────────────────

export async function gradeEssayAI(
  question: string,
  answer: string,
  sampleAnswer?: string
): Promise<EssayGrade> {
  const prompt = `Grade the following essay answer on a scale of 0–100.

Question: "${question}"
${sampleAnswer ? `Reference answer: "${sampleAnswer}"` : ''}
Student answer: "${answer}"

Criteria: accuracy, completeness, clarity.

Return ONLY valid JSON (no markdown):
{"score": <number 0-100>, "feedback": "<2-3 sentence feedback in the same language as the question>"}`;

  try {
    const raw = await callGemini(prompt, 512);
    const clean = raw.replace(/```json\s*|```\s*/gi, '').trim();
    const parsed = JSON.parse(clean) as { score: number; feedback: string };
    if (typeof parsed.score === 'number' && typeof parsed.feedback === 'string') {
      return { score: Math.max(0, Math.min(100, parsed.score)), feedback: parsed.feedback };
    }
    throw new Error('Invalid grade structure');
  } catch {
    return {
      score: 50,
      feedback: 'Không chấm được tự động. Vui lòng xem xét thủ công.',
    };
  }
}