import { useState } from 'react';
import { ExternalLink, Link2 } from 'lucide-react';
import { normalizeVideoPageUrl } from '../services/videoPageUrls';

const publicCameraSites = [
  {
    name: 'Virginia 511',
    detail: 'Roadside traffic-camera map · many live feeds',
    url: 'https://www.511virginia.org/',
  },
  {
    name: 'Tennessee SmartWay',
    detail: 'Highway cameras and travel conditions',
    url: 'https://smartway.tn.gov/',
  },
  {
    name: 'Caltrans QuickMap',
    detail: 'California traffic cameras · some live, some still images',
    url: 'https://quickmap.dot.ca.gov/',
  },
] as const;

/** Opens a public video web page; it does NOT scrape or ingest its media URL. */
export function TrafficCameraDirectory() {
  const [videoPageUrl, setVideoPageUrl] = useState('');
  const [validationError, setValidationError] = useState('');

  const openVideoPage = () => {
    try {
      const destination = normalizeVideoPageUrl(videoPageUrl);
      setValidationError('');
      window.open(destination, '_blank', 'noopener,noreferrer');
    } catch (error) {
      setValidationError(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <section className="vg-panel space-y-4 p-4 sm:p-5" aria-label="Public traffic camera websites">
      <div className="space-y-1">
        <h2 className="text-sm font-semibold text-slate-900">Open traffic footage</h2>
        <p className="text-xs leading-5 text-slate-500">
          Open a YouTube Live page or a public camera website in a separate tab, then
          use <strong>Analyze browser tab</strong> and select that video tab.
          Webpage links are not direct video streams.
        </p>
      </div>
      <form className="flex flex-col gap-2 sm:flex-row" onSubmit={event => {
        event.preventDefault();
        openVideoPage();
      }}>
        <label htmlFor="public-video-page-url" className="sr-only">YouTube Live or camera page URL</label>
        <input id="public-video-page-url" type="url" value={videoPageUrl}
          onChange={event => { setVideoPageUrl(event.target.value); setValidationError(''); }}
          placeholder="https://www.youtube.com/live/..."
          className="vg-field min-w-0 flex-1" />
        <button type="submit" className="vg-secondary shrink-0">
          <ExternalLink size={15}/> Open video page
        </button>
      </form>
      {validationError && <p role="alert" className="text-xs text-red-700">{validationError}</p>}
      <div className="grid gap-2 sm:grid-cols-3">
        {publicCameraSites.map(site => (
          <a key={site.url} href={site.url} target="_blank" rel="noopener noreferrer"
            className="group flex min-w-0 items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 hover:border-slate-300 hover:bg-white">
            <Link2 size={15} className="mt-0.5 shrink-0 text-slate-500"/>
            <span className="min-w-0">
              <span className="flex items-center gap-1 text-xs font-semibold text-slate-800">
                {site.name} <ExternalLink size={12} className="text-slate-400"/>
              </span>
              <span className="mt-1 block text-[11px] leading-4 text-slate-500">{site.detail}</span>
            </span>
          </a>
        ))}
      </div>
      <p className="text-[11px] leading-4 text-slate-500">
        Choose a camera showing actual moving video; regularly refreshed still images
        won't provide reliable tracking. Feed availability and reuse permissions vary by provider.
      </p>
    </section>
  );
}
