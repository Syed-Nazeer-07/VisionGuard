export interface BoundingBox {
  // Center coordinates of the bounding box
  x: number;
  y: number;
  // Width and height of the bounding box
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
  plate_detection: boolean;
}

export interface InferenceMessage {
  type: 'inference';
  bitmap: ImageBitmap;
  mediaTime: number; // timestamp of the captured source frame, in seconds
  frameId: number; // monotonically increasing client request identity
  sourceGeneration: number; // invalidates results after source changes or manual seeks
  sourceWidth: number; // pixel size of the captured frame (all result coordinates are in this space)
  sourceHeight: number;
  calibration?: CalibrationData; // Pass active calibration
  featureFlags?: FeatureFlags;
  confidenceThreshold?: number;
  iouThreshold?: number;
}

export interface ResetTrackerMessage {
  type: 'reset_tracker';
}

export type WorkerMessage = InitMessage | InferenceMessage | ResetTrackerMessage;

export type TrackState = 'Tentative' | 'Confirmed' | 'Lost' | 'Removed';

export interface TrackedObject extends BoundingBox {
  trackId: number;
  state: TrackState;
  frameCount: number;
  timeSinceUpdate?: number;
  hitCount?: number;
  speed?: number; // Non-negative scalar speed magnitude in km/h
  velocity?: number; // Signed directional velocity in km/h
  isOverspeed?: boolean;
  isEstimatedSpeed?: boolean;
  dx?: number;
  dy?: number;
  dw?: number;
  dh?: number;
  observationType?: 'detection' | 'interpolated' | 'predicted';
  predictionConfidence?: number;
}

import type { ViolationCandidate } from '../violations/types';

export interface ResultMessage {
  type: 'result';
  mediaTime: number; // media time of the exact source frame these results belong to
  frameId: number;
  sourceGeneration: number;
  sourceWidth: number; // pixel size of the frame the boxes/tracks are expressed in
  sourceHeight: number;
  detectionCount: number; // detector output after NMS and class filter, before tracking
  boxes: BoundingBox[];
  tracks: TrackedObject[];
  inferenceTime: number;
  provider: string;
  violations?: ViolationCandidate[];
}

export interface ErrorMessage {
  type: 'error';
  phase: 'init' | 'inference';
  error: string;
  frameId?: number;
  sourceGeneration?: number;
}

export interface ReadyMessage {
  type: 'ready';
  provider: string;
  fallbackReason: string | null; // why WebGPU was not used, when provider is 'wasm'
}

export type WorkerOutputMessage = ResultMessage | ErrorMessage | ReadyMessage;
