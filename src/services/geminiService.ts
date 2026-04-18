import { Question, EssayGrade, QuestionType } from '../types';
import { v4 as uuidv4 } from 'uuid';

const GEMINI_API_KEY =
  (import.meta.env.VITE_GEMINI_API_KEY ||
    (typeof process !== 'undefined' ? process.env.GEMINI_API_KEY : '')) as string;

const USE_API_ROUTE = typeof window !== 'undefined' && window.location.hostname !== 'localhost';

type CallGeminiOptions = { json?: boolean };

async function callGemini(prompt: string, options?: CallGeminiOptions): Promise<string> {
  const wantJson = Boolean(options?.json);

  if (USE_API_ROUTE) {
    try {
      const response = await fetch('/api/gemini', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, json: wantJson }),
      });

      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        const text = await response.text();
        console.error('API returned non-JSON response:', text);
        throw new Error(`Server trả về định dạng không hợp lệ (có thể là lỗi 404/500 của Vercel).`);
      }

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'API request failed');
      }

      return data.text;
    } catch (error: any) {
      throw new Error(`Lỗi API: ${error.message}`);
    }
  }

  if (!GEMINI_API_KEY) {
    throw new Error('Thiếu VITE_GEMINI_API_KEY — vui lòng kiểm tra biến môi trường');
  }

  const MODELS = [
    'gemini-1.5-flash',
    'gemini-1.5-pro',
    'gemini-2.0-flash-exp',
  ];

  let lastError = '';

  for (const model of MODELS) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000);

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 8192,
            ...(wantJson ? { responseMimeType: 'application/json' } : {}),
          },
        }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (res.status === 429) {
        lastError = `${model}: quota exceeded`;
        continue;
      }

      if (res.status === 404) {
        lastError = `${model}: model không tồn tại`;
        continue;
      }

      if (!res.ok) {
        const txt = await res.text().catch(() => res.statusText);
        lastError = `${model}: ${res.status} ${txt}`;
        continue;
      }

      const data = await res.json();
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (text) return text;

      lastError = `${model}: response rỗng`;
    } catch (err: any) {
      if (err.name === 'AbortError') {
        lastError = `${model}: timeout 30s`;
      } else {
        lastError = `${model}: ${err.message}`;
      }
      continue;
    }
  }

  throw new Error(`Gemini API lỗi: ${lastError}`);
}

/** Bỏ fence markdown và BOM — model đôi khi vẫn bọc ```json */
function stripModelFences(text: string): string {
  return text.replace(/^\uFEFF/, '').replace(/```(?:json)?\s*/gi, '').replace(/```\s*$/g, '').trim();
}

