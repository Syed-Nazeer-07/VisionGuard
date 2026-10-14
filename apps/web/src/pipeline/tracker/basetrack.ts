import type { BoundingBox, TrackState } from '../types';
import { KalmanFilter } from './kalman';

export class Track {
  static nextId = 1;
  public trackId: number;
  public state: TrackState;
  public kf: KalmanFilter;
  public frameCount: number = 0;
  public timeSinceUpdate: number = 0;
  public hitCount: number = 1;
  public lastBox: BoundingBox;
  private classScores = new Map<number, number>();
  private classNames = new Map<number, string>();
  
  // Last known info
  public classId: number;
  public className: string;
  public prob: number;

  constructor(box: BoundingBox) {
    this.trackId = Track.nextId++;
    this.state = 'Tentative';
    this.kf = new KalmanFilter(box.x, box.y, box.w, box.h);
    this.classId = box.classId;
    this.className = box.className;
    this.prob = box.prob;
    this.lastBox = { ...box };
    this.classScores.set(box.classId, box.prob);
    this.classNames.set(box.classId, box.className);
    this.hitCount = 1;
  }

  predict() {
    this.kf.predict();
    this.frameCount++;
    this.timeSinceUpdate++;
  }

  /** Record a matched detection: kinematics, confidence and a decayed class vote. */
  private observe(box: BoundingBox) {
    this.kf.update(box.x, box.y, box.w, box.h);
    this.prob = box.prob;
    this.lastBox = { ...box };
    this.timeSinceUpdate = 0;
    this.hitCount++;

    for (const [id, score] of this.classScores) this.classScores.set(id, score * 0.9);
    this.classScores.set(box.classId, (this.classScores.get(box.classId) ?? 0) + box.prob);
    this.classNames.set(box.classId, box.className);
    let bestId = this.classId;
    let bestScore = this.classScores.get(bestId) ?? -1;
    for (const [id, score] of this.classScores) {
      if (score > bestScore) { bestId = id; bestScore = score; }
    }
    this.classId = bestId;
    this.className = this.classNames.get(bestId) ?? box.className;
  }

  update(box: BoundingBox) {
    this.observe(box);
    if (this.state === 'Tentative' && this.hitCount >= 2) {
      this.state = 'Confirmed';
    }
  }

  reActivate(box: BoundingBox) {
    this.observe(box);
    this.state = 'Confirmed';
  }

  markLost() {
    if (this.state === 'Confirmed') {
      this.state = 'Lost';
    } else {
      this.state = 'Removed';
    }
  }

  markRemoved() {
    this.state = 'Removed';
  }

  getState() {
    return this.kf.getState();
  }
}

