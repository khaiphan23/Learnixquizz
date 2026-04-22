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

  // Split content into chunks - smaller chunks for better accuracy
  const MAX_CHUNK_SIZE = 3000; // Reduced from 8000 to ensure all questions processed
  let allQuestions: any[] = [];
  
  // Count expected questions in content
  const questionMatches = content.match(/^(?:Câu\s+|)\d+[.\)]/gim) || [];
  const expectedQuestionCount = questionMatches.length;
  console.log(`[AI Debug] Expected questions in content: ${expectedQuestionCount}`);

  // Escape special characters for JSON safety
  const escapeForJson = (str: string): string => {
    return str
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/\t/g, '\\t');
  };

  // Try to repair malformed JSON from AI
  const repairJson = (str: string): string => {
    // Remove control characters
    str = str.replace(/[\x00-\x1F\x7F-\x9F]/g, '');
    // Fix trailing commas
    str = str.replace(/,\s*([}\]])/g, '$1');
    // Fix missing quotes around property names
    str = str.replace(/(\{|,\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '$1"$2":');
    return str;
  };

  const processChunk = async (chunkContent: string, isRetry = false, attempt = 0): Promise<any[]> => {
    const safeContent = escapeForJson(chunkContent);
    let prompt;
    
    if (attempt >= 2) {
      // Last resort - extremely simple prompt
      prompt = `Extract quiz questions. Return JSON array only.

Text: ${safeContent.substring(0, 4000)}

Format: [{"type":"multiple-choice","text":"Q","options":["A","B","C","D"],"correctAnswerIndex":0,"explanation":""}]

JSON:`;
    } else if (isRetry) {
      prompt = `Trích xuất câu hỏi từ nội dung. Trả về JSON array.

Nội dung: ${safeContent.substring(0, 5000)}

Tìm tất cả câu có đánh số (1., 2., Câu 1, Câu 2) và options A,B,C,D.

Format:
[{"type":"multiple-choice","text":"1. Câu hỏi","options":["A...","B...","C...","D..."],"correctAnswerIndex":0,"explanation":""}]

Lưu ý:
- Giữ nguyên thứ tự
- Không bỏ sót câu nào
- JSON hợp lệ, không trailing commas`;
    } else {
      prompt = `Bạn là hệ thống AI chuyên trích xuất câu hỏi quiz từ tài liệu. Nhiệm vụ: phân tích và chuyển đổi thành JSON, KHÔNG thay đổi nội dung gốc.

========================
YÊU CẦU NGHIÊM NGẶT
========================

1. GIỮ NGUYÊN NỘI DUNG 100%
- KHÔNG chỉnh sửa, viết lại, tóm tắt câu hỏi hay đáp án
- Giữ NGUYÊN VĂN (dấu câu, ký tự, thứ tự)
- KHÔNG thay đổi thứ tự câu hỏi

2. NHẬN DIỆN TẤT CẢ CÂU HỎI - KHÔNG BỎ SÓT
Nhận diện câu hỏi dựa trên:
- Đánh số: 1, 2, 3, ... hoặc Câu 1, Câu 2...
- Có options A, B, C, D
- Có dấu hiệu xuống dòng và bullet point

QUY TẮC VỀ SỐ THỨ TỰ:
- CÓ THỂ có nhiều câu cùng số (do lỗi format)
- KHÔNG được xóa hoặc gộp câu dù số trùng
- Giữ đầy đủ TẤT CẢ câu theo thứ tự xuất hiện

3. PHÂN LOẠI CÂU HỎI
A. "multiple-choice": Có options A, B, C, D
B. "true-false": Có Đúng/Sai, True/False
C. "essay": Không có options, yêu cầu trả lời tự do (có ___ hoặc "trình bày")

4. NHẬN DIỆN ĐÁP ÁN (TỪ FILE - KHÔNG ĐOÁN)
Ưu tiên 1: Có "Đáp án:", "Answer:", "→text←", "____"
Ưu tiên 2: Có (*), ✔, ✓ trước option
Ưu tiên 3: Option có format khác (in đậm/nghiêng)
Nếu không tìm thấy → correctAnswerIndex: 0

5. KHÔNG SUY ĐOÁN
- KHÔNG tự tạo đáp án
- KHÔNG dùng kiến thức cá nhân

========================
NỘI DUNG FILE:
========================
${safeContent}

========================
OUTPUT FORMAT (JSON ARRAY):
========================
[
  {"type":"multiple-choice","text":"1. Câu hỏi","options":["A...","B...","C...","D..."],"correctAnswerIndex":0,"explanation":""},
  {"type":"essay","text":"Câu 2. Trình bày...","options":[],"correctAnswerIndex":0,"explanation":""}
]

⚠️ BẮT BUỘC:
1. Trích xuất TẤT CẢ câu hỏi (đếm và kiểm tra)
2. Nếu có 30 câu → trả về 30 objects
3. Giữ nguyên thứ tự xuất hiện trong file
4. KHÔNG bỏ sót câu cuối cùng`;
    }

    try {
      const text = await callGemini(prompt);
      console.log(`[AI Debug] Response length: ${text.length}, attempt: ${attempt}, isRetry: ${isRetry}`);
      
      // Clean and repair JSON
      let clean = text.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim();
      clean = repairJson(clean);
      
      // Find JSON array
      const match = clean.match(/\[[\s\S]*\]/);
      if (match) clean = match[0];
      
      const parsed = JSON.parse(clean);
      if (Array.isArray(parsed)) return parsed;
      throw new Error('Not an array');
    } catch (e: any) {
      console.error(`[AI Debug] Parse failed (attempt ${attempt}):`, e.message);
      
      if (attempt < 2) {
        console.log(`[AI Debug] Retrying with simpler prompt (attempt ${attempt + 1})...`);
        return processChunk(chunkContent, true, attempt + 1);
      }
      
      // Last resort: try to extract individual questions
      console.log('[AI Debug] Trying emergency extraction...');
      return extractQuestionsManually(chunkContent);
    }
  };

  // Emergency manual extraction if AI completely fails - keeps original order
  const extractQuestionsManually = (text: string): any[] => {
    const questions: any[] = [];
    const lines = text.split('\n');
    let currentQuestion: any = null;
    let currentQuestionNum = 0;
    let optionCount = 0;
    let linesAfterQuestion = 0;
    
    // Header patterns to skip
    const headerPatterns = [
      /^(test\s+\d+|keys?|pronunciation|vocabulary|grammar|reading|writing|error\s+correction|matching|open\s+cloze|iii?\.|iv\.|v\.)/i,
      /^(choose\s+the\s+(word|best))/i,
      /^(read\s+the\s+(text|passage|following))/i,
      /^(a\.\s*choose|b\.\s*choose)/i,
      /^(kiến\s+thức|cần\s+nhớ|kiến\s+thức\s+cần\s+nhớ)/i,
      /^(phần\s+tự\s+luận|phần\s+trắc\s+nghiệm|bài\s+tự\s+luận)/i,
      /^(ôn\s+thường\s+xuyên|ôn\s+tập|đề\s+cương)/i,
      /^(khtn|toán|lý|hóa|sinh|sử|địa|anh\s*văn)/i
    ];

    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      if (!trimmed || trimmed.length < 3) continue;
      
      // Skip headers/section titles
      if (headerPatterns.some(p => p.test(trimmed))) {
        console.log(`[Manual Extract] Skipping header: ${trimmed.substring(0, 50)}`);
        continue;
      }
      
      // Match numbered question (1. 2. 3. or Câu 1. Câu 2.) - must be at start
      const qMatch = trimmed.match(/^(?:Câu\s+)?(\d+)[.\)]\s*(.+)/i);
      if (qMatch) {
        const questionNum = parseInt(qMatch[1]);
        const questionText = qMatch[2].trim();
        
        // Save previous question if valid (has options OR is essay type)
        if (currentQuestion) {
          if (currentQuestion.options.length >= 2) {
            // Multiple choice
            questions.push(currentQuestion);
          } else if (currentQuestion.options.length === 0 && linesAfterQuestion > 0) {
            // Essay - no options but has content after
            currentQuestion.type = 'essay';
            questions.push(currentQuestion);
          }
        }
        
        // Start new question
        currentQuestionNum = questionNum;
        currentQuestion = {
          type: 'multiple-choice', // Default, will change to essay if no options found
          text: trimmed, // Keep full text including number
          options: [],
          correctAnswerIndex: 0,
          explanation: '',
          _questionNum: questionNum // Keep track for ordering
        };
        optionCount = 0;
        linesAfterQuestion = 0;
        continue;
      }
      
      // Match option A. B. C. D. - only if we have a current question
      const optMatch = trimmed.match(/^([A-D])[.\)]\s*(.+)/);
      if (optMatch && currentQuestion) {
        const optionText = optMatch[2].trim();
        currentQuestion.options.push(optionText);
        linesAfterQuestion++;
        
        // Check for answer markers in option
        if (optionText.includes('→') || optionText.includes('[→') || 
            optionText.includes('____') || /\b(answer|đáp án)\s*[:=]\s*[A-D]\b/i.test(trimmed)) {
          currentQuestion.correctAnswerIndex = optionCount;
          console.log(`[Manual Extract] Q${currentQuestionNum}: Found marker at option ${optMatch[1]}`);
        }
        optionCount++;
      } else if (currentQuestion && !optMatch) {
        // Content after question but not an option - could be continuation
        linesAfterQuestion++;
      }
    }
    
    // Add last question
    if (currentQuestion) {
      if (currentQuestion.options.length >= 2) {
        questions.push(currentQuestion);
      } else if (currentQuestion.options.length === 0) {
        // Essay type
        currentQuestion.type = 'essay';
        questions.push(currentQuestion);
      }
    }
    
    // Sort by question number to ensure order
    questions.sort((a, b) => (a._questionNum || 0) - (b._questionNum || 0));
    
    // Remove internal tracking field
    questions.forEach(q => delete q._questionNum);
    
    console.log(`[AI Debug] Manual extraction: Found ${questions.length} questions (${questions.filter(q => q.type === 'essay').length} essay, ${questions.filter(q => q.type === 'multiple-choice').length} MC)`);
    return questions;
  };

  // Smart chunking - split by question numbers to avoid cutting questions
  const splitByQuestions = (text: string, maxSize: number): string[] => {
    const chunks: string[] = [];
    let currentChunk = '';
    
    // Find all question boundaries (lines starting with number)
    const lines = text.split('\n');
    let lastQuestionIndex = 0;
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Check if this is a new question (starts with number)
      if (/^\d+[.\)]/.test(line.trim())) {
        // If current chunk is getting too big, save it and start new
        if (currentChunk.length > maxSize && lastQuestionIndex > 0) {
          chunks.push(currentChunk.trim());
          // Keep last few lines for context in next chunk
          const contextLines = lines.slice(Math.max(0, lastQuestionIndex - 3), i);
          currentChunk = contextLines.join('\n') + '\n';
        }
        lastQuestionIndex = i;
      }
      currentChunk += line + '\n';
    }
    
    // Add remaining content
    if (currentChunk.trim()) {
      chunks.push(currentChunk.trim());
    }
    
    return chunks.length > 0 ? chunks : [text];
  };

  // Process content
  let chunks: string[];
  if (content.length > MAX_CHUNK_SIZE) {
    chunks = splitByQuestions(content, MAX_CHUNK_SIZE);
    console.log(`[AI Debug] Smart splitting: ${chunks.length} chunks (by questions)`);
  } else {
    chunks = [content];
  }
  
  for (let i = 0; i < chunks.length; i++) {
    console.log(`[AI Debug] Processing chunk ${i + 1}/${chunks.length} (${chunks[i].length} chars)`);
    const chunkQuestions = await processChunk(chunks[i]);
    allQuestions = [...allQuestions, ...chunkQuestions];
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

  // Sort by question number to maintain original order
  const sortedQuestions = validQuestions.sort((a: any, b: any) => {
    // Try to extract question number from text
    const numA = parseInt(a.text?.match(/^\d+/)?.[0] || '0');
    const numB = parseInt(b.text?.match(/^\d+/)?.[0] || '0');
    return numA - numB;
  });

  console.log(`[AI Debug] Returning ${sortedQuestions.length} questions in original order`);
  return sortedQuestions;
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
