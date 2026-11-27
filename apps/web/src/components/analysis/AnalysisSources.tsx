import { useState } from 'react';
import { ArrowLeft, ArrowUpRight, Camera, Film, MonitorPlay, Upload, Video, X } from 'lucide-react';
import { Modal } from '../ui/Modal';

const presets = [
  'Traffic video footage for vehicle object detection',
  'Highway traffic footage',
  'Intersection traffic footage',
  'Live traffic cameras',
];

export function youtubeSearchUrl(query: string) {
  const search = new URLSearchParams({ search_query: query.trim() || presets[0] });
  return 'https://www.youtube.com/results?' + search.toString();
}

type Props = {
  onDismiss: () => void;
  onUpload: () => void;
  onCamera: () => void;
  onTab: () => void;
  onSample: () => void;
  onRestore?: () => void;
  cameraStarting: boolean;
  tabStarting: boolean;
  error: string;
};

export function AnalysisSources({ onDismiss, onUpload, onCamera, onTab, onSample, onRestore, cameraStarting, tabStarting, error }: Props) {
  const [youtube, setYouTube] = useState(false);
  const [query, setQuery] = useState('');
  const [searched, setSearched] = useState(false);
  return <Modal labelledBy="analysis-source-title" className="vg-source-dialog" onDismiss={onDismiss}>
    <div className="vg-source-dialog-inner">
      <header><h2 id="analysis-source-title">{youtube ? 'Analyze YouTube footage' : 'Choose an analysis source'}</h2>
        <button type="button" className="vg-secondary" aria-label="Close source selector" onClick={onDismiss}><X size={18}/></button></header>
      {error && <p className="vg-source-error" role="alert">{error}</p>}
      {youtube ? <>
        <button type="button" className="vg-source-return" onClick={() => setYouTube(false)}><ArrowLeft size={16}/> All sources</button>
        <ol className="vg-source-guide">
          <li>Find footage you have permission to analyze, then play it in its YouTube tab.</li>
          <li>Return here, choose <strong>Select YouTube tab</strong>, and approve that tab in your browser.</li>
        </ol>
        <label className="vg-source-query" htmlFor="vg-youtube-search">Search YouTube
          <input id="vg-youtube-search" className="vg-field" value={query} onChange={event => setQuery(event.target.value)}
            placeholder={presets[0]}/>
        </label>
        <div className="vg-source-presets" aria-label="YouTube search suggestions">
          {presets.map(preset => <button type="button" key={preset} className="vg-secondary" aria-pressed={query === preset}
            onClick={() => setQuery(preset)}>{preset}</button>)}
        </div>
        <div className="vg-source-dialog-actions">
          <a href={youtubeSearchUrl(query)} target="_blank" rel="noopener noreferrer" className={searched ? 'vg-secondary' : 'vg-primary'}
            onClick={() => setSearched(true)}>Open YouTube search <ArrowUpRight size={16}/></a>
          <button type="button" className={searched ? 'vg-primary' : 'vg-secondary'} onClick={onTab} disabled={tabStarting}>
            <MonitorPlay size={16}/> {tabStarting ? 'Waiting for browser…' : 'Select YouTube tab'}
          </button>
        </div>
      </> : <div className="vg-source-options">
        <button type="button" onClick={onUpload}><Upload size={19}/><span><strong>Upload video</strong><small>Choose a recording on your device.</small></span></button>
        <button type="button" onClick={() => setYouTube(true)}><Video size={19}/><span><strong>YouTube footage</strong><small>Find traffic footage and share its tab.</small></span></button>
        <button type="button" onClick={onCamera} disabled={cameraStarting}><Camera size={19}/><span><strong>Device camera</strong><small>{cameraStarting ? 'Waiting for permission…' : 'Connect an available camera.'}</small></span></button>
        <button type="button" onClick={onTab} disabled={tabStarting}><MonitorPlay size={19}/><span><strong>Existing browser tab</strong><small>{tabStarting ? 'Waiting for permission…' : 'Share a tab already open in your browser.'}</small></span></button>
        <button type="button" onClick={onSample}><Film size={19}/><span><strong>Try sample footage</strong><small>Run detection on a short motorway clip.</small></span></button>
        {onRestore && <button type="button" onClick={onRestore}><Film size={19}/><span><strong>Reopen saved video</strong><small>Resume the locally retained recording.</small></span></button>}
      </div>}
    </div>
  </Modal>;
}
