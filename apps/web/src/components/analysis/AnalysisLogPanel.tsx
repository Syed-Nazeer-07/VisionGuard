import { useEffect, useRef, useState, useMemo } from 'react'
import { Terminal, ArrowDown, Activity } from 'lucide-react'
import { cn } from '../../lib/utils'
import { type AnalysisLogEntry, type LogCategory, analysisLogger } from '../../services/analysisLogger'

interface AnalysisLogPanelProps {
  videoId?: string | null
  cameraId?: string | null
  className?: string
}

const CATEGORY_COLORS: Record<LogCategory, { text: string; bg: string; border: string }> = {
  SYSTEM: { text: 'text-slate-300', bg: 'bg-slate-800', border: 'border-slate-700' },
  UPLOAD: { text: 'text-cyan-300', bg: 'bg-cyan-950/60', border: 'border-cyan-800/60' },
  PROCESSING: { text: 'text-indigo-300', bg: 'bg-indigo-950/60', border: 'border-indigo-800/60' },
  MODEL: { text: 'text-purple-300', bg: 'bg-purple-950/60', border: 'border-purple-800/60' },
  DETECTION: { text: 'text-emerald-300', bg: 'bg-emerald-950/60', border: 'border-emerald-800/60' },
  TRACKING: { text: 'text-blue-300', bg: 'bg-blue-950/60', border: 'border-blue-800/60' },
  INCIDENT: { text: 'text-amber-300', bg: 'bg-amber-950/60', border: 'border-amber-800/60' },
  EVIDENCE: { text: 'text-pink-300', bg: 'bg-pink-950/60', border: 'border-pink-800/60' },
  PERSISTENCE: { text: 'text-teal-300', bg: 'bg-teal-950/60', border: 'border-teal-800/60' },
  ERROR: { text: 'text-rose-400', bg: 'bg-rose-950/80', border: 'border-rose-800' }
}

