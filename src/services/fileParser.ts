// File Parser Service - Extract text from .txt, .pdf, .docx files with color detection

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

function validateFile(file: File): void {
  if (file.size > MAX_FILE_SIZE) {
    throw new Error(`File quá lớn (tối đa 10MB). File hiện tại: ${(file.size / 1024 / 1024).toFixed(2)}MB`);
  }
}

// Interface for text with color information
export interface TextItem {
  text: string;
  isMarked?: boolean; // true if text has special color (red, blue, highlight)
  color?: string;
}

export async function parseTxt(file: File): Promise<string> {
  validateFile(file);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      const content = reader.result as string;
      if (!content || content.trim().length === 0) {
        reject(new Error('File text rỗng hoặc không đọc được nội dung.'));
        return;
      }
      resolve(content);
    };

    reader.onerror = () => {
      reject(new Error(`Không thể đọc file text: ${reader.error?.message || 'Lỗi không xác định'}`));
    };

    reader.onabort = () => {
      reject(new Error('Đọc file bị hủy.'));
    };

    try {
      reader.readAsText(file);
    } catch (error: any) {
      reject(new Error(`Lỗi khởi tạo đọc file: ${error.message}`));
    }
  });
}

// Simple RTF text extractor - removes RTF control words and extracts plain text
function extractRtfText(rtfContent: string): string {
  // Remove RTF header
  let text = rtfContent.replace(/\\rtf1?\s*/i, '');
  // Remove control words (\word, \word123, \*\word, etc.)
  text = text.replace(/\\[a-zA-Z]+\d*\s*/g, ' ');
  // Remove hex escaped chars (\'XX)
  text = text.replace(/\\'[0-9a-fA-F]{2}/g, '');
  // Remove braces
  text = text.replace(/[{}]/g, '');
  // Remove Unicode escapes (\uXXXX?)
  text = text.replace(/\\u\d+\?/g, '');
  // Clean up multiple spaces
  text = text.replace(/\s+/g, ' ').trim();
  return text;
}

export async function parseRtf(file: File): Promise<string> {
  validateFile(file);
  const text = await parseTxt(file);
  const extracted = extractRtfText(text);
  if (!extracted || extracted.length === 0) {
    throw new Error('Không thể trích xuất nội dung từ file RTF.');
  }
  return extracted;
}

// PDF.js worker - dùng legacy build để tránh lỗi ES module
let pdfjsInitialized = false;

async function initPdfjs() {
  if (pdfjsInitialized) return;

  const pdfjsLib = await import('pdfjs-dist');
  // Dùng legacy build (UMD) - hoạt động tốt trong mọi môi trường
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/5.6.205/pdf.worker.min.js`;
  pdfjsInitialized = true;
}

// Phân tích màu sắc của canvas để tìm text có màu đặc biệt
function analyzeCanvasColors(canvas: HTMLCanvasElement, textItems: any[]): string[] {
  const ctx = canvas.getContext('2d');
  if (!ctx) return textItems.map(item => item.str);

  const width = canvas.width;
  const height = canvas.height;
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;

  // Hàm kiểm tra xem pixel có phải màu đỏ (đáp án đúng thường màu đỏ)
  function isRedPixel(r: number, g: number, b: number, a: number): boolean {
    if (a < 128) return false; // Transparent
    // Màu đỏ: R cao, G thấp, B thấp
    return r > 150 && g < 100 && b < 100;
  }

  // Hàm kiểm tra màu xanh dương
  function isBluePixel(r: number, g: number, b: number, a: number): boolean {
    if (a < 128) return false;
    return b > 150 && r < 100 && g < 150;
  }

  // Hàm kiểm tra màu xanh lá (highlight)
  function isGreenPixel(r: number, g: number, b: number, a: number): boolean {
    if (a < 128) return false;
    return g > 150 && r < 150 && b < 150;
  }

  // Tạo map của các vùng có màu đặc biệt
  const markedRegions: { x: number; y: number; width: number; height: number; color: string }[] = [];

  // Scan canvas để tìm vùng có màu đặc biệt
  const blockSize = 10; // Kích thước block để scan
  for (let y = 0; y < height; y += blockSize) {
    for (let x = 0; x < width; x += blockSize) {
      const idx = (y * width + x) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      const a = data[idx + 3];

      if (isRedPixel(r, g, b, a)) {
        markedRegions.push({ x, y, width: blockSize, height: blockSize, color: 'red' });
      } else if (isBluePixel(r, g, b, a)) {
        markedRegions.push({ x, y, width: blockSize, height: blockSize, color: 'blue' });
      } else if (isGreenPixel(r, g, b, a)) {
        markedRegions.push({ x, y, width: blockSize, height: blockSize, color: 'green' });
      }
    }
  }

  // Kiểm tra từng text item xem có nằm trong vùng marked không
  return textItems.map((item: any) => {
    if (!item.transform) return item.str;

    const [scaleX, skewY, skewX, scaleY, translateX, translateY] = item.transform;
    const textX = translateX;
    const textY = translateY;
    const textWidth = item.width || 50;
    const textHeight = item.height || 20;

    // Kiểm tra xem text có nằm trong vùng marked không
    const isMarked = markedRegions.some(region => {
      return (
        textX < region.x + region.width &&
        textX + textWidth > region.x &&
        textY < region.y + region.height &&
        textY + textHeight > region.y
      );
    });

    // Nếu text được đánh dấu, thêm marker
    if (isMarked) {
      return `[→${item.str}←]`; // Marker đặc biệt cho AI nhận biết
    }
    return item.str;
  });
}

export async function parsePdf(file: File): Promise<string> {
  validateFile(file);

  // Initialize PDF.js worker (chỉ chạy một lần)
  await initPdfjs();
  const pdfjsLib = await import('pdfjs-dist');

  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({
    data: arrayBuffer,
    useSystemFonts: true,
  }).promise;

  const textParts: string[] = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);

    // Lấy text content
    const textContent = await page.getTextContent();

    // Render page thành canvas để phân tích màu sắc
    const viewport = page.getViewport({ scale: 2.0 }); // Scale cao để nhận diện tốt hơn
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d');

    if (ctx) {
      // Render PDF page lên canvas
      await page.render({
        canvasContext: ctx,
        viewport: viewport,
        canvas: canvas,
      } as any).promise;

      // Phân tích màu sắc và đánh dấu text có màu đặc biệt
      const markedTexts = analyzeCanvasColors(canvas, textContent.items);
      const pageText = markedTexts.join(' ');
      textParts.push(pageText);
    } else {
      // Fallback nếu không render được canvas
      const pageText = textContent.items.map((item) => ('str' in item ? item.str : '')).join(' ');
      textParts.push(pageText);
    }
  }

  return textParts.join('\n\n');
}

export async function parseDocx(file: File): Promise<string> {
  validateFile(file);
  try {
    const mammoth = await import('mammoth');
    const arrayBuffer = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer });

    // Kiểm tra nếu có lỗi conversion nhưng vẫn có kết quả
    if (result.messages && result.messages.length > 0) {
      console.warn('Mammoth warnings:', result.messages);
    }

    // Nếu không trích xuất được text
    if (!result.value || result.value.trim().length === 0) {
      throw new Error('Không thể trích xuất nội dung từ file .docx. File có thể bị lỗi hoặc không chứa text.');
    }

    return result.value;
  } catch (error: any) {
    if (error.message?.includes('Unexpected token')) {
      throw new Error('File .docx bị lỗi định dạng hoặc không phải file Word hợp lệ.');
    }
    throw new Error(`Lỗi đọc file .docx: ${error.message || 'Không xác định'}`);
  }
}

export async function extractTextFromFile(file: File): Promise<string> {
  const ext = file.name.split('.').pop()?.toLowerCase();

  switch (ext) {
    case 'txt':
    case 'md':
    case 'markdown':
      // Markdown files are text-based, can be read directly
      return parseTxt(file);
    case 'rtf':
      return parseRtf(file);
    case 'pdf':
      return parsePdf(file);
    case 'docx':
      return parseDocx(file);
    case 'doc':
      // .doc (old Word format) is NOT supported by mammoth
      throw new Error(`Định dạng .doc (Word 97-2003) không được hỗ trợ. Vui lòng lưu file thành .docx hoặc .pdf.`);
    default:
      throw new Error(`Định dạng không được hỗ trợ: .${ext}. Hỗ trợ: .txt, .md, .rtf, .pdf, .docx`);
  }
}
