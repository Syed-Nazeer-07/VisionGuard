// Lightweight 1D Kalman Filter for bounding boxes to avoid matrix library dependency
export class KalmanFilter {
  // 4 independent 2x2 filters for cx, cy, w, h
  private states: { p: number, v: number }[];
  private covs: { p11: number, p12: number, p22: number }[];

  constructor(cx: number, cy: number, w: number, h: number) {
    this.states = [
      { p: cx, v: 0 },
      { p: cy, v: 0 },
      { p: w, v: 0 },
      { p: h, v: 0 }
    ];
    // Initialize covariance matrices
    this.covs = [
      { p11: 10, p12: 0, p22: 100 },
      { p11: 10, p12: 0, p22: 100 },
      { p11: 10, p12: 0, p22: 100 },
      { p11: 10, p12: 0, p22: 100 }
    ];
  }

  predict() {
    // Q (Process noise)
    const q_p = 1;
    const q_v = 0.01;

    for (let i = 0; i < 4; i++) {
      const state = this.states[i];
      const cov = this.covs[i];

      // Predict state: p = p + v (we keep v=0 for w and h to prevent runaway box sizes)
      // Dampen velocity when predicting to prevent runaway box drift across empty pavement
      if (i < 2) {
        state.p += state.v;
        state.v *= 0.65;
      }

      // Predict covariance
      // F = [1 1; 0 1]
      // P = F * P * F^T + Q
      const p11 = cov.p11 + 2 * cov.p12 + cov.p22 + q_p;
      const p12 = cov.p12 + cov.p22;
      const p22 = cov.p22 + q_v;

      cov.p11 = p11;
      cov.p12 = p12;
      cov.p22 = p22;
    }
  }

  update(cx: number, cy: number, w: number, h: number) {
    // Measurement noise R
    const r = 0.1;
    const z = [cx, cy, w, h];

    for (let i = 0; i < 4; i++) {
      const state = this.states[i];
      const cov = this.covs[i];

      // Innovation
      const y = z[i] - state.p;
      
      // Innovation covariance
      const s = cov.p11 + r;

      // Kalman gain
      const k1 = cov.p11 / s;
      const k2 = cov.p12 / s;

      // Update state
      state.p += k1 * y;
      if (i < 2) {
        state.v += k2 * y;
      } else {
        state.v = 0; // Force velocity to 0 for w/h
      }

      // Update covariance: P = (I - K * H) * P
      const p11 = (1 - k1) * cov.p11;
      const p12 = (1 - k1) * cov.p12;
      const p22 = cov.p22 - k2 * cov.p12;

      cov.p11 = p11;
      cov.p12 = p12;
      cov.p22 = p22;
    }
  }

  getState() {
    return {
      cx: this.states[0].p,
      cy: this.states[1].p,
      w: Math.max(0, this.states[2].p),
      h: Math.max(0, this.states[3].p),
      dx: this.states[0].v,
      dy: this.states[1].v,
      dw: this.states[2].v,
      dh: this.states[3].v,
    };
  }
}
