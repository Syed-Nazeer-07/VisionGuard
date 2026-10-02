

export interface ScoringFactors {
  detectionConfidence: number;
  visibleArea: number; // normalized area (w * h)
  hasPlate: boolean;
  blurScore?: number; // 0 (blurry) to 1 (sharp)
}

export function evaluateEvidence(factors: ScoringFactors): number {
  let score = 0;
  
  // Base score from detection confidence
  score += factors.detectionConfidence * 40;
  
  // Score from size/area (larger is usually better resolution for crops)
  // Max out at around 30% of screen area
  const areaScore = Math.min(factors.visibleArea / 0.3, 1) * 30;
  score += areaScore;
  
  // Bonus for having a plate visible
  if (factors.hasPlate) {
    score += 20;
  }
  
  // Blur score (if available)
  if (factors.blurScore !== undefined) {
    score += factors.blurScore * 10;
  } else {
    score += 5; // average if unknown
  }
  
  return score;
}
