import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const { prompt } = await request.json();

    if (!prompt) {
      return NextResponse.json(
        { error: 'Prompt là bắt buộc' },
        { status: 400 }
      );
    }

    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

    if (!GEMINI_API_KEY) {
      console.error('[Gemini API] Thiếu GEMINI_API_KEY');
      return NextResponse.json(
        { error: 'Server configuration error' },
        { status: 500 }
      );
    }

    // Thử nhiều model để tăng độ tin cậy
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
        const timeoutId = setTimeout(() => controller.abort(), 30000);

        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 0.7,
              maxOutputTokens: 2048,
            },
          }),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          const errorText = await response.text();
          console.error(`[Gemini API] Model ${model} error:`, response.status, errorText);
          lastError = `${model}: ${response.status}`;

          if (response.status === 429) {
            // Rate limit - thử model khác
            continue;
          }
          if (response.status === 404) {
            // Model không tồn tại - thử model khác
            continue;
          }
          // Lỗi khác - thử model khác
          continue;
        }

        const data = await response.json();
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;

        if (text) {
          return NextResponse.json({ text });
        }

        lastError = `${model}: response không hợp lệ`;
      } catch (error: any) {
        if (error.name === 'AbortError') {
          lastError = `${model}: timeout`;
          continue;
        }
        console.error(`[Gemini API] Model ${model} exception:`, error.message);
        lastError = `${model}: ${error.message}`;
      }
    }

    // Nếu tất cả models đều fail
    return NextResponse.json(
      { error: `Không thể kết nối Gemini API: ${lastError}` },
      { status: 500 }
    );

  } catch (error: any) {
    console.error('[Gemini API] Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
