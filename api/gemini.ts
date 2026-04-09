import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(request: VercelRequest, response: VercelResponse) {
  try {
    const { prompt } = request.body;

    if (!prompt) {
      return response.status(400).json({ error: 'Prompt là bắt buộc' });
    }

    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

    if (!GEMINI_API_KEY) {
      console.error('[Gemini API] Thiếu GEMINI_API_KEY');
      return response.status(500).json({ error: 'Server configuration error' });
    }

    // Cập nhật các model thế hệ 2.0 mới nhất (tháng 4/2026)
    const MODELS = [
      'gemini-2.0-flash',
      'gemini-2.0-flash-lite-preview',
      'gemini-2.0-pro-exp',
    ];

    let lastError = '';

    for (const model of MODELS) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000);

        const res = await fetch(url, {
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

        if (!res.ok) {
          const errorText = await res.text();
          console.error(`[Gemini API] Model ${model} error:`, res.status, errorText);
          lastError = `${model}: ${res.status}`;
          continue;
        }

        const data = await res.json();
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;

        if (text) {
          return response.status(200).json({ text });
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

    return response.status(500).json({ error: `Không thể kết nối Gemini API: ${lastError}` });

  } catch (error: any) {
    console.error('[Gemini API] Unexpected error:', error);
    return response.status(500).json({ error: 'Internal server error' });
  }
}
