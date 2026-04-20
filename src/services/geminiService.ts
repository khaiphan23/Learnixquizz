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

  const prompt = `🎯 BẠN LÀ PARSER/CONVERTER - KHÔNG PHẢI GENERATOR

NHIỆM VỤ: Sao chép 100% câu hỏi từ file vào hệ thống quiz, giữ nguyên nội dung gốc.

NỘI DUNG ĐẦU VÀO:
${content}

═══════════════════════════════════════════════════════════
📋 QUY TẮC TUYỆT ĐỐI - PHẢI TUÂN THỦ
═══════════════════════════════════════════════════════════

1. GIỮ NGUYÊN CÂU HỎI GỐC (ƯU TIÊN TUYỆT ĐỐI)
   ✓ Sao chép câu hỏi từ file 1-to-1, KHÔNG thay đổi nội dung
   ✓ KHÔNG được viết lại, diễn giải lại, hay tạo mới câu hỏi
   ✓ KHÔNG được thay đổi dạng câu hỏi (trắc nghiệm → tự luận hay ngược lại)

2. MAPPING VỀ 3 DẠNG HỆ THỐNG (chỉ khi cần thiết)
   • Trắc nghiệm (A,B,C,D) → type: "multiple-choice", giữ nguyên
   • Đúng/Sai (True/False) → type: "true-false", giữ nguyên  
   • Điền khuyết (Cloze) → type: "essay", giữ nguyên chỗ trống ___

3. XỬ LÝ 100% CÂU HỎI TRONG FILE
   ✓ Phải xử lý TẤT CẢ câu hỏi có trong tài liệu
   ✓ KHÔNG được bỏ sót câu nào
   ✓ KHÔNG dừng sớm vì bất kỳ lý do gì

4. KHÔNG TỰ TẠO THÊM CÂU HỎI
   ✓ Chỉ tạo thêm câu KHI VÀ CHỈ KHI file không có sẵn câu hỏi nào
   ✓ Câu tạo thêm phải phù hợp nội dung và thuộc 1 trong 3 dạng trên

5. NHẬN DIỆN ĐÁP ÁN ĐÚNG từ file:
   → Mũi tên "→" sau đáp án (ví dụ: "C. answer→")
   → Marker màu [→text←] từ PDF OCR
   → Gạch chân "____" sau True/False
   → Checkmark ✓, ✔, [v], [x] cạnh đáp án
   → Text "Answer: B" hoặc "Đáp án: C"
   → In đậm, màu sắc, highlight khác biệt

6. KHÔNG DÙNG KIẾN THỨC BẢN THÂN
   ✗ KHÔNG dùng kiến thức để quyết định đáp án đúng
   ✗ KHÔNG tự ý sửa lỗi trong câu hỏi gốc
   ✗ KHÔNG thêm giải thích ngoài nội dung file

═══════════════════════════════════════════════════════════
📤 ĐỊNH DẠNG ĐẦU RA (JSON Array)
═══════════════════════════════════════════════════════════

[
  {
    "type": "multiple-choice" | "true-false" | "essay",
    "text": "SAO CHÉP NGUYÊN VĂN câu hỏi từ file",
    "options": ["A", "B", "C", "D"] hoặc ["True", "False"] hoặc ["Đúng", "Sai"],
    "correctAnswerIndex": 0-3 (dựa TRÊN MARKER trong file, KHÔNG dùng kiến thức),
    "explanation": "Giải thích có trong file (nếu có), hoặc để trống"
  }
]

⚠️ QUAN TRỌNG: Nếu KHÔNG tìm thấy marker rõ ràng → đặt correctAnswerIndex: 0 và explanation: "Vui lòng kiểm tra lại đáp án"

═══════════════════════════════════════════════════════════
OUTPUT - Chỉ trả về JSON array hợp lệ, bắt đầu bằng [ và kết thúc bằng ]:`;

  console.log('[AI Debug] Prompt length:', prompt.length, 'Content preview:', content.substring(0, 200));

  console.log('[AI Debug] Sending prompt to Gemini...');

  try {
    const text = await callGemini(prompt);
    console.log('[AI Debug] Raw response length:', text.length);
    console.log('[AI Debug] Raw response preview:', text.substring(0, 800));

    // Try multiple parsing strategies
    let parsed: any = null;
    let parseErrors: string[] = [];

    // Strategy 1: Direct JSON parse after removing markdown
    let clean = text.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim();
    try {
      parsed = JSON.parse(clean);
      console.log('[AI Debug] Strategy 1 success - direct parse');
    } catch (e: any) {
      parseErrors.push('Direct parse: ' + e.message);
    }

    // Strategy 2: Extract JSON array from text
    if (!parsed) {
      const match = clean.match(/\[[\s\S]*\]/);
      if (match) {
        try {
          parsed = JSON.parse(match[0]);
          console.log('[AI Debug] Strategy 2 success - array extraction');
        } catch (e: any) {
          parseErrors.push('Array extraction: ' + e.message);
        }
      }
    }

    // Strategy 3: Find objects between brackets
    if (!parsed) {
      const match = clean.match(/\{[\s\S]*?\}/g);
      if (match && match.length > 0) {
        try {
          const wrapped = '[' + match.join(',') + ']';
          parsed = JSON.parse(wrapped);
          console.log('[AI Debug] Strategy 3 success - object wrapping');
        } catch (e: any) {
          parseErrors.push('Object wrapping: ' + e.message);
        }
      }
    }

    // Strategy 4: Manual line-by-line parsing for simple objects
    if (!parsed) {
      const lines = clean.split('\n').filter(l => l.trim());
      const objects: any[] = [];
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
          try {
            objects.push(JSON.parse(trimmed));
          } catch {}
        }
      }
      if (objects.length > 0) {
        parsed = objects;
        console.log('[AI Debug] Strategy 4 success - line parsing');
      }
    }

    if (!parsed || !Array.isArray(parsed)) {
      console.error('[AI Debug] All parse strategies failed:', parseErrors);
      console.error('[AI Debug] Final clean text:', clean.substring(0, 1000));
      throw new Error('Không thể phân tích câu trả lời từ AI. Định dạng không hợp lệ.');
    }

    console.log(`[AI Debug] Successfully parsed ${parsed.length} items`);

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
        return q.sampleAnswer && typeof q.sampleAnswer === 'string';
      }
      return false;
    });

    console.log(`[AI Debug] Valid questions: ${validQuestions.length}/${parsed.length}`);

    if (validQuestions.length === 0) {
      throw new Error('AI không trích xuất được câu hỏi hợp lệ nào. Vui lòng kiểm tra nội dung file.');
    }

    return validQuestions;
  } catch (error: any) {
    console.error('[AI Debug] Error:', error.message);
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
