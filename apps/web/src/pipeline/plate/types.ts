export interface PlateDetection {
  x: number;
  y: number;
  w: number;
  h: number;
  confidence: number;
}

export interface OcrResult {
  text: string;
  confidence: number;
}

export type OcrStatus = 'pending' | 'completed' | 'failed';
