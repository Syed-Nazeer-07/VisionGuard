import { supabase } from '../../lib/supabase';

export async function uploadEvidence(base64Data: string, prefix: string): Promise<string> {
  const fetchResponse = await fetch(base64Data);
  const blob = await fetchResponse.blob();
  const ext = blob.type === 'image/jpeg' ? 'jpg' : 'png';
  const path = `${prefix}/${crypto.randomUUID()}.${ext}`;

  const { error } = await supabase.storage
    .from('evidence')
    .upload(path, blob, {
      contentType: blob.type,
      upsert: false
    });

  if (error) {
    throw error;
  }
  return path;
}

export async function getSignedUrl(path: string, expiresIn = 3600): Promise<string> {
  if (!path) return '';
  const { data, error } = await supabase.storage
    .from('evidence')
    .createSignedUrl(path, expiresIn);

  if (error) {
    console.error('Failed to get signed url for', path, error);
    return '';
  }
  return data.signedUrl;
}
