import type { BoundingBox, TrackState } from '../types';
import { KalmanFilter } from './kalman';

export class Track {
  static nextId = 1;
  public trackId: number;
  public state: TrackState;
  public kf: KalmanFilter;
  public frameCount: number = 0;
  public timeSinceUpdate: number = 0;
  
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
  }

  predict() {
    this.kf.predict();
    this.frameCount++;
    this.timeSinceUpdate++;
  }

  update(box: BoundingBox) {
    this.kf.update(box.x, box.y, box.w, box.h);
    this.classId = box.classId;
    this.className = box.className;
    this.prob = box.prob;
    this.timeSinceUpdate = 0;
    
    if (this.state === 'Tentative' && this.frameCount >= 3) {
      this.state = 'Confirmed';
    }
  }

  markLost() {
    if (this.state === 'Confirmed') {
      this.state = 'Lost';
    } else {
      this.state = 'Removed';
    }
  }

  getState() {
    return this.kf.getState();
  }
}
