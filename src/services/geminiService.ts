/// <reference types="vite/client" />
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

  // Split content into chunks if too large (max ~8000 chars per request)
  const MAX_CHUNK_SIZE = 8000;
  let allQuestions: any[] = [];

  const processChunk = async (chunkContent: string, isRetry = false): Promise<any[]> => {
    let prompt;
    
    if (isRetry) {
      // Simplified prompt for retry
      prompt = `Parse quiz questions from this content. Return ONLY valid JSON array.

Content: ${chunkContent}

Find questions with format:
- Numbered: "1. A. ... B. ... C. ... D. ..."
- True/False: "True ____ False ____"

For each question return:
{
  "type": "multiple-choice" | "true-false",
  "text": "question text",
  "options": ["A","B","C","D"] or ["True","False"],
  "correctAnswerIndex": 0-3 (find markers: → [→text←] ____ checkmarks),
  "explanation": ""
}

Return ONLY JSON array starting with [ and ending with ]:`;
    } else {
      // Main detailed prompt
      prompt = `TASK: Copy ALL quiz questions from file to JSON. Keep original content exactly.

Content:
${chunkContent}

RULES:
1. Copy questions 1-to-1, do NOT rewrite or create new
2. Multiple-choice (A,B,C,D) → type: "multiple-choice"
3. True/False → type: "true-false"
4. Fill-in-blank (___) → type: "essay"
5. Process ALL questions, don't skip any
6. Find correct answers from: → [→word←] ____ ✓ [x] "Answer: B"

OUTPUT FORMAT - Return ONLY valid JSON array:
[{"type":"multiple-choice","text":"...","options":["A","B","C","D"],"correctAnswerIndex":0,"explanation":""}]`;
    }

    try {
      const text = await callGemini(prompt);
      console.log(`[AI Debug] Response length: ${text.length}, isRetry: ${isRetry}`);
      
      // Try to parse JSON
      let clean = text.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim();
      
      // Find JSON array
      const match = clean.match(/\[[\s\S]*\]/);
      if (match) clean = match[0];
      
      const parsed = JSON.parse(clean);
      if (Array.isArray(parsed)) return parsed;
      throw new Error('Not an array');
    } catch (e: any) {
      console.error(`[AI Debug] Parse failed${isRetry ? ' (retry)' : ''}:`, e.message);
      if (!isRetry) {
        console.log('[AI Debug] Retrying with simplified prompt...');
        return processChunk(chunkContent, true);
      }
      throw e;
    }
  };

  // Process content in chunks if too large
  if (content.length > MAX_CHUNK_SIZE) {
    const chunks = content.match(new RegExp(`.{1,${MAX_CHUNK_SIZE}}`, 'g')) || [content];
    console.log(`[AI Debug] Splitting content into ${chunks.length} chunks`);
    
    for (let i = 0; i < chunks.length; i++) {
      console.log(`[AI Debug] Processing chunk ${i + 1}/${chunks.length}`);
      const chunkQuestions = await processChunk(chunks[i]);
      allQuestions = [...allQuestions, ...chunkQuestions];
    }
  } else {
    allQuestions = await processChunk(content);
  }

  console.log(`[AI Debug] Total questions extracted: ${allQuestions.length}`);

  // Validate all questions
  const parsed = allQuestions;

  // Validate and filter questions
  const validQuestions = parsed.filter((q: any, idx: number) => {
    if (!q || typeof q !== 'object') {
      console.log(`[AI Debug] Item ${idx} invalid: not an object`);
      return false;
    }
    if (!q.type || !q.text) {
      console.log(`[AI Debug] Item ${idx} invalid: missing type or text`, q);
      return false;
    }
    if (q.type === 'multiple-choice') {
      const valid = Array.isArray(q.options) && q.options.length === 4 &&
             typeof q.correctAnswerIndex === 'number' &&
             q.correctAnswerIndex >= 0 && q.correctAnswerIndex <= 3;
      if (!valid) console.log(`[AI Debug] MC question ${idx} invalid:`, q.options, q.correctAnswerIndex);
      return valid;
    }
    if (q.type === 'true-false') {
      const valid = Array.isArray(q.options) && q.options.length === 2 &&
             typeof q.correctAnswerIndex === 'number' &&
             q.correctAnswerIndex >= 0 && q.correctAnswerIndex <= 1;
      return valid;
    }
    if (q.type === 'essay') {
      // Essay questions don't need sampleAnswer for parsing from file
      return true;
    }
    return false;
  });

  console.log(`[AI Debug] Valid questions: ${validQuestions.length}/${parsed.length}`);

  if (validQuestions.length === 0) {
    throw new Error('AI không trích xuất được câu hỏi hợp lệ nào. Vui lòng kiểm tra nội dung file.');
  }

  return validQuestions;
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
