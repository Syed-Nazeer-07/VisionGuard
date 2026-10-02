export type EvidenceType = 'snapshot' | 'vehicle_crop' | 'plate_crop';

export interface EvidenceMetadata {
  violation_id?: string;
  track_id: number;
  camera_id?: string;
  timestamp: string;
  speed?: number;
  violation_type?: string;
  confidence: number;
  plate_crop_path?: string;
}

export interface EvidenceItem {
  id: string; // Internal id for rolling candidate
  type: EvidenceType;
  base64Data: string; // The image data as data URL
  score: number;      // Evaluated score
  metadata: EvidenceMetadata;
}
