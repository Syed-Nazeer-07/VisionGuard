import { supabase } from '../../lib/supabase';
import { db } from '../../services/db';
import { analysisLogger } from '../../services/analysisLogger';

export interface EvidenceJob {
  incident_id: string;
  camera_id: string | null;
  video_id?: string | null;
  analysis_run_id?: string | null;
  base64Data: string;
  type: 'snapshot' | 'plate_crop';
  capture_timestamp: string;
}

class EvidenceQueueSystem {
  private queue: EvidenceJob[] = [];
  private isProcessing = false;
  
  // Metrics
  public metrics = {
    queued: 0,
    uploaded: 0,
    failed: 0,
    totalTimeMs: 0,
    avgTimeMs: 0
  };

  public add(job: EvidenceJob) {
    this.queue.push(job);
    this.metrics.queued++;
    if (!this.isProcessing) {
      this.processQueue();
    }
  }

  public startRetentionWorker() {
    // Run once initially, then every 24 hours (86400000ms)
    this.executeRetentionPolicy();
    setInterval(() => this.executeRetentionPolicy(), 86400000);
  }

  private async executeRetentionPolicy() {
    try {
      const settings = await db.settings.list();
      const retentionDays = parseInt(settings.evidence_retention_days || '90', 10);
      const action = settings.evidence_retention_action || 'archive'; // 'archive' or 'delete'

      const expirationDate = new Date();
      expirationDate.setDate(expirationDate.getDate() - retentionDays);
      const isoThreshold = expirationDate.toISOString();

      // Find expired evidence
      const { data: expiredList, error } = await (supabase as any)
        .from('evidence')
        .select('id, file_path, thumbnail_path')
        .lt('capture_timestamp', isoThreshold)
        .neq('status', action === 'delete' ? 'deleted' : 'archived');
        
      if (error) throw error;
      if (!expiredList || expiredList.length === 0) return;

      for (const ev of expiredList) {
        if (action === 'delete') {
          // Delete from storage
          const paths = [ev.file_path, ev.thumbnail_path].filter(Boolean);
          if (paths.length > 0) {
            await supabase.storage.from('evidence').remove(paths);
          }
        }

        // Update DB
        await (supabase as any).from('evidence').update({
          status: action === 'delete' ? 'deleted' : 'archived',
          updated_at: new Date().toISOString()
        }).eq('id', ev.id);

        // Audit Log
        db.auditLogs.create({
          action: action === 'delete' ? 'EVIDENCE_DELETED' : 'EVIDENCE_ARCHIVED',
          metadata: { evidenceId: ev.id, policy: `${retentionDays} days` }
        }).catch(() => {});
      }
    } catch (err) {
      console.error('Retention policy execution failed:', err);
    }
  }

  public getQueueLength() {
    return this.queue.length;
  }

