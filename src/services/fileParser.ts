// File Parser Service - Extract text from .txt, .pdf, .docx files

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

// Worker singleton - chỉ cấu hình một lần
let pdfjsInitialized = false;

async function initPdfjs() {
  if (pdfjsInitialized) return;

  const pdfjsLib = await import('pdfjs-dist');
  // Sử dụng CDN worker - ổn định cho cả local và production
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/5.6.205/pdf.worker.min.mjs`;
  pdfjsInitialized = true;
}

export async function parsePdf(file: File): Promise<string> {
  validateFile(file);

  // Initialize PDF.js worker (chỉ chạy một lần)
  await initPdfjs();
  const pdfjsLib = await import('pdfjs-dist');

  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({
    data: arrayBuffer,
  }).promise;

  const textParts: string[] = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const pageText = textContent.items.map((item) => ('str' in item ? item.str : '')).join(' ');
    textParts.push(pageText);
  }

  return textParts.join('\n\n');
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
    case 'txt':
      return parseTxt(file);
    case 'pdf':
      return parsePdf(file);
    case 'docx':
    case 'doc':
      return parseDocx(file);
    default:
      throw new Error(`Định dạng không được hỗ trợ: .${ext}. Hỗ trợ: .txt, .pdf, .docx`);
  }
}
