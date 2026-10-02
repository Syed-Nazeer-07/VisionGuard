export interface BoundingBox {
  x: number;
  y: number;
  w: number;
  h: number;
  prob: number;
  classId: number;
  className: string;
}

export interface InitMessage {
  type: 'init';
  modelPath: string;
}

export interface Point { x: number; y: number; }

export interface CalibrationData {
  referenceWidth: number;
  referenceHeight: number;
  speedLimit: number;
  tolerance: number;
  calibrationArea: Point[];
}

export interface FeatureFlags {
  speed_detection: boolean;
  red_light_detection: boolean;
  lane_detection: boolean;
  helmet_detection: boolean;
  triple_riding_detection: boolean;
}

export interface InferenceMessage {
  type: 'inference';
  bitmap: ImageBitmap;
  mediaTime: number; // For speed calculations
  calibration?: CalibrationData; // Pass active calibration
  featureFlags?: FeatureFlags;
}

export interface ResetTrackerMessage {
  type: 'reset_tracker';
}

export type WorkerMessage = InitMessage | InferenceMessage | ResetTrackerMessage;

export type TrackState = 'Tentative' | 'Confirmed' | 'Lost' | 'Removed';

export interface TrackedObject extends BoundingBox {
  trackId: number;
  state: TrackState;
  age: number;
  speed?: number;
  isOverspeed?: boolean;
}

import type { ViolationCandidate } from '../violations/types';

export interface ResultMessage {
  type: 'result';
  boxes: BoundingBox[];
  tracks: TrackedObject[];
  inferenceTime: number;
  provider: string;
  violations?: ViolationCandidate[];
}

export interface ErrorMessage {
  type: 'error';
  error: string;
}

export interface ReadyMessage {
  type: 'ready';
  provider: string;
}

export type WorkerOutputMessage = ResultMessage | ErrorMessage | ReadyMessage;