/** Lấy chuỗi JSON array cân bằng ngoặc [...] đầu tiên (tránh regex greedy match sai) */
function extractBalancedJsonArray(s: string): string | null {
  const start = s.indexOf('[');
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (c === '\\' && inString) {
      escape = true;
      continue;
    }
    if (c === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (c === '[') depth++;
    else if (c === ']') {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}

function isQuestionType(s: string): s is QuestionType {
  return s === 'multiple-choice' || s === 'true-false' || s === 'essay';
}

function coerceQuestionType(raw: unknown): QuestionType {
  const s = String(raw ?? '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/_/g, '-');
  if (s === 'multiplechoice' || s === 'mcq' || s === 'multiple_choice') return 'multiple-choice';
  if (s === 'truefalse' || s === 'tf' || s === 'true_false' || s === 'boolean') return 'true-false';
  if (s === 'essay' || s === 'open-ended') return 'essay';
  if (isQuestionType(s)) return s;
  return 'multiple-choice';
}

/** Chuẩn hoá 1 phần tử (hỗ trợ cả schema { question, options, correct } lẫn schema app) */
function normalizeRawItemToQuestion(raw: unknown, language: string): Question | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;

  const text =
    typeof o.text === 'string' && o.text.trim()
      ? o.text.trim()
      : typeof o.question === 'string' && o.question.trim()
        ? o.question.trim()
        : '';

  if (!text) return null;

  let type = coerceQuestionType(o.type);
  const isEn = language === 'en';
  const tfDefault = isEn ? (['True', 'False'] as const) : (['Đúng', 'Sai'] as const);

  let options: string[] = [];
  if (Array.isArray(o.options)) {
    options = (o.options as unknown[]).map(x => String(x).trim()).filter(x => x.length > 0);
  }

  let correctAnswerIndex =
    typeof o.correctAnswerIndex === 'number' && Number.isFinite(o.correctAnswerIndex)
      ? Math.floor(o.correctAnswerIndex)
      : 0;

  if (o.correct !== undefined && o.correct !== null) {
    const cStr = String(o.correct).trim();
    if (/^[A-D]$/i.test(cStr) && options.length >= 2) {
      correctAnswerIndex = cStr.toUpperCase().charCodeAt(0) - 65;
    } else if (/^[01]$/.test(cStr) && options.length === 2) {
      correctAnswerIndex = Number(cStr);
    } else {
      const ix = options.findIndex(x => x.toLowerCase() === cStr.toLowerCase());
      if (ix >= 0) correctAnswerIndex = ix;
    }
  }

  const explanation =
    typeof o.explanation === 'string'
      ? o.explanation
      : typeof o.reason === 'string'
        ? o.reason
        : '';

  const sampleAnswer =
    typeof o.sampleAnswer === 'string'
      ? o.sampleAnswer
      : typeof o.sample_answer === 'string'
        ? o.sample_answer
        : typeof o.answer === 'string' && type === 'essay'
          ? o.answer
          : '';

  if (type === 'true-false') {
    if (options.length !== 2) options = [...tfDefault];
    correctAnswerIndex = Math.max(0, Math.min(1, correctAnswerIndex));
  } else if (type === 'essay') {
    options = [];
    correctAnswerIndex = 0;
  } else {
    while (options.length < 4) options.push('');
    options = options.slice(0, 4);
    correctAnswerIndex = Math.max(0, Math.min(3, correctAnswerIndex));
  }

  return {
    id: uuidv4(),
    type,
    text,
    options: type === 'essay' ? [] : options,
    correctAnswerIndex,
    explanation: explanation.trim() || undefined,
    sampleAnswer: type === 'essay' ? (sampleAnswer.trim() || undefined) : undefined,
  };
}

function extractQuestionsArrayFromModelText(rawText: string, logLabel: string, language: string): Question[] {
  const preview =
    rawText.length > 1500
      ? `${rawText.slice(0, 700)} …[${rawText.length} chars]… ${rawText.slice(-500)}`
      : rawText;
  console.info(`[AI ${logLabel}] response length=${rawText.length}`, preview);

  const clean = stripModelFences(rawText);
  const candidates: string[] = [clean];
  const balanced = extractBalancedJsonArray(clean);
  if (balanced && !candidates.includes(balanced)) candidates.push(balanced);

  let lastParseErr: unknown;
  for (const chunk of candidates) {
    try {
      const parsed: unknown = JSON.parse(chunk);
      if (!Array.isArray(parsed)) {
        lastParseErr = new Error('JSON không phải mảng');
        continue;
      }
      const out: Question[] = [];
      for (const item of parsed) {
        const q = normalizeRawItemToQuestion(item, language);
        if (q) out.push(q);
      }
      if (out.length) return out;
      lastParseErr = new Error('Mảng rỗng sau khi chuẩn hoá');
    } catch (e) {
      lastParseErr = e;
    }
  }

  console.error(`[AI ${logLabel}] parse failed`, lastParseErr);
  throw new Error('Không parse được dữ liệu từ AI — thử lại');
}

export async function generateQuizAI(
  topic: string,
  numQuestions: number,
  difficulty: string,
  language: string
): Promise<Question[]> {
  const lang = language === 'en' ? 'English' : 'Vietnamese';

  const prompt = `Generate exactly ${numQuestions} quiz questions about "${topic}" at ${difficulty} difficulty. Write in ${lang}.

Return ONLY a JSON array (no markdown, no commentary). Each element must be an object with:
- "type": "multiple-choice" | "true-false"
- "text": string (the question)
- "options": string[] — for multiple-choice exactly 4 strings; for true-false use ${language === 'en' ? '["True","False"]' : '["Đúng","Sai"]'}
- "correctAnswerIndex": integer 0-based index into options
- "explanation": string (brief)

Example shape:
[{"type":"multiple-choice","text":"...","options":["A","B","C","D"],"correctAnswerIndex":0,"explanation":"..."}]`;

  const text = await callGemini(prompt, { json: true });
  return extractQuestionsArrayFromModelText(text, 'generateQuizAI', language);
}

export async function getAIExplanation(
  question: string,
  userAnswer: string,
  correctAnswer: string
): Promise<string> {
  const prompt = `Quiz question: "${question}"
User answered: "${userAnswer}"
Correct answer: "${correctAnswer}"
Explain briefly (2-3 sentences) why the correct answer is right.`;
  return callGemini(prompt);
}

export async function generateQuestionsFromContent(
  content: string,
  counts: { multipleChoice: number; trueFalse: number; essay: number },
  language: string
): Promise<Question[]> {
  const lang = language === 'en' ? 'English' : 'Vietnamese';
  const { multipleChoice: nMc, trueFalse: nTf, essay: nEssay } = counts;

  if (!content.trim()) {
    throw new Error('Nội dung trống — vui lòng nhập hoặc trích xuất nội dung trước');
  }

  const tfOpts = language === 'en' ? '["True","False"]' : '["Đúng","Sai"]';

  const prompt = `You are an expert quiz generator. Read the CONTENT and create exactly this many questions (no more, no fewer):
- multiple-choice: ${nMc}
- true-false: ${nTf}
- essay: ${nEssay}

Total items in the JSON array must be ${nMc + nTf + nEssay}.

CONTENT:
${content}

Output rules:
1. Return ONLY a JSON array. No markdown fences, no text before or after. Valid UTF-8 JSON only.
2. Language for all question text, options, explanations, and essay sample answers: ${lang}.
3. Each object fields:
   - "type": "multiple-choice" | "true-false" | "essay"
   - "text": string
   - "options": for multiple-choice exactly 4 distinct strings; for true-false exactly ${tfOpts}; for essay use [] (empty array)
   - "correctAnswerIndex": 0..3 for MC, 0..1 for TF, 0 for essay
   - "explanation": required string for MC and TF (why the answer is correct); for essay may be ""
   - "sampleAnswer": required string for essay (model answer); for MC/TF use ""
4. Every question must be grounded in the CONTENT only.
5. Escape any double quotes inside strings. No trailing commas.`;

  try {
    const text = await callGemini(prompt, { json: true });
    return extractQuestionsArrayFromModelText(text, 'generateQuestionsFromContent', language);
  } catch (error: any) {
    throw new Error(`Lỗi tạo câu hỏi: ${error.message}`);
  }
}

export async function gradeEssayAI(
  question: string,
  answer: string,
  sampleAnswer?: string
): Promise<EssayGrade> {
  const prompt = `Grade this essay answer 0-100.
Question: "${question}"
${sampleAnswer ? `Sample answer: "${sampleAnswer}"` : ''}
Student answer: "${answer}"
Return ONLY valid JSON: {"score": number, "feedback": "2-3 sentence feedback"}`;

  try {
    const text = await callGemini(prompt, { json: true });
    const clean = stripModelFences(text);
    const parsed = JSON.parse(clean) as { score?: unknown; feedback?: unknown };
    if (typeof parsed.score === 'number' && Number.isFinite(parsed.score)) {
      return {
        score: Math.max(0, Math.min(100, parsed.score)),
        feedback: typeof parsed.feedback === 'string' ? parsed.feedback : '',
      };
    }
    throw new Error('invalid');
  } catch {
    return { score: 50, feedback: 'Không chấm được tự động. Vui lòng xem xét thủ công.' };
  }
}
