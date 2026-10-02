import type { OcrResult } from './types';

const OCR_ENDPOINT = import.meta.env.VITE_OCR_ENDPOINT || 'http://localhost:8000/ocr';

export async function requestOcr(base64Image: string, maxRetries = 3): Promise<OcrResult> {
  let attempt = 0;
  
  while (attempt < maxRetries) {
    try {
      // Setup AbortController for timeout (e.g. 10s)
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      const response = await fetch(OCR_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ image: base64Image }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      
      if (!data.text || typeof data.confidence !== 'number') {
        throw new Error('Empty or invalid OCR response');
      }
      
      if (data.confidence < 0 || data.confidence > 1) {
        throw new Error('Invalid confidence values');
      }

      return {
        text: data.text,
        confidence: data.confidence
      };

    } catch (error: any) {
      attempt++;
      console.warn(`OCR attempt ${attempt} failed: ${error.message}`);
      
      if (attempt >= maxRetries) {
        throw new Error(`OCR failed after ${maxRetries} attempts: ${error.message}`);
      }
      
      // Exponential backoff
      await new Promise(res => setTimeout(res, 1000 * Math.pow(2, attempt - 1)));
    }
  }
  
  throw new Error('OCR completely failed');
}
