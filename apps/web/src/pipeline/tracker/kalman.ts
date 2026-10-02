// Lightweight 1D Kalman Filter for bounding boxes to avoid matrix library dependency
export class KalmanFilter {
  private x: number[]; // [cx, cy, w, h, dx, dy, dw, dh]
  private p: number[]; // covariance diagonal

  constructor(cx: number, cy: number, w: number, h: number) {
    this.x = [cx, cy, w, h, 0, 0, 0, 0];
    this.p = [10, 10, 10, 10, 1000, 1000, 1000, 1000]; // Initial uncertainty
  }

  predict() {
    // x = F * x
    this.x[0] += this.x[4];
    this.x[1] += this.x[5];
    this.x[2] += this.x[6];
    this.x[3] += this.x[7];

    // P = F * P * F^T + Q
    // Q (Process noise)
    const q = [1, 1, 1, 1, 0.01, 0.01, 0.01, 0.01];
    
    // P prediction is simplified for diagonal matrix
    this.p[0] += this.p[4] + q[0];
    this.p[1] += this.p[5] + q[1];
    this.p[2] += this.p[6] + q[2];
    this.p[3] += this.p[7] + q[3];
    
    this.p[4] += q[4];
    this.p[5] += q[5];
    this.p[6] += q[6];
    this.p[7] += q[7];
  }

  update(cx: number, cy: number, w: number, h: number) {
    // Measurement noise R
    const r = [10, 10, 10, 10];
    const z = [cx, cy, w, h];

    for (let i = 0; i < 4; i++) {
      // y = z - H * x
      const y = z[i] - this.x[i];
      // S = H * P * H^T + R
      const s = this.p[i] + r[i];
      // K = P * H^T * S^-1
      const k = this.p[i] / s;

      // x = x + K * y
      this.x[i] += k * y;
      // We also update the velocity components based on position error
      // This is a simplified coupled update (standard KF matrix math yields this)
      const kv = this.p[i + 4] / s;
      this.x[i + 4] += kv * y;

      // P = (I - K * H) * P
      this.p[i] = (1 - k) * this.p[i];
      this.p[i + 4] = (1 - kv) * this.p[i + 4]; // rough approximation of cross-covariance update
    }
  }

  getState() {
    return {
      cx: this.x[0],
      cy: this.x[1],
      w: Math.max(0, this.x[2]),
      h: Math.max(0, this.x[3]),
    };
  }
}
