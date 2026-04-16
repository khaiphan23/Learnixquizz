// src/services/fileParser.ts
// FIX BUG 3: PDF.js worker — dùng Vite asset URL thay vì fetch CDN blob

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

function validateFile(file: File): void {
  if (file.size > MAX_FILE_SIZE) {
    throw new Error(`File quá lớn (tối đa 10MB). File hiện tại: ${(file.size / 1024 / 1024).toFixed(2)}MB`);
  }
}

export async function parseTxt(file: File): Promise<string> {
  validateFile(file);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Không thể đọc file txt'));
    reader.readAsText(file);
  });
}

export async function parsePdf(file: File): Promise<string> {
  validateFile(file);

  // FIX: Import pdfjs và worker đúng chuẩn Vite
  // Vite sẽ bundle pdf.worker.min.mjs vào /assets/ khi build
  // Không cần fetch CDN → không bị CORS/CSP → chạy được cả local + Vercel
  const pdfjsLib = await import('pdfjs-dist');

  // ?url → Vite trả về URL tuyệt đối của file worker đã được copy vào /assets/
  const { default: workerUrl } = await import(
    'pdfjs-dist/build/pdf.worker.min.mjs?url'
  );

  // Bắt buộc set TRƯỚC khi gọi getDocument()
  pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

  const arrayBuffer = await file.arrayBuffer();

  let pdf;
  try {
    pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  } catch (err: any) {
    throw new Error(`Không thể parse PDF: ${err.message}`);
  }

  const textParts: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const pageText = textContent.items
      .map((item: any) => ('str' in item ? item.str : ''))
      .join(' ');
    textParts.push(pageText);
  }

  const result = textParts.join('\n\n').trim();
  if (!result) {
    throw new Error(
      'PDF này không chứa text (có thể là file scan/ảnh). ' +
      'Vui lòng dán text thủ công hoặc dùng file .txt/.docx.'
    );
  }

  return result;
}

export async function parseDocx(file: File): Promise<string> {
  validateFile(file);
  const mammoth = await import('mammoth');
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer });
  return result.value;
}

export async function extractTextFromFile(file: File): Promise<string> {
  const ext = file.name.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'txt':  return parseTxt(file);
    case 'pdf':  return parsePdf(file);
    case 'docx':
    case 'doc':  return parseDocx(file);
    default:
      throw new Error(`Định dạng không được hỗ trợ: .${ext}. Hỗ trợ: .txt, .pdf, .docx`);
  }
}
