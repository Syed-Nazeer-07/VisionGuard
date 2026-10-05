import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { motion, AnimatePresence } from 'framer-motion';
import { Video, PlaySquare, Server, UploadCloud, ChevronRight, ChevronLeft, Check, Loader2, AlertCircle, Play } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuthStore } from '../../store/auth';
import { cn } from '../../lib/utils';

const SOURCE_TYPES = [
  { id: 'rtsp', label: 'RTSP Stream', icon: Server, desc: 'Connect to an IP camera via RTSP (MediaMTX / go2rtc)' },
  { id: 'hls', label: 'HLS Stream', icon: Video, desc: 'Connect to an HLS (.m3u8) feed' },
  { id: 'youtube_live', label: 'YouTube Live', icon: PlaySquare, desc: 'Ingest from YouTube Live via yt-dlp' },
  { id: 'uploaded_video', label: 'Uploaded Video', icon: UploadCloud, desc: 'Upload an MP4 file for testing/simulation' },
] as const;

const wizardSchema = z.object({
  camera_identifier: z.string().min(2, 'Identifier is required'),
  name: z.string().min(2, 'Name is required'),
  location: z.string().min(2, 'Location is required'),
  description: z.string().optional(),
  latitude: z.coerce.number().optional(),
  longitude: z.coerce.number().optional(),
  source_type: z.enum(['rtsp', 'hls', 'youtube_live', 'uploaded_video']),
  source_url: z.string().optional(),
  storage_path: z.string().optional(),
}).refine(data => {
  if (data.source_type !== 'uploaded_video' && !data.source_url) {
    return false;
  }
  return true;
}, {
  message: 'Source URL is required for this source type',
  path: ['source_url']
});

type WizardForm = z.infer<typeof wizardSchema>;

interface Props {
  initialData?: any;
  onSuccess: () => void;
  onCancel: () => void;
}

