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
  language: string
): Promise<Question[]> {
  const lang = language === 'en' ? 'English' : 'Vietnamese';

  if (!content.trim()) {
    throw new Error('Nội dung trống — vui lòng nhập hoặc trích xuất nội dung trước');
  }

  const prompt = `You are an expert quiz parser. Extract ALL quiz questions from the following educational content.

INPUT CONTENT:
${content}

EXTRACTION RULES:
1. Look for numbered questions (1., 2., 3., etc.) or lettered questions
2. Identify question types:
   - MULTIPLE-CHOICE: Has options A, B, C, D (or a, b, c, d). Extract all 4 options.
   - TRUE-FALSE: Contains "True/False" or "Đúng/Sai" or asks to identify T/F
   - ESSAY: Open-ended questions requiring paragraph answers

3. CRITICAL - Find the CORRECT ANSWER:
   - Look for answer markers AFTER the question: "True ____", "False _____", "A.", "B.", "C.", "D."
   - Check for checkmarks (✓, ✔, [x], [X]) next to options
   - Look for "Answer: X" or "Đáp án: X" near the question
   - Look for bold/italic formatting on correct option
   - Example: "1. What is...? A. X B. Y C. Z D. W Answer: B"
   - Example: "True _____ False _____" (mark which one is checked)

4. For each question found, create an object with:
   - "text": the question text (clean, without option letters)
   - "type": "multiple-choice", "true-false", or "essay"
   - "options": array of strings ["A", "B", "C", "D"] or ["True", "False"] or ["Đúng", "Sai"]
   - "correctAnswerIndex": 0, 1, 2, or 3 (0=A/True/Đúng, 1=B/False/Sai, etc.)
   - "explanation": brief explanation (1-2 sentences why this is correct)

5. For ESSAY questions:
   - "sampleAnswer": provide a comprehensive model answer based on the content

OUTPUT FORMAT:
Return a JSON array. Example structure:
[
  {"type": "multiple-choice", "text": "What is...?", "options": ["A", "B", "C", "D"], "correctAnswerIndex": 1, "explanation": "B is correct because..."},
  {"type": "true-false", "text": "Statement...", "options": ["True", "False"], "correctAnswerIndex": 0, "explanation": "True because..."}
]

CRITICAL RULES:
1. Return ONLY a valid JSON array - no markdown code blocks, no explanations before or after
2. The response must start with [ and end with ]
3. Every question object must have ALL required fields
4. For multiple-choice: options array must have exactly 4 items (A, B, C, D), correctAnswerIndex must be 0-3
5. For true-false: options must be ["Đúng", "Sai"] for Vietnamese or ["True", "False"] for English, correctAnswerIndex 0 or 1
6. For essay: sampleAnswer must be a complete model answer, not empty
7. Use ${lang} language for output`;

  console.log('[AI Debug] Sending prompt to Gemini...');

  try {
    const text = await callGemini(prompt);
    console.log('[AI Debug] Raw response:', text.substring(0, 500) + '...');

    // Remove markdown code blocks
    let clean = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();

    // Find JSON array
    const match = clean.match(/\[[\s\S]*\]/);
    if (match) {
      clean = match[0];
    }

    console.log('[AI Debug] Cleaned JSON:', clean.substring(0, 500) + '...');

    try {
      const parsed = JSON.parse(clean);
      if (Array.isArray(parsed)) {
        console.log(`[AI Debug] Successfully parsed ${parsed.length} questions`);
        // Validate each question
        const validQuestions = parsed.filter((q: any) => {
          if (!q.type || !q.text) return false;
          if (q.type === 'multiple-choice' || q.type === 'true-false') {
            return Array.isArray(q.options) && q.options.length >= 2 &&
                   typeof q.correctAnswerIndex === 'number';
          }
          if (q.type === 'essay') {
            return q.sampleAnswer && q.sampleAnswer.trim().length > 0;
          }
          return false;
        });
        console.log(`[AI Debug] Valid questions: ${validQuestions.length}/${parsed.length}`);
        return validQuestions;
      }
    } catch (e) {
      console.error('[AI Debug] JSON parse error:', e);
      console.error('[AI Debug] Failed to parse:', clean.substring(0, 1000));
    }

    throw new Error('AI trả về dữ liệu không đúng định dạng. Vui lòng thử lại.');
  } catch (error: any) {
    console.error('[AI Debug] Error:', error);
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
