import { useState, useEffect } from 'react';
import { getSignedUrl } from '../../pipeline/evidence/storage';

export function SecureImage({ path, alt, className }: { path: string, alt: string, className?: string }) {
  const [url, setUrl] = useState<string>('');

  useEffect(() => {
    let active = true;
    
    if (path.startsWith('data:image')) {
      setUrl(path);
      return;
    }

    const load = async () => {
      const signed = await getSignedUrl(path);
      if (active) setUrl(signed);
    };
    
    if (path) {
      load();
    }
    
    return () => { active = false; };
  }, [path]);

  if (!url) {
    return <div className={`animate-pulse bg-gray-800 ${className || ''}`} />;
  }

  return <img src={url} alt={alt} className={className} />;
}