export function AnalysisLogPanel({ videoId, cameraId, className }: AnalysisLogPanelProps) {
  const [logs, setLogs] = useState<AnalysisLogEntry[]>([])
  const [activeCategory, setActiveCategory] = useState<string>('ALL')
  const [autoScroll, setAutoScroll] = useState(true)
  const logContainerRef = useRef<HTMLDivElement>(null)

  // 1. Load historical logs and subscribe to live logs
  useEffect(() => {
    let isMounted = true

    // Fetch historical logs from database/cache
    analysisLogger.fetchHistoricalLogs(videoId, cameraId).then(historical => {
      if (isMounted) {
        setLogs(historical)
      }
    })

    // Listen for live events as they happen in real-time
    const unsubscribe = analysisLogger.subscribe(videoId, cameraId, (newEntry) => {
      if (!isMounted) return
      setLogs(prev => {
        // Prevent duplicate logs if already present by ID or exact content
        if (newEntry.id && prev.some(l => l.id === newEntry.id)) {
          return prev
        }
        return [...prev, newEntry]
      })
    })

    return () => {
      isMounted = false
      unsubscribe()
    }
  }, [videoId, cameraId])

  // 2. Auto-scroll to bottom when new logs arrive if autoScroll is enabled
  useEffect(() => {
    if (autoScroll && logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight
    }
  }, [logs, autoScroll])

  const filteredLogs = useMemo(() => {
    if (activeCategory === 'ALL') return logs
    return logs.filter(l => l.category === activeCategory)
  }, [logs, activeCategory])

  const formatTimestamp = (raw: string) => {
    try {
      const d = new Date(raw)
      if (!isNaN(d.getTime())) {
        return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
      }
    } catch {}
    return raw.slice(11, 19) || raw
  }

  const handleScroll = () => {
    if (!logContainerRef.current) return
    const { scrollTop, scrollHeight, clientHeight } = logContainerRef.current
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 40
    setAutoScroll(isAtBottom)
  }

  return (
    <div className={cn(
      "flex flex-col bg-slate-950 text-slate-100 rounded-xl border border-slate-800 shadow-xl overflow-hidden font-mono text-[12px]",
      className
    )}>
      {/* Log Header */}
      <div className="flex items-center justify-between px-3.5 py-2.5 bg-slate-900 border-b border-slate-800 shrink-0">
        <div className="flex items-center gap-2">
          <Terminal className="w-4 h-4 text-emerald-400" />
          <span className="font-bold text-slate-200 uppercase tracking-wider text-[11px]">
            Analysis Logs
          </span>
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
            LIVE
          </span>
        </div>

        <div className="flex items-center gap-2">
          <select 
            value={activeCategory}
            onChange={(e) => setActiveCategory(e.target.value)}
            className="bg-slate-800 text-slate-300 text-[11px] rounded px-2 py-1 border border-slate-700 outline-none focus:border-slate-500 cursor-pointer"
          >
            <option value="ALL">All Events ({logs.length})</option>
            <option value="SYSTEM">System</option>
            <option value="UPLOAD">Upload</option>
            <option value="PROCESSING">Processing</option>
            <option value="MODEL">Model</option>
            <option value="DETECTION">Detection</option>
            <option value="TRACKING">Tracking</option>
            <option value="INCIDENT">Incidents</option>
            <option value="EVIDENCE">Evidence</option>
            <option value="PERSISTENCE">Persistence</option>
            <option value="ERROR">Errors</option>
          </select>

          {!autoScroll && (
            <button
              onClick={() => {
                setAutoScroll(true)
                if (logContainerRef.current) {
                  logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight
                }
              }}
              title="Scroll to bottom"
              className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
            >
              <ArrowDown className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Log Entries Container */}
      <div 
        ref={logContainerRef}
        onScroll={handleScroll}
        className="flex-1 p-3 overflow-y-auto space-y-1.5 scrollbar-thin scrollbar-thumb-slate-800 min-h-[300px] max-h-[560px]"
      >
        {filteredLogs.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-6 text-slate-500">
            <Activity className="w-8 h-8 mb-2 opacity-30 text-slate-400 animate-pulse" />
            <p className="text-[12px] font-sans">Awaiting pipeline events...</p>
            <span className="text-[11px] text-slate-600 font-sans mt-1">Logs will record uploads, model inference, tracks and incident checkpoints.</span>
          </div>
        ) : (
          filteredLogs.map((entry, idx) => {
            const colors = CATEGORY_COLORS[entry.category] || CATEGORY_COLORS.SYSTEM
            return (
              <div 
                key={entry.id || `${entry.timestamp}-${idx}`}
                className="flex items-start gap-2 py-1 px-1.5 rounded hover:bg-slate-900/60 transition-colors group leading-relaxed"
              >
                {/* Timestamp */}
                <span className="text-slate-500 shrink-0 text-[11px] select-none pt-0.5 font-medium">
                  {formatTimestamp(entry.timestamp)}
                </span>

                {/* Category Badge */}
                <span className={cn(
                  "shrink-0 px-1.5 py-0.5 rounded text-[10px] font-bold tracking-wider border select-none",
                  colors.bg,
                  colors.text,
                  colors.border
                )}>
                  {entry.category}
                </span>

                {/* Message */}
                <span className={cn(
                  "flex-1 text-[12px] break-words",
                  entry.category === 'ERROR' ? 'text-rose-300 font-semibold' : 
                  entry.category === 'INCIDENT' ? 'text-amber-200 font-medium' :
                  entry.category === 'EVIDENCE' ? 'text-pink-200' :
                  'text-slate-200'
                )}>
                  {entry.message}
                </span>
              </div>
            )
          })
        )}
      </div>

      {/* Log Footer Info */}
      <div className="px-3 py-1.5 bg-slate-900/80 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-slate-400 font-sans shrink-0">
        <span>{filteredLogs.length} events logged</span>
        <span className="text-slate-500">Persistent Session Audit</span>
      </div>
    </div>
  )
}