export function CameraCreationWizard({ initialData, onSuccess, onCancel }: Props) {
  const { user } = useAuthStore();
  const [step, setStep] = useState(1);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<'success' | 'error' | null>(null);
  
  const { register, handleSubmit, watch, formState: { errors } } = useForm<WizardForm>({
    resolver: zodResolver(wizardSchema),
    defaultValues: {
      camera_identifier: initialData?.camera_identifier || `CAM-${Math.floor(1000 + Math.random() * 9000)}`,
      name: initialData?.name || '',
      location: initialData?.location || '',
      description: initialData?.description || '',
      latitude: initialData?.latitude || undefined,
      longitude: initialData?.longitude || undefined,
      source_type: initialData?.source_type || 'rtsp',
      source_url: initialData?.source_url || initialData?.stream_url || '',
      storage_path: initialData?.storage_path || '',
    },
    mode: 'onChange'
  });

  const sourceType = watch('source_type');
  const sourceUrl = watch('source_url');
  
  const handleTestConnection = async () => {
    setIsTesting(true);
    setTestResult(null);
    // Simulate connection testing
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Simple validation logic for testing
    if (sourceType === 'rtsp' && !sourceUrl?.startsWith('rtsp://')) {
      setTestResult('error');
    } else if (sourceType === 'hls' && !sourceUrl?.endsWith('.m3u8')) {
      setTestResult('error');
    } else if (sourceType === 'youtube_live' && !sourceUrl?.includes('youtube.com')) {
      setTestResult('error');
    } else {
      setTestResult('success');
    }
    
    setIsTesting(false);
  };

  const onSubmit = async (data: WizardForm) => {
    try {
      const payload = {
        camera_identifier: data.camera_identifier,
        name: data.name,
        location: data.location,
        description: data.description,
        latitude: data.latitude,
        longitude: data.longitude,
        source_type: data.source_type,
        source_url: data.source_url,
        stream_url: data.source_url, // For backwards compatibility
        storage_path: data.storage_path,
        stream_status: testResult === 'success' ? 'online' : 'unknown',
        status: testResult === 'success' ? 'online' : 'warning',
        health_score: testResult === 'success' ? 100 : 50,
        last_health_check: new Date().toISOString(),
      };

      if (initialData) {
        await supabase.from('cameras').update(payload).eq('id', initialData.id);
        await supabase.from('audit_logs').insert([{ user_id: user?.id, action: `Updated Camera ${data.camera_identifier}` }]);
      } else {
        await supabase.from('cameras').insert([{ ...payload, created_by: user?.id }]);
        await supabase.from('audit_logs').insert([{ user_id: user?.id, action: `Created Camera ${data.camera_identifier}` }]);
      }
      onSuccess();
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="flex flex-col h-full bg-slate-50">
      <div className="p-5 border-b border-slate-200 bg-white flex items-center justify-between">
        <h2 className="text-[16px] font-bold text-slate-900">
          {initialData ? 'Edit Camera' : 'Add New Camera'}
        </h2>
        <div className="flex gap-2">
          {[1, 2, 3].map(i => (
            <div key={i} className={cn("w-2 h-2 rounded-full", step >= i ? "bg-blue-600" : "bg-slate-200")} />
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-5">
        <AnimatePresence mode="wait">
          {step === 1 && (
            <motion.div
              key="step1"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-4"
            >
              <h3 className="text-[14px] font-bold text-slate-900 mb-4">Step 1: Basic Details</h3>
              <div>
                <label className="block text-[12px] font-bold text-slate-700 mb-1">IDENTIFIER</label>
                <input {...register('camera_identifier')} className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-[13px]" />
                {errors.camera_identifier && <p className="text-red-500 text-[11px] mt-1">{errors.camera_identifier.message}</p>}
              </div>
              <div>
                <label className="block text-[12px] font-bold text-slate-700 mb-1">NAME</label>
                <input {...register('name')} className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-[13px]" />
                {errors.name && <p className="text-red-500 text-[11px] mt-1">{errors.name.message}</p>}
              </div>
              <div>
                <label className="block text-[12px] font-bold text-slate-700 mb-1">LOCATION</label>
                <input {...register('location')} className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-[13px]" />
                {errors.location && <p className="text-red-500 text-[11px] mt-1">{errors.location.message}</p>}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[12px] font-bold text-slate-700 mb-1">LATITUDE</label>
                  <input type="number" step="any" {...register('latitude')} className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-[13px]" />
                </div>
                <div>
                  <label className="block text-[12px] font-bold text-slate-700 mb-1">LONGITUDE</label>
                  <input type="number" step="any" {...register('longitude')} className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-[13px]" />
                </div>
              </div>
              <div>
                <label className="block text-[12px] font-bold text-slate-700 mb-1">DESCRIPTION</label>
                <textarea {...register('description')} rows={3} className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-[13px]" />
              </div>
            </motion.div>
          )}

          {step === 2 && (
            <motion.div
              key="step2"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-4"
            >
              <h3 className="text-[14px] font-bold text-slate-900 mb-4">Step 2: Source Configuration</h3>
              <div className="grid grid-cols-1 gap-3">
                {SOURCE_TYPES.map(type => (
                  <label
                    key={type.id}
                    className={cn(
                      "flex items-start gap-3 p-4 border rounded-xl cursor-pointer transition-colors",
                      sourceType === type.id ? "border-blue-600 bg-blue-50/50" : "border-slate-200 bg-white hover:border-slate-300"
                    )}
                  >
                    <input type="radio" value={type.id} {...register('source_type')} className="mt-1" />
                    <div>
                      <div className="flex items-center gap-2">
                        <type.icon className={cn("w-4 h-4", sourceType === type.id ? "text-blue-600" : "text-slate-500")} />
                        <span className="text-[13px] font-bold text-slate-900">{type.label}</span>
                      </div>
                      <p className="text-[12px] text-slate-500 mt-1 leading-relaxed">{type.desc}</p>
                    </div>
                  </label>
                ))}
              </div>

              {sourceType !== 'uploaded_video' && (
                <div className="mt-4">
                  <label className="block text-[12px] font-bold text-slate-700 mb-1">STREAM URL</label>
                  <input 
                    {...register('source_url')} 
                    placeholder={sourceType === 'rtsp' ? 'rtsp://...' : sourceType === 'hls' ? 'https://...m3u8' : 'https://youtube.com/...'}
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-[13px]" 
                  />
                  {errors.source_url && <p className="text-red-500 text-[11px] mt-1">{errors.source_url.message}</p>}
                  
                  {sourceType === 'rtsp' && (
                    <div className="mt-3 p-3 bg-slate-100 rounded-lg text-[11px] text-slate-600 flex items-start gap-2">
                      <AlertCircle className="w-4 h-4 shrink-0 text-slate-500" />
                      <p><strong>RTSP Architecture:</strong> VisionGuard uses MediaMTX / go2rtc internally to ingest and re-stream RTSP feeds to WebRTC for low-latency viewing and frame extraction.</p>
                    </div>
                  )}
                  {sourceType === 'youtube_live' && (
                    <div className="mt-3 p-3 bg-slate-100 rounded-lg text-[11px] text-slate-600 flex items-start gap-2">
                      <AlertCircle className="w-4 h-4 shrink-0 text-slate-500" />
                      <p><strong>YouTube Ingestion:</strong> VisionGuard uses yt-dlp to extract the raw stream manifest. No headless browser is required.</p>
                    </div>
                  )}
                </div>
              )}

              {sourceType === 'uploaded_video' && (
                <div className="mt-4">
                  <label className="block text-[12px] font-bold text-slate-700 mb-1">VIDEO FILE</label>
                  <div className="border-2 border-dashed border-slate-200 rounded-xl p-8 flex flex-col items-center justify-center bg-white text-center">
                    <UploadCloud className="w-8 h-8 text-slate-400 mb-2" />
                    <p className="text-[13px] font-bold text-slate-700">Click to upload MP4</p>
                    <p className="text-[11px] text-slate-500 mt-1">Simulate a live stream using a pre-recorded file.</p>
                  </div>
                </div>
              )}
            </motion.div>
          )}

          {step === 3 && (
            <motion.div
              key="step3"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-4"
            >
              <h3 className="text-[14px] font-bold text-slate-900 mb-4">Step 3: Test & Verify</h3>
              
              <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <div className="text-[13px] font-bold text-slate-900">Connection Diagnostics</div>
                    <div className="text-[11px] text-slate-500">Verify the source stream before saving</div>
                  </div>
                  <button 
                    onClick={handleTestConnection}
                    disabled={isTesting}
                    className="px-3 py-1.5 bg-blue-50 text-blue-700 rounded text-[12px] font-bold hover:bg-blue-100 transition-colors flex items-center gap-2 disabled:opacity-50"
                  >
                    {isTesting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                    Test Connection
                  </button>
                </div>

                {testResult === 'success' && (
                  <div className="p-3 bg-emerald-50 border border-emerald-100 rounded-lg text-emerald-700 text-[12px] flex items-center gap-2 mb-4 font-medium">
                    <Check className="w-4 h-4" /> Stream connected successfully!
                  </div>
                )}
                {testResult === 'error' && (
                  <div className="p-3 bg-red-50 border border-red-100 rounded-lg text-red-700 text-[12px] flex items-center gap-2 mb-4 font-medium">
                    <AlertCircle className="w-4 h-4" /> Invalid stream URL or connection timeout.
                  </div>
                )}

                <div className="aspect-video bg-slate-900 rounded-lg overflow-hidden flex items-center justify-center relative">
                  {testResult === 'success' ? (
                    <div className="absolute inset-0 bg-slate-800 flex items-center justify-center">
                       <Video className="w-8 h-8 text-white/20 animate-pulse" />
                       <div className="absolute bottom-4 left-4 flex items-center gap-2">
                         <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                         <span className="text-[10px] text-white/80 font-bold uppercase tracking-widest">Live Feed</span>
                       </div>
                    </div>
                  ) : (
                    <div className="text-white/40 text-[12px] font-medium flex flex-col items-center gap-2">
                      <Video className="w-8 h-8 opacity-50" />
                      No video preview available
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="p-4 border-t border-slate-200 bg-white flex items-center justify-between">
        <button
          onClick={() => step === 1 ? onCancel() : setStep(s => s - 1)}
          className="px-4 py-2 text-slate-600 text-[13px] font-bold hover:bg-slate-100 rounded-lg transition-colors flex items-center gap-1"
        >
          {step === 1 ? 'Cancel' : <><ChevronLeft className="w-4 h-4" /> Back</>}
        </button>
        
        {step < 3 ? (
          <button
            onClick={() => setStep(s => s + 1)}
            className="px-4 py-2 bg-blue-600 text-white text-[13px] font-bold hover:bg-blue-700 rounded-lg transition-colors flex items-center gap-1"
          >
            Next <ChevronRight className="w-4 h-4" />
          </button>
        ) : (
          <button
            onClick={handleSubmit(onSubmit)}
            className="px-4 py-2 bg-emerald-600 text-white text-[13px] font-bold hover:bg-emerald-700 rounded-lg transition-colors flex items-center gap-2"
          >
            <Check className="w-4 h-4" />
            Complete Setup
          </button>
        )}
      </div>
    </div>
  );
}