  private async generateThumbnail(base64Data: string): Promise<Blob | null> {
    try {
      const img = await fetch(base64Data).then(r => r.blob());
      const bitmap = await createImageBitmap(img);
      const canvas = new OffscreenCanvas(320, 240);
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      
      const ratio = Math.min(320 / bitmap.width, 240 / bitmap.height);
      const w = bitmap.width * ratio;
      const h = bitmap.height * ratio;
      
      ctx.drawImage(bitmap, (320 - w) / 2, (240 - h) / 2, w, h);
      return await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.7 });
    } catch (err) {
      console.warn('Thumbnail generation failed', err);
      return null;
    }
  }

  private async processQueue() {
    this.isProcessing = true;

    while (this.queue.length > 0) {
      const job = this.queue.shift();
      if (!job) continue;

      const startTime = performance.now();
      
      try {
        // Create initial DB record
        const ext = job.base64Data.startsWith('data:image/png') ? 'png' : 'jpg';
        const date = new Date(job.capture_timestamp);
        const year = date.getUTCFullYear();
        const month = String(date.getUTCMonth() + 1).padStart(2, '0');
        
        const pathPrefix = `evidence/${year}/${month}/${job.camera_id ?? `video-${job.video_id ?? 'unknown'}`}/${job.incident_id}`;
        const fileName = `${job.type}_${Date.now()}`;
        const filePath = `${pathPrefix}/${fileName}.${ext}`;
        const thumbPath = `${pathPrefix}/${fileName}_thumb.jpg`;

        // Generate blobs
        const imgBlob = await fetch(job.base64Data).then(r => r.blob());
        const thumbBlob = await this.generateThumbnail(job.base64Data);

        const record = await (supabase as any).from('evidence').insert({
          camera_id: job.camera_id,
          incident_id: job.incident_id,
          video_id: job.video_id || null,
          analysis_run_id: job.analysis_run_id || null,
          file_type: job.type,
          file_url: filePath,
          file_path: filePath,
          thumbnail_path: thumbBlob ? thumbPath : null,
          mime_type: imgBlob.type,
          file_size: imgBlob.size,
          status: 'uploading',
          capture_timestamp: job.capture_timestamp
        }).select().single();

        if (record.error) throw record.error;
        const evidenceId = record.data.id;

        // Upload with Retry Strategy
        // supabase-js reports Storage failures via `error`, not by throwing.
        let attempts = 0;
        let lastError: string | null = null;
        for (let attempt = 1; attempt <= 3; attempt++) {
          attempts = attempt;
          try {
            const { error: imgErr } = await supabase.storage.from('evidence').upload(filePath, imgBlob, { upsert: true, contentType: imgBlob.type });
            if (imgErr) throw imgErr;
            if (thumbBlob) {
              const { error: thumbErr } = await supabase.storage.from('evidence').upload(thumbPath, thumbBlob, { upsert: true, contentType: 'image/jpeg' });
              if (thumbErr) throw thumbErr;
            }
            lastError = null;
            break;
          } catch (e) {
            lastError = e instanceof Error ? e.message : String(e);
            if (attempt < 3) await new Promise(r => setTimeout(r, attempt * 1000));
          }
        }

        if (lastError) {
          await (supabase as any).from('evidence').update({
            status: 'failed',
            upload_attempts: attempts,
            last_error: lastError,
            updated_at: new Date().toISOString()
          }).eq('id', evidenceId);
          throw new Error(`Storage upload failed after ${attempts} attempt(s): ${lastError}`);
        } else {
          const { error: statusErr } = await (supabase as any).from('evidence').update({
            status: 'uploaded',
            upload_attempts: attempts,
            updated_at: new Date().toISOString()
          }).eq('id', evidenceId);
          if (statusErr) console.warn('Evidence status update failed:', statusErr);
          
          this.metrics.uploaded++;
          db.auditLogs.create({ action: 'EVIDENCE_UPLOADED', metadata: { evidenceId, incidentId: job.incident_id } }).catch(()=>{});

          analysisLogger.log({
            video_id: job.video_id || null,
            camera_id: job.camera_id || null,
            analysis_run_id: job.analysis_run_id || null,
            category: 'EVIDENCE',
            message: `Evidence uploaded for incident #${job.incident_id.slice(0, 8)} (${job.type})`
          });
        }

      } catch (err: any) {
        this.metrics.failed++;
        console.error('Evidence queue error:', err);
        analysisLogger.log({
          video_id: job.video_id || null,
          camera_id: job.camera_id || null,
          analysis_run_id: job.analysis_run_id || null,
          category: 'ERROR',
          message: `Evidence upload failed: ${err?.message || 'Storage error'}`
        });
      } finally {
        const elapsed = performance.now() - startTime;
        this.metrics.totalTimeMs += elapsed;
        this.metrics.avgTimeMs = this.metrics.totalTimeMs / (this.metrics.uploaded + this.metrics.failed);
      }
    }

    this.isProcessing = false;
  }
}

export const evidenceQueue = new EvidenceQueueSystem();
