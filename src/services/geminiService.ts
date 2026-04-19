import { Question, EssayGrade } from '../types';

const GEMINI_API_KEY =
  (import.meta.env.VITE_GEMINI_API_KEY ||
    (typeof process !== 'undefined' ? process.env.GEMINI_API_KEY : '')) as string;

const USE_API_ROUTE = typeof window !== 'undefined' && window.location.hostname !== 'localhost';

async function callGemini(prompt: string): Promise<string> {
  if (USE_API_ROUTE) {
    try {
      const response = await fetch('/api/gemini', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
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
          generationConfig: { temperature: 0.7, maxOutputTokens: 2048 },
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

export async function generateQuizAI(
  topic: string,
  numQuestions: number,
  difficulty: string,
  language: string
): Promise<Question[]> {
  const lang = language === 'en' ? 'English' : 'Vietnamese';

  const prompt = `Generate ${numQuestions} quiz questions about "${topic}" at ${difficulty} difficulty. Respond in ${lang}.
Return ONLY a valid JSON array, no markdown, no extra text:
[{"id":"q1","type":"multiple-choice","text":"question text","options":["A","B","C","D"],"correctAnswerIndex":0,"explanation":"why A is correct"}]
Types allowed: multiple-choice (4 options), true-false (options: ["True","False"] or ["Đúng","Sai"]).`;

  const text = await callGemini(prompt);
  const clean = text.replace(/```json|```/g, '').trim();

  try {
    const parsed = JSON.parse(clean);
    if (Array.isArray(parsed)) return parsed;
    throw new Error('Không phải array');
  } catch {
    const match = clean.match(/\[[\s\S]*\]/);
    if (match) {
      try { return JSON.parse(match[0]); } catch (e) { console.error('JSON parse error in match:', e); }
    }
    throw new Error('Không parse được dữ liệu từ AI — thử lại');
  }
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
  difficulty: string,
  language: string
): Promise<Question[]> {
  const lang = language === 'en' ? 'English' : 'Vietnamese';

  if (!content.trim()) {
    throw new Error('Nội dung trống — vui lòng nhập hoặc trích xuất nội dung trước');
  }

  const prompt = `You are an expert quiz generator. Analyze the following content and generate a comprehensive set of quiz questions based on it.

CONTENT:
${content}

REQUIREMENTS:
1. Analyze the content and identify all key concepts, facts, and arguments.
2. Generate exactly ${counts.multipleChoice} multiple-choice questions (if > 0).
3. Generate exactly ${counts.trueFalse} true/false questions (if > 0).
4. Generate exactly ${counts.essay} essay questions (if > 0).
5. DIFFICULTY LEVEL: ${difficulty} (easy = basic recall, medium = understanding & application, hard = analysis & evaluation)
6. Questions MUST be derived strictly from the provided content and match the specified difficulty.
7. Return ONLY a valid JSON array, no markdown, no extra text before/after.

Each question object:
{
  "type": "multiple-choice" | "true-false" | "essay",
  "text": "question text based on the content",
  "options": ["A", "B", "C", "D"] (for MC) OR ["Đúng", "Sai"] or ["True", "False"] (for TF),
  "correctAnswerIndex": number from 0 to 3 (MC) or 0 or 1 (TF),
  "explanation": "brief explanation why the correct answer is correct" (REQUIRED for MC and TF),
  "sampleAnswer": "comprehensive sample answer" (REQUIRED for essay)
}

RULES:
1. Questions MUST be strictly derived from the provided content.
2. For multiple-choice: provide exactly 4 distinct plausible options; only one is correct.
3. For true-false: use ["Đúng","Sai"] if language is Vietnamese, ["True","False"] if English.
4. correctAnswerIndex must match the position of the correct option in the options array (0-based).
5. Explanation must clearly explain why the correct answer is correct (2-3 sentences).
6. Essay: sampleAnswer should be a model answer.
7. ALL fields are required as specified.
8. Output must be valid JSON that can be parsed by JSON.parse().
9. Do not include any text outside the JSON array.
10. For language=${lang}, write questions and explanations in ${lang}.`;

  try {
    const text = await callGemini(prompt);
    const clean = text.replace(/```json|```/g, '').trim();

    try {
      const parsed = JSON.parse(clean);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // fall through to regex extraction
    }

    const match = clean.match(/\[[\s\S]*\]/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch (e) {
        console.error('JSON parse error in match:', e);
      }
    }

    throw new Error('Không parse được dữ liệu từ AI — thử lại');
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
    const text = await callGemini(prompt);
    const clean = text.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);
    if (typeof parsed.score === 'number') return parsed;
    throw new Error('invalid');
  } catch {
    return { score: 50, feedback: 'Không chấm được tự động. Vui lòng xem xét thủ công.' };
  }
}
