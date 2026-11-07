import { useEffect, useState } from 'react';
import { ExternalLink, History, Video, X } from 'lucide-react';
import {
  normalizeYouTubeLiveUrl, parseYouTubeHistory, recordYouTubeLink,
  youtubeHistoryStorageKey, youtubeLinkLabel, type YouTubeLiveLink
} from '../../services/youtubeLiveHistory';

interface Props {
  ownerId: string | null;
  onOpen: (url: string) => void;
}

export function YouTubeLivePanel({ ownerId, onOpen }: Props) {
  const [input, setInput] = useState('');
  const [recent, setRecent] = useState<YouTubeLiveLink[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    const history = ownerId
      ? parseYouTubeHistory(localStorage.getItem(youtubeHistoryStorageKey(ownerId))) : [];
    setRecent(history);
    setInput(history[0]?.url || '');
    setError('');
  }, [ownerId]);

  const persist = (entries: YouTubeLiveLink[]) => {
    setRecent(entries);
    if (!ownerId) return;
    try {
      localStorage.setItem(youtubeHistoryStorageKey(ownerId), JSON.stringify(entries));
    } catch {
      setError('Your browser could not save the recent-links list. The video page can still be opened.');
    }
  };

  const open = (value: string) => {
    try {
      const url = normalizeYouTubeLiveUrl(value);
      // Direct user action keeps popup blocking unlikely; never fetch, scrape,
      // record or request credentials from a YouTube URL.
      window.open(url, '_blank', 'noopener,noreferrer');
      setInput(url);
      setError('');
      persist(recordYouTubeLink(recent, url, Date.now()));
      onOpen(url);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const remove = (url: string) => {
    persist(recent.filter(entry => entry.url !== url));
    if (input === url) setInput('');
  };

  return <section className="vg-panel p-4 sm:p-5" aria-label="YouTube Live">
    <div className="mb-4 flex items-center gap-2">
      <Video size={18} className="text-[#2356a8]"/>
      <div className="min-w-0">
        <h2 className="text-sm font-semibold text-slate-900">YouTube Live</h2>
        <p className="mt-1 text-xs text-slate-500">
          Open the video in another tab, then share that tab with VisionGuard.
        </p>
      </div>
    </div>
    <form className="flex flex-col gap-2 sm:flex-row" onSubmit={event => {
      event.preventDefault();
      open(input);
    }}>
      <label htmlFor="youtube-live-url" className="sr-only">YouTube Live page link</label>
      <input id="youtube-live-url" type="url" value={input}
        onChange={event => { setInput(event.target.value); setError(''); }}
        placeholder="https://www.youtube.com/live/..."
        className="vg-field min-w-0 flex-1"/>
      <button type="submit" className="vg-primary shrink-0">
        <ExternalLink size={15}/> Open YouTube
      </button>
    </form>
    {error && <p role="alert" className="mt-2 text-xs text-amber-700">{error}</p>}
    <p className="mt-3 text-xs leading-5 text-slate-600">
      Start the video, return here, click <strong>Analyze browser tab</strong>,
      and choose the <strong>YouTube tab</strong> in Edge's sharing window.
      Avoid Entire Screen.
    </p>
    {recent.length > 0 && <div className="mt-4 border-t border-slate-100 pt-3">
      <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-slate-600">
        <History size={14}/> Recently opened
        <span className="font-normal text-slate-400">· saved on this device</span>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {recent.map(item =>
          <div key={item.url} className="flex min-w-0 items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
            <button type="button" title={item.url} onClick={() => open(item.url)}
              className="min-w-0 flex-1 truncate text-left text-xs font-medium text-[#2356a8] hover:underline">
              {youtubeLinkLabel(item.url)}
            </button>
            <button type="button" aria-label={'Remove ' + youtubeLinkLabel(item.url)}
              onClick={() => remove(item.url)}
              className="shrink-0 rounded-md p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-700">
              <X size={14}/>
            </button>
          </div>)}
      </div>
    </div>}
  </section>;
}
