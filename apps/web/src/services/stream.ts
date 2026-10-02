import { supabase } from '../lib/supabase';

const STREAM_API_URL = import.meta.env.VITE_STREAM_API_URL || 'http://localhost:8000';

export interface ProbeResult {
  status: 'online' | 'offline' | 'unknown';
  error?: string;
  metadata?: any;
}

export async function probeStream(url: string, sourceType: string): Promise<ProbeResult> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    
    // We only probe URL streams, uploads don't need probe
    if (sourceType === 'upload') {
      return { status: 'online' };
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(`${STREAM_API_URL}/probe?url=${encodeURIComponent(url)}&type=${sourceType}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`
      },
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (response.ok) {
      const data = await response.json();
      return {
        status: data.is_active ? 'online' : 'offline',
        metadata: data.metadata
      };
    } else {
      return { status: 'offline', error: `HTTP ${response.status}` };
    }
  } catch (err: any) {
    if (err.name === 'AbortError') {
      return { status: 'offline', error: 'Probe timeout' };
    }
    return { status: 'unknown', error: err.message };
  }
}

export async function relayYouTubeStream(url: string): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;

  const response = await fetch(`${STREAM_API_URL}/relay/youtube`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({ url })
  });

  if (!response.ok) {
    throw new Error(`Failed to relay YouTube stream: ${response.statusText}`);
  }
  
  const data = await response.json();
  return data.stream_url; // Assuming this returns the m3u8 HLS url
}
