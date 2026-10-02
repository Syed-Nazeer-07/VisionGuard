import type { Point } from '../types';

/**
 * Computes a 3x3 homography matrix mapping from source (image) to destination (world).
 * Solves using standard DLT for exactly 4 points.
 */
export function computeHomography(src: Point[], dst: Point[]): number[] | null {
  if (src.length !== 4 || dst.length !== 4) return null;

  // Build the 8x8 matrix A
  const A: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i];
    const { x: u, y: v } = dst[i];
    A.push([-x, -y, -1, 0, 0, 0, x * u, y * u, u]);
    A.push([0, 0, 0, -x, -y, -1, x * v, y * v, v]);
  }

  // Gaussian elimination to solve A * h = 0 with h_9 = 1
  // We can rewrite this as A' * h' = b
  // Where A' is 8x8, h' is 8x1 (h_1 to h_8), b is -h_9 col
  const M: number[][] = [];
  for (let i = 0; i < 8; i++) {
    const row = A[i].slice(0, 8);
    row.push(-A[i][8]); // b
    M.push(row);
  }

  // Basic row operations to solve M
  for (let i = 0; i < 8; i++) {
    // Find pivot
    let max = Math.abs(M[i][i]);
    let pivot = i;
    for (let j = i + 1; j < 8; j++) {
      if (Math.abs(M[j][i]) > max) {
        max = Math.abs(M[j][i]);
        pivot = j;
      }
    }

    if (max < 1e-10) return null; // Singular

    // Swap
    const temp = M[i];
    M[i] = M[pivot];
    M[pivot] = temp;

    // Eliminate
    for (let j = i + 1; j < 8; j++) {
      const f = M[j][i] / M[i][i];
      for (let k = i; k < 9; k++) {
        M[j][k] -= M[i][k] * f;
      }
    }
  }

  // Back substitution
  const h = new Array(8).fill(0);
  for (let i = 7; i >= 0; i--) {
    let sum = M[i][8];
    for (let j = i + 1; j < 8; j++) {
      sum -= M[i][j] * h[j];
    }
    h[i] = sum / M[i][i];
  }

  return [...h, 1]; // Return 3x3 matrix as flat array
}

export function projectPoint(h: number[], pt: Point): Point {
  const w = h[6] * pt.x + h[7] * pt.y + h[8];
  return {
    x: (h[0] * pt.x + h[1] * pt.y + h[2]) / w,
    y: (h[3] * pt.x + h[4] * pt.y + h[5]) / w,
  };
}
