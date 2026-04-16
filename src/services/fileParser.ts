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

  // FIX: Khởi tạo worker đúng cách cho pdfjs-dist v5.x
  // Thay vì fetch blob từ CDN (dễ bị CORS/CSP block), dùng cdnjs trực tiếp
  // hoặc dùng import.meta.url pattern cho Vite
  const pdfjsLib = await import('pdfjs-dist');

  // Cách 1: Dùng worker từ CDN cdnjs (được phép trong Vercel)
  // Phải set TRƯỚC khi gọi getDocument()
  const workerVersion = pdfjsLib.version;
  const workerSrcCDN = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${workerVersion}/pdf.worker.min.mjs`;

  try {
    // Thử set worker qua URL trực tiếp (không cần fetch blob)
    // pdfjs-dist v4+ hỗ trợ URL string trực tiếp
    pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrcCDN;
  } catch {
    // Fallback: dùng fake worker (chạy chậm hơn nhưng không cần worker thread)
    pdfjsLib.GlobalWorkerOptions.workerSrc = '';
  }

  let pdf;
  try {
    const arrayBuffer = await file.arrayBuffer();
    pdf = await pdfjsLib.getDocument({
      data: arrayBuffer,
      // Tắt worker nếu set workerSrc thất bại — chạy trong main thread
      useWorkerFetch: false,
      isEvalSupported: false,
    }).promise;
  } catch (err: any) {
    // Nếu worker lỗi, thử lại với disableWorker
    console.warn('[parsePdf] Worker init failed, retrying without worker:', err.message);
    try {
      pdfjsLib.GlobalWorkerOptions.workerSrc = '';
      const arrayBuffer = await file.arrayBuffer();
      pdf = await pdfjsLib.getDocument({
        data: arrayBuffer,
        useWorkerFetch: false,
        isEvalSupported: false,
      }).promise;
    } catch (err2: any) {
      throw new Error(`Không thể đọc PDF: ${err2.message}`);
    }
  }

  const textParts: string[] = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const pageText = textContent.items
      .map((item) => ('str' in item ? item.str : ''))
      .join(' ');
    textParts.push(pageText);
  }

  const result = textParts.join('\n\n').trim();

  if (!result) {
    throw new Error(
      'PDF này không chứa text có thể trích xuất (có thể là PDF scan/ảnh). ' +
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
