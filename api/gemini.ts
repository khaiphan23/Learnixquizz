import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(request: VercelRequest, response: VercelResponse) {
  try {
    const { prompt, json: wantJson } = request.body as { prompt?: string; json?: boolean };

    if (!prompt) {
      return response.status(400).json({ error: 'Prompt là bắt buộc' });
    }

    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

    if (!GEMINI_API_KEY) {
      console.error('[Gemini API] Thiếu GEMINI_API_KEY');
      return response.status(500).json({ error: 'Server configuration error' });
    }

    // Sử dụng chính xác danh sách model theo yêu cầu của người dùng
    const MODELS = [
      'gemini-3.1-pro',
      'gemini-3-flash',
      'gemini-3-flash-lite',
      'gemini-2.5-flash',
      'gemini-2.5-flash-lite',
      'gemini-2.5-pro',
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
              maxOutputTokens: 8192,
              ...(wantJson ? { responseMimeType: 'application/json' as const } : {}),
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
