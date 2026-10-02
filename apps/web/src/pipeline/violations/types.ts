import type { TrackedObject } from '../types';

export type ViolationLifecycle = 'pending_review' | 'approved' | 'rejected';
import type { OcrStatus } from '../plate/types';

export interface ViolationMetadata {
  track_id: number;
  speed?: number;
  speed_limit?: number;
  evidence_metadata?: any;
  plate_text?: string;
  plate_confidence?: number;
  plate_crop_path?: string;
  ocr_status?: OcrStatus;
}

export interface ViolationCandidate {
  id?: string; // Generated on UI or DB side
  type: string;
  severity: string;
  timestamp: string; // ISO string
  status: ViolationLifecycle;
  metadata: ViolationMetadata;
  snapshot_url?: string;
}

export interface RuleContext {
  mediaTime: number;
  fps: number;
  calibration?: any;
}

export interface ViolationRule {
  readonly id: string;
  readonly name: string;
  readonly isEnabled: boolean;
  
  evaluate(track: TrackedObject, context: RuleContext): ViolationCandidate | null;
  reset(trackId?: number): void;
}
