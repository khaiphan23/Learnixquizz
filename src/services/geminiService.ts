import { Question, EssayGrade } from '../types';

const GEMINI_API_KEY =
  (import.meta.env.VITE_GEMINI_API_KEY ||
    (typeof process !== 'undefined' ? process.env.GEMINI_API_KEY : '')) as string;

const USE_API_ROUTE = typeof window !== 'undefined' && window.location.hostname !== 'localhost';

async function callGemini(prompt: string): Promise<string> {
  // Nếu đang chạy trên Vercel (production), dùng API route
  if (USE_API_ROUTE) {
    try {
      const response = await fetch('/api/gemini', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'API request failed');
      }

      return data.text;
    } catch (error: any) {
      throw new Error(`Lỗi API: ${error.message}`);
    }
  }

  // Local development - gọi trực tiếp
  if (!GEMINI_API_KEY) {
    throw new Error('Thiếu VITE_GEMINI_API_KEY — vui lòng kiểm tra biến môi trường');
  }

  const MODELS = [
    'gemini-3.1-flash-lite-preview',
    'gemini-2.5-flash',
    'gemini-2.0-flash',
  ];

  let lastError = '';

  for (const model of MODELS) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000); // 30s timeout

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
