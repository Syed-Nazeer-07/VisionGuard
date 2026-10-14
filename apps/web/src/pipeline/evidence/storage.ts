import { supabase } from '../../lib/supabase';

function cleanStoragePath(p: string): string {
  if (!p) return '';
  return p.replace(/^evidence\/?/i, '').replace(/^\/+/, '');
}

export async function uploadEvidence(base64Data: string, prefix: string): Promise<string> {
  const fetchResponse = await fetch(base64Data);
  const blob = await fetchResponse.blob();
  const ext = blob.type === 'image/jpeg' ? 'jpg' : 'png';
  const cleanPrefix = cleanStoragePath(prefix);
  const path = cleanPrefix ? `${cleanPrefix}/${crypto.randomUUID()}.${ext}` : `${crypto.randomUUID()}.${ext}`;

  let attempts = 0;
  const maxAttempts = 3;
  
  while (attempts < maxAttempts) {
    const { error } = await supabase.storage
      .from('evidence')
      .upload(path, blob, {
        contentType: blob.type,
        upsert: false
      });

    if (!error) return path;
    
    attempts++;
    console.warn(`Evidence upload failed (attempt ${attempts}/${maxAttempts}):`, error);
    if (attempts >= maxAttempts) throw error;
    await new Promise(r => setTimeout(r, 1000 * attempts));
  }
  
  return path;
}

export async function getSignedUrl(path: string, expiresIn = 3600): Promise<string> {
  if (!path) return '';
  const sanitizedPath = cleanStoragePath(path);
  if (!sanitizedPath) return '';
  let attempts = 0;
  const maxAttempts = 2;
  
  while (attempts < maxAttempts) {
    const { data, error } = await supabase.storage
      .from('evidence')
      .createSignedUrl(sanitizedPath, expiresIn);

    if (data?.signedUrl) return data.signedUrl;
    
    attempts++;
    console.warn(`Signed URL generation failed for ${sanitizedPath} (attempt ${attempts}/${maxAttempts}):`, error);
    if (attempts >= maxAttempts) break;
    await new Promise(r => setTimeout(r, 500));
  }
  
  return '';
}
