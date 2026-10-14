import { useState, useEffect, useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { 
  FileText, Download, Calendar, FileSpreadsheet,
  Clock, Loader2, AlertTriangle, Car, Truck, Bus, Bike,
  Film, Filter, Eye, ChevronRight, CheckCircle2,
  Trash2, Plus, X, ArrowUpRight, ShieldAlert,
  Info, Sparkles, RefreshCw
} from 'lucide-react'
import { cn } from '../lib/utils'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/auth'
import type { VideoAsset, AnalysisRun } from '../services/db'
import { fallbackVideoNumbers, videoDisplayName } from '../lib/videoAssets'
import { subDays, startOfDay, endOfDay, format as formatDate, parseISO, isAfter } from 'date-fns'
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'

// ============================================================================
// Types & Domain Models
// ============================================================================

export type ReportType = 
  | 'traffic_summary' 
  | 'vehicle_classification' 
  | 'incident_violation' 
  | 'video_analysis'

export type DatePeriod = 'today' | '7d' | '30d' | 'custom'

interface TrackedObjectRow {
  id: string
  video_id: string | null
  track_id: number
  object_type: string
  confidence: number
  frame_count: number | null
  analysis_run_id: string | null
  created_at?: string
  metadata?: any
}

interface IncidentRow {
  id: string
  video_id: string | null
  camera_id: string | null
  incident_type: string
  severity: string | null
  description: string | null
  created_at: string
  analysis_run_id: string | null
  track_id: number | null
  cameras?: { name: string } | null
  location?: string | null
}

export interface ReportConfig {
  reportType: ReportType
  reportTypeLabel: string
  period: DatePeriod
  startDate: string | null
  endDate: string | null
  scopeType: 'all' | 'video' | 'run'
  scopeId: string | null
  scopeLabel: string
  format: 'PDF' | 'CSV'
  recordCount: number
  summary: {
    videoCount: number
    runCount: number
    uniqueVehicles: number
    rawDetectionsCount: number
    totalDurationSeconds: number
    totalFramesAnalyzed: number
    incidentCount: number
    incidentRatePerVideo: number
    incidentRatePer1kFrames: number
    speedCalibrationStatus: 'uncalibrated' | 'calibrated'
    vehicleClasses: {
      cars: number
      trucks: number
      buses: number
      motorcycles: number
    }
    severities: {
      critical: number
      high: number
      medium: number
      low: number
    }
    detectionProfilesUsed: string[]
    processingModesUsed: string[]
  }
  regenerationParams: {
    reportType: ReportType
    period: DatePeriod
    customStart: string | null
    customEnd: string | null
    scopeType: 'all' | 'video' | 'run'
    scopeId: string | null
  }
}

export interface SavedReportItem {
  id: string
  title: string
  config: ReportConfig
  created_by: string | null
  created_at: string
}

function getRunMetadata(run: AnalysisRun) {
  const m = (run.metrics && typeof run.metrics === 'object' && !Array.isArray(run.metrics) ? run.metrics : {}) as Record<string, any>
  const profile = m.detection_profile === 'high_recall' ? 'High Recall' : (m.detection_profile === 'balanced' ? 'Balanced' : 'Balanced')
  const speed = m.processing_speed === 'fast' ? 'Fast (2x)' : (m.processing_speed === 'full' ? 'Full (1x)' : 'Full (1x)')
  const uniqueVehicles = m.summary?.unique_vehicles ?? null
  const durationSeconds = m.summary?.duration_seconds ?? null
  const avgSpeed = m.summary?.average_speed_kmh ?? null
  const totalFrames = m.summary?.total_frames ?? null
  const fpsThroughput = m.summary?.fps ?? m.pipeline_fps ?? null
  return { profile, speed, uniqueVehicles, durationSeconds, avgSpeed, totalFrames, fpsThroughput, summary: m.summary }
}

const LOCAL_STORAGE_KEY = 'visionguard_saved_reports_cache'

// ============================================================================
// Main Component
// ============================================================================

export function Reports() {
  const navigate = useNavigate()
  const { user } = useAuthStore()

  // Data states
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [videos, setVideos] = useState<VideoAsset[]>([])
  const [runs, setRuns] = useState<AnalysisRun[]>([])
  const [trackedObjects, setTrackedObjects] = useState<TrackedObjectRow[]>([])
  const [incidents, setIncidents] = useState<IncidentRow[]>([])
  const [savedReports, setSavedReports] = useState<SavedReportItem[]>([])

  // Modal / Interaction states
  const [isGeneratorOpen, setIsGeneratorOpen] = useState(false)
  const [selectedReportForView, setSelectedReportForView] = useState<SavedReportItem | null>(null)
  const [isGenerating, setIsGenerating] = useState(false)
  const [actionSuccessMsg, setActionSuccessMsg] = useState<string | null>(null)
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)

  // Generator Form state
  const [formType, setFormType] = useState<ReportType>('traffic_summary')
  const [formPeriod, setFormPeriod] = useState<DatePeriod>('7d')
  const [formCustomStart, setFormCustomStart] = useState<string>(
    formatDate(subDays(new Date(), 7), 'yyyy-MM-dd')
  )
  const [formCustomEnd, setFormCustomEnd] = useState<string>(
    formatDate(new Date(), 'yyyy-MM-dd')
  )
  const [formScope, setFormScope] = useState<string>('all') // 'all' | 'video:<id>' | 'run:<id>'
  const [customTitle, setCustomTitle] = useState<string>('')

  // --------------------------------------------------------------------------
  // Data Fetching
  // --------------------------------------------------------------------------
  useEffect(() => {
    loadAllData()
  }, [])

  const loadAllData = async () => {
    setLoading(true)
    setError(null)
    try {
      const [videosRes, runsRes, tracksRes, incRes, savedRes] = await Promise.all([
        supabase.from('video_assets').select('*').order('uploaded_at', { ascending: false }),
        supabase.from('analysis_runs').select('*').order('started_at', { ascending: false }),
        supabase.from('tracked_objects').select('id, video_id, track_id, object_type, confidence, frame_count, analysis_run_id, created_at, metadata'),
        supabase.from('incidents').select('*, cameras(name)').order('created_at', { ascending: false }),
        supabase.from('saved_reports').select('*').order('created_at', { ascending: false })
      ])

      const fetchedVideos = (videosRes.data || []) as VideoAsset[]
      const fetchedRuns = (runsRes.data || []) as AnalysisRun[]
      const fetchedTracks = (tracksRes.data || []) as TrackedObjectRow[]
      const fetchedIncidents = (incRes.data || []) as IncidentRow[]

      setVideos(fetchedVideos)
      setRuns(fetchedRuns)
      setTrackedObjects(fetchedTracks)
      setIncidents(fetchedIncidents)

      // Merge saved reports from DB with any local mirror
      let combinedReports: SavedReportItem[] = []
      if (savedRes.data) {
        combinedReports = (savedRes.data as any[]).map(r => ({
          id: r.id,
          title: r.title,
          config: r.config as ReportConfig,
          created_by: r.created_by,
          created_at: r.created_at
        }))
      }

      // Check local storage for any reports that might not be synced
      try {
        const localRaw = localStorage.getItem(LOCAL_STORAGE_KEY)
        if (localRaw) {
          const localList = JSON.parse(localRaw) as SavedReportItem[]
          const existingIds = new Set(combinedReports.map(r => r.id))
          for (const item of localList) {
            if (!existingIds.has(item.id)) {
              combinedReports.push(item)
            }
          }
        }
      } catch (err) {
        console.warn('Error reading local report cache:', err)
      }

      // Sort reports by created_at descending
      combinedReports.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      setSavedReports(combinedReports)
    } catch (err) {
      console.error('Failed to load reports data:', err)
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  const fallbackNumbers = useMemo(() => fallbackVideoNumbers(videos), [videos])

  // Completed videos available for scoping
  const completedVideos = useMemo(() => {
    return videos.filter(v => v.processing_status === 'completed' || runs.some(r => r.video_id === v.id && r.status === 'completed'))
  }, [videos, runs])

  // Latest completed run per video (prevents double-counting duplicate runs of same video)
  const latestRunPerVideo = useMemo(() => {
    const map = new Map<string, AnalysisRun>()
    runs.forEach(r => {
      if (r.video_id && r.status === 'completed') {
        const existing = map.get(r.video_id)
        if (!existing || new Date(r.started_at) > new Date(existing.started_at)) {
          map.set(r.video_id, r)
        }
      }
    })
    return map
  }, [runs])

  // --------------------------------------------------------------------------
  // Report Calculations & Computation Engine
  // --------------------------------------------------------------------------
  const calculateReportData = (
    type: ReportType,
    period: DatePeriod,
    customStart: string | null,
    customEnd: string | null,
    scope: string
  ) => {
    // 1. Date boundaries
    const now = new Date()
    let startBoundary: Date | null = null
    let endBoundary: Date | null = endOfDay(now)

    if (period === 'today') {
      startBoundary = startOfDay(now)
    } else if (period === '7d') {
      startBoundary = subDays(now, 7)
    } else if (period === '30d') {
      startBoundary = subDays(now, 30)
    } else if (period === 'custom') {
      if (customStart) startBoundary = startOfDay(parseISO(customStart))
      if (customEnd) endBoundary = endOfDay(parseISO(customEnd))
    }

    // 2. Filter scoped runs
    const scopedRuns = runs.filter(r => {
      if (r.status !== 'completed') return false
      const runTime = new Date(r.started_at)
      if (startBoundary && runTime < startBoundary) return false
      if (endBoundary && runTime > endBoundary) return false

      if (scope.startsWith('run:')) {
        return r.id === scope.slice(4)
      }
      if (scope.startsWith('video:')) {
        return r.video_id === scope.slice(6)
      }
      // When 'all', use the latest completed run per video
      if (r.video_id) {
        const latest = latestRunPerVideo.get(r.video_id)
        return latest?.id === r.id
      }
      return false
    })

    const scopedRunIds = new Set(scopedRuns.map(r => r.id))
    const scopedVideoIds = new Set(scopedRuns.map(r => r.video_id).filter(Boolean) as string[])

    // 3. Tracked Objects (Deduplicated unique vehicles vs raw detections)
    const scopedTracks = trackedObjects.filter(t => {
      if (t.analysis_run_id && scopedRunIds.has(t.analysis_run_id)) return true
      if (t.video_id && scopedVideoIds.has(t.video_id)) return true
      return false
    })

    // Avoid double counting: unique (video_id, track_id) pairs
    const uniqueVehicleKeys = new Set<string>()
    let cars = 0
    let trucks = 0
    let buses = 0
    let motorcycles = 0
    let rawFrameDetections = 0

    const TRAFFIC_VEHICLES = new Set(['car', 'truck', 'bus', 'motorcycle', 'bicycle']);

    scopedTracks.forEach(t => {
      const typeNormalized = (t.object_type || '').toLowerCase();
      if (!TRAFFIC_VEHICLES.has(typeNormalized)) return;

      const key = `${t.video_id ?? 'unknown'}:${t.track_id}`;
      if (!uniqueVehicleKeys.has(key)) {
        uniqueVehicleKeys.add(key);
        if (typeNormalized.includes('car')) cars++;
        else if (typeNormalized.includes('truck')) trucks++;
        else if (typeNormalized.includes('bus')) buses++;
        else if (typeNormalized.includes('motorcycle') || typeNormalized.includes('bicycle') || typeNormalized.includes('bike')) motorcycles++;
      }
      rawFrameDetections += (t.frame_count || 1);
    });

    const uniqueVehiclesCount = uniqueVehicleKeys.size

    // 4. Incidents
    const scopedIncidentsList = incidents.filter(inc => {
      const incTime = new Date(inc.created_at)
      if (startBoundary && incTime < startBoundary) return false
      if (endBoundary && incTime > endBoundary) return false

      if (inc.analysis_run_id && scopedRunIds.has(inc.analysis_run_id)) return true
      if (inc.video_id && scopedVideoIds.has(inc.video_id)) return true
      return false
    })

    let criticalInc = 0
    let highInc = 0
    let mediumInc = 0
    let lowInc = 0

    scopedIncidentsList.forEach(inc => {
      const sev = (inc.severity || 'Medium').toLowerCase()
      if (sev === 'critical') criticalInc++
      else if (sev === 'high') highInc++
      else if (sev === 'low') lowInc++
      else mediumInc++
    })

    // 5. Total Processed Footage (Duration & Frames)
    let totalDurationSeconds = 0
    let totalFramesAnalyzed = 0
    const profilesSet = new Set<string>()
    const modesSet = new Set<string>()

    scopedRuns.forEach(r => {
      const meta = getRunMetadata(r)
      if (meta.durationSeconds) totalDurationSeconds += meta.durationSeconds
      else {
        const v = videos.find(vid => vid.id === r.video_id)
        if (v?.duration) totalDurationSeconds += v.duration
      }

      if (meta.totalFrames) totalFramesAnalyzed += meta.totalFrames
      else {
        const v = videos.find(vid => vid.id === r.video_id)
        const vMeta = (v?.metadata && typeof v.metadata === 'object' ? v.metadata : {}) as Record<string, any>
        if (vMeta.frame_count) totalFramesAnalyzed += Number(vMeta.frame_count)
      }

      profilesSet.add(meta.profile)
      modesSet.add(meta.speed)
    })

    // Rates
    const videoCount = scopedVideoIds.size || scopedRuns.length
    const incidentRatePerVideo = videoCount > 0 ? Number((scopedIncidentsList.length / videoCount).toFixed(2)) : 0
    const incidentRatePer1kFrames = totalFramesAnalyzed > 0 
      ? Number(((scopedIncidentsList.length / totalFramesAnalyzed) * 1000).toFixed(2)) 
      : 0

    // Scope Label
    let scopeLabel = 'All Analyzed Videos'
    if (scope.startsWith('video:')) {
      const vidId = scope.slice(6)
      const v = videos.find(item => item.id === vidId)
      scopeLabel = v ? `${videoDisplayName(v, fallbackNumbers)} (${v.filename})` : `Video ID: ${vidId}`
    } else if (scope.startsWith('run:')) {
      const runId = scope.slice(4)
      const r = runs.find(item => item.id === runId)
      const v = r ? videos.find(item => item.id === r.video_id) : null
      scopeLabel = v ? `Run #${runId.slice(0, 8)} (${videoDisplayName(v, fallbackNumbers)})` : `Run #${runId.slice(0, 8)}`
    }

    return {
      scopedRuns,
      scopedTracks,
      scopedIncidentsList,
      summary: {
        videoCount,
        runCount: scopedRuns.length,
        uniqueVehicles: uniqueVehiclesCount,
        rawDetectionsCount: rawFrameDetections,
        totalDurationSeconds: Math.round(totalDurationSeconds),
        totalFramesAnalyzed,
        incidentCount: scopedIncidentsList.length,
        incidentRatePerVideo,
        incidentRatePer1kFrames,
        speedCalibrationStatus: 'uncalibrated' as const,
        vehicleClasses: { cars, trucks, buses, motorcycles },
        severities: { critical: criticalInc, high: highInc, medium: mediumInc, low: lowInc },
        detectionProfilesUsed: Array.from(profilesSet),
        processingModesUsed: Array.from(modesSet)
      },
      scopeLabel,
      startBoundary,
      endBoundary
    }
  }

  // Auto-fill suggested report title when selections change
  useEffect(() => {
    const typeLabel = 
      formType === 'traffic_summary' ? 'Traffic Summary' :
      formType === 'vehicle_classification' ? 'Vehicle Classification' :
      formType === 'incident_violation' ? 'Incident & Violation' : 'Video Analysis'

    const periodLabel = 
      formPeriod === 'today' ? 'Today' :
      formPeriod === '7d' ? 'Last 7 Days' :
      formPeriod === '30d' ? 'Last 30 Days' : 'Custom Period'

    let target = 'All Videos'
    if (formScope.startsWith('video:')) {
      const v = videos.find(x => x.id === formScope.slice(6))
      if (v) target = videoDisplayName(v, fallbackNumbers)
    } else if (formScope.startsWith('run:')) {
      target = `Run #${formScope.slice(4, 12)}`
    }

    setCustomTitle(`${typeLabel} Report — ${target} (${periodLabel})`)
  }, [formType, formPeriod, formScope, videos, fallbackNumbers])

  // Validation
  const validationError = useMemo(() => {
    if (formPeriod === 'custom') {
      if (!formCustomStart || !formCustomEnd) {
        return 'Please choose both start and end dates for custom date range.'
      }
      if (isAfter(parseISO(formCustomStart), parseISO(formCustomEnd))) {
        return 'Start date cannot be after end date.'
      }
    }
    if (formType === 'video_analysis' && formScope === 'all') {
      return 'Video Analysis Report requires selecting a specific video or completed analysis run.'
    }
    return null
  }, [formPeriod, formCustomStart, formCustomEnd, formType, formScope])

  // --------------------------------------------------------------------------
  // PDF Generation Engine (using jsPDF & jspdf-autotable)
  // --------------------------------------------------------------------------
  const generatePdfDocument = (
    title: string,
    reportData: ReturnType<typeof calculateReportData>,
    config: ReportConfig
  ) => {
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
    const { summary, scopeLabel, scopedRuns, scopedIncidentsList } = reportData

    // 1. Professional Header Banner
    doc.setFillColor(15, 23, 42) // Slate 900
    doc.rect(0, 0, 210, 36, 'F')

    // System Branding
    doc.setTextColor(255, 255, 255)
    doc.setFontSize(14)
    doc.setFont('helvetica', 'bold')
    doc.text('VISIONGUARD INTELLIGENCE PLATFORM', 14, 14)

    doc.setFontSize(9)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(148, 163, 184) // Slate 400
    doc.text('OFFICIAL TRAFFIC SURVEILLANCE & SURVEILLANCE ANALYTICS REPORT', 14, 21)

    // Report Title & Type in Header
    doc.setFontSize(11)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(56, 189, 248) // Sky 400
    doc.text(title.toUpperCase(), 14, 30)

    // 2. Metadata Block
    doc.setFillColor(248, 250, 252) // Slate 50
    doc.setDrawColor(226, 232, 240) // Slate 200
    doc.rect(14, 42, 182, 24, 'FD')

    doc.setTextColor(71, 85, 105) // Slate 600
    doc.setFontSize(8.5)
    doc.setFont('helvetica', 'bold')
    doc.text('REPORT METADATA', 18, 48)

    doc.setFont('helvetica', 'normal')
    doc.setTextColor(15, 23, 42)
    doc.text(`Scope: ${scopeLabel}`, 18, 54)
    doc.text(`Timeframe: ${config.period === 'custom' ? `${config.startDate} to ${config.endDate}` : config.period.toUpperCase()}`, 18, 60)

    doc.text(`Generated: ${formatDate(new Date(), 'yyyy-MM-dd HH:mm:ss')}`, 105, 54)
    doc.text(`Officer / User: ${user?.email || 'Authorized Operator'}`, 105, 60)

    let currentY = 72

    // 3. Section: Executive Summary KPIs
    doc.setFontSize(10.5)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(15, 23, 42)
    doc.text('1. EXECUTIVE SUMMARY METRICS', 14, currentY)
    currentY += 4

    const kpiHeaders = ['Analyzed Footage', 'Unique Vehicles', 'Incident Count', 'Incident Rate', 'Speed Calib.']
    const durationFormatted = summary.totalDurationSeconds > 60
      ? `${Math.floor(summary.totalDurationSeconds / 60)}m ${summary.totalDurationSeconds % 60}s`
      : `${summary.totalDurationSeconds}s`

    const kpiRow = [
      `${summary.videoCount} video(s) • ${durationFormatted} (${summary.totalFramesAnalyzed.toLocaleString()} frames)`,
      `${summary.uniqueVehicles.toLocaleString()} vehicles (deduplicated)`,
      `${summary.incidentCount} recorded infractions`,
      `${summary.incidentRatePerVideo} / video (${summary.incidentRatePer1kFrames} / 1k frames)`,
      'Uncalibrated (requires multi-point camera survey)'
    ]

    autoTable(doc, {
      startY: currentY,
      head: [kpiHeaders],
      body: [kpiRow],
      theme: 'grid',
      headStyles: { fillColor: [15, 23, 42], textColor: 255, fontSize: 8, fontStyle: 'bold' },
      bodyStyles: { fontSize: 8, textColor: [30, 41, 59] },
      margin: { left: 14, right: 14 }
    })

    currentY = (doc as any).lastAutoTable.finalY + 8

    // 4. Section: Vehicle Classification Breakdown
    if (config.reportType === 'traffic_summary' || config.reportType === 'vehicle_classification' || config.reportType === 'video_analysis') {
      doc.setFontSize(10.5)
      doc.setFont('helvetica', 'bold')
      doc.setTextColor(15, 23, 42)
      doc.text('2. VEHICLE CLASSIFICATION DISTRIBUTION', 14, currentY)
      currentY += 4

      const totalV = summary.uniqueVehicles || 1
      const classHeaders = ['Category', 'Tracked Vehicles', 'Percentage of Traffic', 'Detection Pipeline Notes']
      const classRows = [
        ['Cars & Sedans', `${summary.vehicleClasses.cars.toLocaleString()}`, `${((summary.vehicleClasses.cars / totalV) * 100).toFixed(1)}%`, 'YOLO11n Class 2'],
        ['Commercial Trucks', `${summary.vehicleClasses.trucks.toLocaleString()}`, `${((summary.vehicleClasses.trucks / totalV) * 100).toFixed(1)}%`, 'YOLO11n Class 7'],
        ['Buses & Transits', `${summary.vehicleClasses.buses.toLocaleString()}`, `${((summary.vehicleClasses.buses / totalV) * 100).toFixed(1)}%`, 'YOLO11n Class 5'],
        ['Motorcycles & Bikes', `${summary.vehicleClasses.motorcycles.toLocaleString()}`, `${((summary.vehicleClasses.motorcycles / totalV) * 100).toFixed(1)}%`, 'YOLO11n Class 3'],
      ]

      autoTable(doc, {
        startY: currentY,
        head: [classHeaders],
        body: classRows,
        theme: 'striped',
        headStyles: { fillColor: [30, 41, 59], textColor: 255, fontSize: 8, fontStyle: 'bold' },
        bodyStyles: { fontSize: 8, textColor: [30, 41, 59] },
        alternateRowStyles: { fillColor: [248, 250, 252] },
        margin: { left: 14, right: 14 }
      })

      currentY = (doc as any).lastAutoTable.finalY + 8
    }

    // 5. Section: Incidents & Infractions
    if (config.reportType === 'traffic_summary' || config.reportType === 'incident_violation' || config.reportType === 'video_analysis') {
      // Check if page break is needed
      if (currentY > 230) {
        doc.addPage()
        currentY = 20
      }

      doc.setFontSize(10.5)
      doc.setFont('helvetica', 'bold')
      doc.setTextColor(15, 23, 42)
      doc.text('3. INCIDENT & SAFETY INFRACTION LOG', 14, currentY)
      currentY += 4

      const incHeaders = ['Incident ID', 'Type', 'Severity', 'Vehicle Track', 'Source Video', 'Timestamp']
      const incRows = scopedIncidentsList.length > 0
        ? scopedIncidentsList.slice(0, 50).map(inc => {
            const v = videos.find(vid => vid.id === inc.video_id)
            return [
              `#${inc.id.slice(0, 8)}`,
              inc.incident_type || 'General Infraction',
              inc.severity || 'Medium',
              inc.track_id !== null ? `Vehicle #${inc.track_id}` : '—',
              v ? videoDisplayName(v, fallbackNumbers) : 'Video Footage',
              new Date(inc.created_at).toLocaleString()
            ]
          })
        : [['No safety incidents or infractions were recorded in this scope.', '', '', '', '', '']]

      autoTable(doc, {
        startY: currentY,
        head: [incHeaders],
        body: incRows,
        theme: 'striped',
        headStyles: { fillColor: [30, 41, 59], textColor: 255, fontSize: 8, fontStyle: 'bold' },
        bodyStyles: { fontSize: 7.5, textColor: [30, 41, 59] },
        alternateRowStyles: { fillColor: [248, 250, 252] },
        margin: { left: 14, right: 14 }
      })

      currentY = (doc as any).lastAutoTable.finalY + 8
    }

    // 6. Section: Analysis Runs Reference (for Video Analysis or Traffic Summary)
    if (config.reportType === 'video_analysis' || config.reportType === 'traffic_summary') {
      if (currentY > 230) {
        doc.addPage()
        currentY = 20
      }

      doc.setFontSize(10.5)
      doc.setFont('helvetica', 'bold')
      doc.setTextColor(15, 23, 42)
      doc.text('4. SOURCE RUNS & PIPELINE SPECIFICATIONS', 14, currentY)
      currentY += 4

      const runHeaders = ['Run ID', 'Source Video', 'Profile', 'Speed Mode', 'FPS', 'Status', 'Executed']
      const runRows = scopedRuns.map(r => {
        const v = videos.find(vid => vid.id === r.video_id)
        const meta = getRunMetadata(r)
        return [
          `#${r.id.slice(0, 8)}`,
          v ? videoDisplayName(v, fallbackNumbers) : 'Video Asset',
          meta.profile,
          meta.speed,
          meta.fpsThroughput ? `${meta.fpsThroughput} fps` : '—',
          r.status,
          new Date(r.started_at).toLocaleString()
        ]
      })

      autoTable(doc, {
        startY: currentY,
        head: [runHeaders],
        body: runRows.length > 0 ? runRows : [['No analysis runs matched.', '', '', '', '', '', '']],
        theme: 'striped',
        headStyles: { fillColor: [30, 41, 59], textColor: 255, fontSize: 8, fontStyle: 'bold' },
        bodyStyles: { fontSize: 7.5, textColor: [30, 41, 59] },
        alternateRowStyles: { fillColor: [248, 250, 252] },
        margin: { left: 14, right: 14 }
      })

      currentY = (doc as any).lastAutoTable.finalY + 8
    }

    // 7. Official Legal & Technical Disclaimer
    if (currentY > 240) {
      doc.addPage()
      currentY = 20
    }

    doc.setFillColor(241, 245, 249) // Slate 100
    doc.setDrawColor(203, 213, 225)
    doc.rect(14, currentY, 182, 18, 'FD')

    doc.setFontSize(7)
    doc.setFont('helvetica', 'italic')
    doc.setTextColor(100, 116, 139)
    const disclaimer = 
      'TECHNICAL & LEGAL DISCLAIMER: Vehicle detections and safety incidents are generated algorithmically using VisionGuard local YOLO11n ONNX inference. Processing throughput FPS reflects system computation performance, not physical roadway speed. Speeds remain uncalibrated without physical ground-plane camera calibration. Algorithmic incident alerts serve as operational intelligence and do not represent confirmed legal citations.'
    doc.text(doc.splitTextToSize(disclaimer, 174), 18, currentY + 5)

    // 8. Page Numbers on Every Page
    const totalPages = (doc as any).internal.getNumberOfPages()
    for (let i = 1; i <= totalPages; i++) {
      doc.setPage(i)
      doc.setFontSize(7.5)
      doc.setFont('helvetica', 'normal')
      doc.setTextColor(148, 163, 184)
      doc.text(
        `VisionGuard Traffic Intelligence • Confidential Official Report • Page ${i} of ${totalPages}`,
        14,
        290
      )
    }

    return doc
  }

  // --------------------------------------------------------------------------
  // CSV Generation Engine
  // --------------------------------------------------------------------------
  const generateCsvContent = (
    reportData: ReturnType<typeof calculateReportData>,
    config: ReportConfig
  ) => {
    const { summary, scopeLabel, scopedRuns, scopedIncidentsList } = reportData
    const rows: string[][] = []

    // Header Metadata
    rows.push(['# VISIONGUARD INTELLIGENCE PLATFORM — TRAFFIC REPORT'])
    rows.push(['Report Type', config.reportTypeLabel])
    rows.push(['Scope', scopeLabel])
    rows.push(['Period', config.period])
    rows.push(['Generated At', formatDate(new Date(), 'yyyy-MM-dd HH:mm:ss')])
    rows.push(['Speed Calibration', 'Uncalibrated (Camera survey required)'])
    rows.push([])

    // Summary Section
    rows.push(['--- SUMMARY METRICS ---'])
    rows.push(['Videos Analyzed', String(summary.videoCount)])
    rows.push(['Analysis Runs', String(summary.runCount)])
    rows.push(['Unique Vehicles (Deduplicated)', String(summary.uniqueVehicles)])
    rows.push(['Raw Frame Detections', String(summary.rawDetectionsCount)])
    rows.push(['Total Duration (Seconds)', String(summary.totalDurationSeconds)])
    rows.push(['Total Frames Analyzed', String(summary.totalFramesAnalyzed)])
    rows.push(['Total Incidents', String(summary.incidentCount)])
    rows.push(['Incident Rate Per Video', String(summary.incidentRatePerVideo)])
    rows.push(['Incident Rate Per 1000 Frames', String(summary.incidentRatePer1kFrames)])
    rows.push([])

    // Classification Section
    rows.push(['--- VEHICLE CLASSIFICATION ---'])
    rows.push(['Category', 'Count', 'Percentage'])
    const totalV = summary.uniqueVehicles || 1
    rows.push(['Cars & Sedans', String(summary.vehicleClasses.cars), `${((summary.vehicleClasses.cars / totalV) * 100).toFixed(1)}%`])
    rows.push(['Commercial Trucks', String(summary.vehicleClasses.trucks), `${((summary.vehicleClasses.trucks / totalV) * 100).toFixed(1)}%`])
    rows.push(['Buses & Transits', String(summary.vehicleClasses.buses), `${((summary.vehicleClasses.buses / totalV) * 100).toFixed(1)}%`])
    rows.push(['Motorcycles & Bikes', String(summary.vehicleClasses.motorcycles), `${((summary.vehicleClasses.motorcycles / totalV) * 100).toFixed(1)}%`])
    rows.push([])

    // Incidents Section
    if (scopedIncidentsList.length > 0) {
      rows.push(['--- INCIDENTS & INFRACTIONS LOG ---'])
      rows.push(['Incident ID', 'Type', 'Severity', 'Vehicle Track ID', 'Video ID', 'Timestamp', 'Description'])
      scopedIncidentsList.forEach(inc => {
        rows.push([
          inc.id,
          inc.incident_type || 'General',
          inc.severity || 'Medium',
          inc.track_id !== null ? String(inc.track_id) : '',
          inc.video_id || '',
          inc.created_at,
          inc.description || ''
        ])
      })
      rows.push([])
    }

    // Analysis Runs Section
    if (scopedRuns.length > 0) {
      rows.push(['--- SOURCE ANALYSIS RUNS ---'])
      rows.push(['Run ID', 'Video ID', 'Profile', 'Speed Mode', 'FPS Throughput', 'Status', 'Started At'])
      scopedRuns.forEach(r => {
        const meta = getRunMetadata(r)
        rows.push([
          r.id,
          r.video_id || '',
          meta.profile,
          meta.speed,
          meta.fpsThroughput ? String(meta.fpsThroughput) : '',
          r.status,
          r.started_at
        ])
      })
    }

    // Escape and format as CSV text
    return rows.map(r => r.map(cell => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(',')).join('\n')
  }

  const downloadCsvFile = (filename: string, content: string) => {
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  // --------------------------------------------------------------------------
  // Persistence & Report Generation Action
  // --------------------------------------------------------------------------
  const handleGenerate = async (exportFormat: 'PDF' | 'CSV' | 'VIEW') => {
    if (validationError) return

    setIsGenerating(true)
    setActionSuccessMsg(null)

    try {
      const typeLabel = 
        formType === 'traffic_summary' ? 'Traffic Summary' :
        formType === 'vehicle_classification' ? 'Vehicle Classification' :
        formType === 'incident_violation' ? 'Incident & Violation' : 'Video Analysis'

      const reportData = calculateReportData(
        formType,
        formPeriod,
        formCustomStart,
        formCustomEnd,
        formScope
      )

      const titleToSave = customTitle.trim() || `${typeLabel} Report`
      const nowIso = new Date().toISOString()
      const newId = crypto.randomUUID()

      const configToSave: ReportConfig = {
        reportType: formType,
        reportTypeLabel: typeLabel,
        period: formPeriod,
        startDate: formPeriod === 'custom' ? formCustomStart : null,
        endDate: formPeriod === 'custom' ? formCustomEnd : null,
        scopeType: formScope.startsWith('video:') ? 'video' : formScope.startsWith('run:') ? 'run' : 'all',
        scopeId: formScope.startsWith('video:') ? formScope.slice(6) : formScope.startsWith('run:') ? formScope.slice(4) : null,
        scopeLabel: reportData.scopeLabel,
        format: exportFormat === 'CSV' ? 'CSV' : 'PDF',
        recordCount: reportData.scopedIncidentsList.length + reportData.scopedRuns.length,
        summary: reportData.summary,
        regenerationParams: {
          reportType: formType,
          period: formPeriod,
          customStart: formCustomStart,
          customEnd: formCustomEnd,
          scopeType: formScope.startsWith('video:') ? 'video' : formScope.startsWith('run:') ? 'run' : 'all',
          scopeId: formScope.startsWith('video:') ? formScope.slice(6) : formScope.startsWith('run:') ? formScope.slice(4) : null
        }
      }

      const newReportItem: SavedReportItem = {
        id: newId,
        title: titleToSave,
        config: configToSave,
        created_by: user?.id || null,
        created_at: nowIso
      }

      // 1. Persist to Supabase saved_reports
      try {
        const { error: insertErr } = await supabase.from('saved_reports').insert([{
          id: newId,
          title: titleToSave,
          config: configToSave as any,
          created_by: user?.id || null
        }])
        if (insertErr) console.warn('Supabase saved_reports insert warning:', insertErr)
      } catch (dbErr) {
        console.warn('Database insert failed, persisting to local storage backup:', dbErr)
      }

      // 2. Persist to Local Storage Cache
      try {
        const existing = [...savedReports]
        const updated = [newReportItem, ...existing]
        setSavedReports(updated)
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(updated.slice(0, 50)))
      } catch (cacheErr) {
        console.warn('Local storage write warning:', cacheErr)
      }

      // 3. Perform Export / Open View
      const timestampClean = formatDate(new Date(), 'yyyy-MM-dd_HHmm')
      const sanitizedName = titleToSave.replace(/[^a-zA-Z0-9_-]/g, '_')

      if (exportFormat === 'PDF') {
        const doc = generatePdfDocument(titleToSave, reportData, configToSave)
        doc.save(`${sanitizedName}_${timestampClean}.pdf`)
        setActionSuccessMsg(`Generated and downloaded ${titleToSave} as PDF.`)
      } else if (exportFormat === 'CSV') {
        const csvText = generateCsvContent(reportData, configToSave)
        downloadCsvFile(`${sanitizedName}_${timestampClean}.csv`, csvText)
        setActionSuccessMsg(`Generated and downloaded ${titleToSave} as CSV.`)
      } else {
        setSelectedReportForView(newReportItem)
        setActionSuccessMsg(`Report generated successfully.`)
      }

      setIsGeneratorOpen(false)
      setTimeout(() => setActionSuccessMsg(null), 5000)
    } catch (err: any) {
      console.error('Report generation error:', err)
      setError(`Failed to generate report: ${err.message || String(err)}`)
    } finally {
      setIsGenerating(false)
    }
  }

  // --------------------------------------------------------------------------
  // Regenerate / Download from History Actions
  // --------------------------------------------------------------------------
  const handleDownloadSavedPdf = (item: SavedReportItem) => {
    try {
      const p = item.config.regenerationParams || {
        reportType: item.config.reportType,
        period: item.config.period,
        customStart: item.config.startDate,
        customEnd: item.config.endDate,
        scopeType: item.config.scopeType,
        scopeId: item.config.scopeId
      }

      const scopeString = p.scopeType === 'video' ? `video:${p.scopeId}` : p.scopeType === 'run' ? `run:${p.scopeId}` : 'all'
      const reportData = calculateReportData(p.reportType, p.period, p.customStart, p.customEnd, scopeString)

      const doc = generatePdfDocument(item.title, reportData, item.config)
      const sanitized = item.title.replace(/[^a-zA-Z0-9_-]/g, '_')
      doc.save(`${sanitized}.pdf`)
      setActionSuccessMsg(`Downloaded PDF: ${item.title}`)
      setTimeout(() => setActionSuccessMsg(null), 3000)
    } catch (err: any) {
      console.error('Failed to regenerate PDF:', err)
      setError(`Could not download PDF: ${err.message}`)
    }
  }

  const handleDownloadSavedCsv = (item: SavedReportItem) => {
    try {
      const p = item.config.regenerationParams || {
        reportType: item.config.reportType,
        period: item.config.period,
        customStart: item.config.startDate,
        customEnd: item.config.endDate,
        scopeType: item.config.scopeType,
        scopeId: item.config.scopeId
      }

      const scopeString = p.scopeType === 'video' ? `video:${p.scopeId}` : p.scopeType === 'run' ? `run:${p.scopeId}` : 'all'
      const reportData = calculateReportData(p.reportType, p.period, p.customStart, p.customEnd, scopeString)

      const csvText = generateCsvContent(reportData, item.config)
      const sanitized = item.title.replace(/[^a-zA-Z0-9_-]/g, '_')
      downloadCsvFile(`${sanitized}.csv`, csvText)
      setActionSuccessMsg(`Downloaded CSV: ${item.title}`)
      setTimeout(() => setActionSuccessMsg(null), 3000)
    } catch (err: any) {
      console.error('Failed to regenerate CSV:', err)
      setError(`Could not download CSV: ${err.message}`)
    }
  }

  const handleDeleteSavedReport = async (id: string) => {
    try {
      // 1. Delete in DB
      await supabase.from('saved_reports').delete().eq('id', id)
      // 2. Remove in State & Local Cache
      const updated = savedReports.filter(r => r.id !== id)
      setSavedReports(updated)
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(updated.slice(0, 50)))
      setDeleteConfirmId(null)
      if (selectedReportForView?.id === id) setSelectedReportForView(null)
      setActionSuccessMsg('Report deleted from history.')
      setTimeout(() => setActionSuccessMsg(null), 3000)
    } catch (err: any) {
      console.error('Delete report error:', err)
      setError(`Failed to delete report: ${err.message}`)
    }
  }

  // --------------------------------------------------------------------------
  // Summary Stats for Top Operational KPI Bar
  // --------------------------------------------------------------------------
  const aggregateStats = useMemo(() => {
    let totalVehicles = 0
    const vehicleKeySet = new Set<string>()
    trackedObjects.forEach(t => {
      vehicleKeySet.add(`${t.video_id ?? 'unk'}:${t.track_id}`)
    })
    totalVehicles = vehicleKeySet.size

    return {
      totalReports: savedReports.length,
      analyzedVideosCount: completedVideos.length,
      totalTrackedVehicles: totalVehicles,
      totalIncidents: incidents.length
    }
  }, [savedReports, completedVideos, trackedObjects, incidents])

  // ==========================================================================
  // Render
  // ==========================================================================

  return (
    <div className="space-y-6 max-w-[1600px] mx-auto pb-12">
      
      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 pb-2 border-b border-slate-200">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">Traffic Reports</h1>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200">
              Operational Workspace
            </span>
          </div>
          <p className="text-sm text-slate-500 mt-1">
            Generate and export traffic intelligence reports from your analyzed footage.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Link
            to="/app/analytics"
            className="flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-lg text-xs font-semibold shadow-xs transition-colors cursor-pointer"
          >
            <span>Analytics</span>
          </Link>
          <button
            onClick={() => {
              setIsGeneratorOpen(true)
            }}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold shadow-xs transition-colors cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Generate Report</span>
          </button>
        </div>
      </div>

      {/* Success & Error Banners */}
      {actionSuccessMsg && (
        <div className="p-3.5 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg text-sm flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{actionSuccessMsg}</span>
          </div>
          <button onClick={() => setActionSuccessMsg(null)} className="text-emerald-700 hover:text-emerald-900">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {error && (
        <div className="p-3.5 bg-rose-50 border border-rose-200 text-rose-800 rounded-lg text-sm flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{error}</span>
          </div>
          <button onClick={() => setError(null)} className="text-rose-700 hover:text-rose-900">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Top Operational Metrics Bar */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500 uppercase tracking-wider">Saved Reports</span>
            <FileText className="w-4 h-4 text-blue-500" />
          </div>
          <div className="text-2xl font-bold text-slate-900 mt-2">{aggregateStats.totalReports}</div>
          <p className="text-xs text-slate-400 mt-1">Stored report executions</p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500 uppercase tracking-wider">Analyzed Footage</span>
            <Film className="w-4 h-4 text-emerald-500" />
          </div>
          <div className="text-2xl font-bold text-slate-900 mt-2">{aggregateStats.analyzedVideosCount}</div>
          <p className="text-xs text-slate-400 mt-1">Completed video assets</p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500 uppercase tracking-wider">Unique Vehicles</span>
            <Car className="w-4 h-4 text-cyan-500" />
          </div>
          <div className="text-2xl font-bold text-slate-900 mt-2">{aggregateStats.totalTrackedVehicles.toLocaleString()}</div>
          <p className="text-xs text-slate-400 mt-1">Deduplicated across runs</p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500 uppercase tracking-wider">Recorded Infractions</span>
            <ShieldAlert className="w-4 h-4 text-amber-500" />
          </div>
          <div className="text-2xl font-bold text-slate-900 mt-2">{aggregateStats.totalIncidents}</div>
          <p className="text-xs text-slate-400 mt-1">Safety events detected</p>
        </div>
      </div>

      {/* Main Content Area */}
      {loading ? (
        <div className="bg-white border border-slate-200 rounded-xl p-16 text-center flex flex-col items-center shadow-xs">
          <Loader2 className="w-8 h-8 text-blue-600 animate-spin mb-3" />
          <h3 className="text-base font-semibold text-slate-900">Loading Report Workspace</h3>
          <p className="text-sm text-slate-500 max-w-sm mt-1">
            Retrieving analyzed video datasets, tracking records, and report history...
          </p>
        </div>
      ) : completedVideos.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-16 text-center flex flex-col items-center shadow-xs">
          <div className="w-12 h-12 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center mb-4">
            <Film className="w-6 h-6" />
          </div>
          <h3 className="text-lg font-bold text-slate-900 mb-1">No Analyzed Footage Available</h3>
          <p className="text-sm text-slate-500 max-w-md mb-6">
            VisionGuard reports are generated from actual analyzed video footage. Analyze video footage in Live Analysis to begin generating traffic reports.
          </p>
          <Link
            to="/app/analyze"
            className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold shadow-xs"
          >
            Go to Live Analysis
          </Link>
        </div>
      ) : savedReports.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-16 text-center flex flex-col items-center shadow-xs">
          <div className="w-14 h-14 rounded-2xl bg-slate-100 text-slate-500 flex items-center justify-center mb-4">
            <FileSpreadsheet className="w-7 h-7" />
          </div>
          <h3 className="text-lg font-bold text-slate-900 mb-1">No Generated Reports Yet</h3>
          <p className="text-sm text-slate-500 max-w-md mb-6">
            Create your first official traffic intelligence report using your analyzed footage. Choose between Traffic Summary, Vehicle Classification, Incident Logs, or Video Run Reports.
          </p>
          <button
            onClick={() => setIsGeneratorOpen(true)}
            className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold shadow-sm cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Generate First Report</span>
          </button>
        </div>
      ) : (
        /* Report History Table */
        <div className="bg-white border border-slate-200 rounded-xl shadow-xs overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-slate-900">Generated Reports History</h2>
              <p className="text-xs text-slate-500">
                Persistent log of generated traffic intelligence reports with on-demand PDF and CSV export.
              </p>
            </div>
            <button
              onClick={() => setIsGeneratorOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-lg cursor-pointer transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>New Report</span>
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead className="bg-slate-50/80 border-b border-slate-200">
                <tr>
                  <th className="px-6 py-3.5 text-xs font-semibold text-slate-500 uppercase tracking-wider">Report Title & Type</th>
                  <th className="px-6 py-3.5 text-xs font-semibold text-slate-500 uppercase tracking-wider">Scope & Timeframe</th>
                  <th className="px-6 py-3.5 text-xs font-semibold text-slate-500 uppercase tracking-wider">Key Findings</th>
                  <th className="px-6 py-3.5 text-xs font-semibold text-slate-500 uppercase tracking-wider">Generated At</th>
                  <th className="px-6 py-3.5 text-xs font-semibold text-slate-500 uppercase tracking-wider text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {savedReports.map(rep => {
                  const cfg = rep.config
                  const typeLabel = cfg?.reportTypeLabel || 'Report'
                  const summary = cfg?.summary

                  return (
                    <tr key={rep.id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="px-6 py-4">
                        <div className="font-semibold text-slate-900 mb-1 flex items-center gap-2">
                          <span>{rep.title}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={cn(
                            "px-2 py-0.5 rounded text-[11px] font-semibold uppercase tracking-wider",
                            cfg?.reportType === 'traffic_summary' ? "bg-blue-50 text-blue-700 border border-blue-200" :
                            cfg?.reportType === 'vehicle_classification' ? "bg-purple-50 text-purple-700 border border-purple-200" :
                            cfg?.reportType === 'incident_violation' ? "bg-amber-50 text-amber-700 border border-amber-200" :
                            "bg-emerald-50 text-emerald-700 border border-emerald-200"
                          )}>
                            {typeLabel}
                          </span>
                          <span className="text-xs text-slate-400">
                            ID: #{rep.id.slice(0, 8)}
                          </span>
                        </div>
                      </td>

                      <td className="px-6 py-4">
                        <div className="text-xs font-medium text-slate-800">
                          {cfg?.scopeLabel || 'All Analyzed Videos'}
                        </div>
                        <div className="text-xs text-slate-400 mt-0.5 flex items-center gap-1">
                          <Calendar className="w-3 h-3 text-slate-400" />
                          <span>
                            {cfg?.period === 'custom' 
                              ? `${cfg.startDate} to ${cfg.endDate}` 
                              : (cfg?.period?.toUpperCase() || 'ALL TIME')}
                          </span>
                        </div>
                      </td>

                      <td className="px-6 py-4">
                        {summary ? (
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-100 text-slate-700 text-xs font-medium">
                              <Car className="w-3 h-3 text-cyan-600" />
                              {summary.uniqueVehicles} vehicles
                            </span>
                            <span className={cn(
                              "inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium",
                              summary.incidentCount > 0 ? "bg-amber-50 text-amber-800 border border-amber-200" : "bg-slate-100 text-slate-600"
                            )}>
                              <ShieldAlert className="w-3 h-3 text-amber-600" />
                              {summary.incidentCount} incidents
                            </span>
                          </div>
                        ) : (
                          <span className="text-xs text-slate-400">—</span>
                        )}
                      </td>

                      <td className="px-6 py-4 text-xs text-slate-600">
                        <div>{formatDate(new Date(rep.created_at), 'MMM d, yyyy • h:mm a')}</div>
                        <div className="text-slate-400 text-[11px] mt-0.5">
                          {rep.created_by ? 'Staff Operator' : 'System'}
                        </div>
                      </td>

                      <td className="px-6 py-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => setSelectedReportForView(rep)}
                            title="View Report Details"
                            className="p-1.5 rounded-lg text-slate-600 hover:text-blue-600 hover:bg-blue-50 transition-colors cursor-pointer"
                          >
                            <Eye className="w-4 h-4" />
                          </button>

                          <button
                            onClick={() => handleDownloadSavedPdf(rep)}
                            title="Download PDF"
                            className="p-1.5 rounded-lg text-slate-600 hover:text-blue-600 hover:bg-blue-50 transition-colors cursor-pointer"
                          >
                            <FileText className="w-4 h-4" />
                          </button>

                          <button
                            onClick={() => handleDownloadSavedCsv(rep)}
                            title="Download CSV"
                            className="p-1.5 rounded-lg text-slate-600 hover:text-emerald-600 hover:bg-emerald-50 transition-colors cursor-pointer"
                          >
                            <Download className="w-4 h-4" />
                          </button>

                          {deleteConfirmId === rep.id ? (
                            <div className="flex items-center gap-1 ml-2">
                              <button
                                onClick={() => handleDeleteSavedReport(rep.id)}
                                className="px-2 py-1 bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold rounded cursor-pointer"
                              >
                                Delete
                              </button>
                              <button
                                onClick={() => setDeleteConfirmId(null)}
                                className="p-1 text-slate-400 hover:text-slate-600 rounded cursor-pointer"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => setDeleteConfirmId(rep.id)}
                              title="Delete Report"
                              className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* Report Generator Modal */}
      {/* ==================================================================== */}
      {isGeneratorOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-3xl overflow-hidden my-8">
            
            {/* Modal Header */}
            <div className="px-6 py-4.5 bg-slate-900 text-white flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold">Generate Traffic Intelligence Report</h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Select report specifications and query parameters to compile official surveillance data.
                </p>
              </div>
              <button
                onClick={() => setIsGeneratorOpen(false)}
                className="text-slate-400 hover:text-white p-1 rounded-lg transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-6 max-h-[75vh] overflow-y-auto">
              
              {/* 1. Report Type Selection */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-2.5">
                  1. Report Type
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {[
                    {
                      id: 'traffic_summary' as ReportType,
                      title: 'Traffic Summary',
                      desc: 'Full operational summary: volume, deduplicated vehicles, infractions, duration & pipeline settings.',
                      icon: FileText
                    },
                    {
                      id: 'vehicle_classification' as ReportType,
                      title: 'Vehicle Classification',
                      desc: 'Breakdown of Cars, Trucks, Buses, and Motorcycles with share percentages and run sources.',
                      icon: Car
                    },
                    {
                      id: 'incident_violation' as ReportType,
                      title: 'Incident and Violation Report',
                      desc: 'Itemized log of infractions, types, severities, video timestamps, and review links.',
                      icon: ShieldAlert
                    },
                    {
                      id: 'video_analysis' as ReportType,
                      title: 'Video Analysis Report',
                      desc: 'Detailed run report for a selected video: duration, YOLO11n profile, pipeline FPS & counts.',
                      icon: Film
                    }
                  ].map(item => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setFormType(item.id)}
                      className={cn(
                        "p-3.5 rounded-xl border text-left cursor-pointer transition-all flex items-start gap-3",
                        formType === item.id 
                          ? "border-blue-600 bg-blue-50/50 text-blue-950 ring-1 ring-blue-600 shadow-xs" 
                          : "border-slate-200 hover:border-slate-300 text-slate-700 bg-white"
                      )}
                    >
                      <item.icon className={cn(
                        "w-5 h-5 shrink-0 mt-0.5",
                        formType === item.id ? "text-blue-600" : "text-slate-400"
                      )} />
                      <div>
                        <div className="font-bold text-sm">{item.title}</div>
                        <div className="text-xs text-slate-500 mt-0.5 leading-relaxed">{item.desc}</div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* 2. Video Scope Selection */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-2.5">
                  2. Video Scope
                </label>
                <select
                  value={formScope}
                  onChange={e => setFormScope(e.target.value)}
                  className="w-full bg-white border border-slate-200 rounded-lg p-2.5 text-sm font-medium text-slate-800 outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 cursor-pointer shadow-xs"
                >
                  {formType !== 'video_analysis' && (
                    <option value="all">
                      All Analyzed Videos (Latest completed run per video, anti-inflation policy)
                    </option>
                  )}
                  <optgroup label="Specific Saved Videos">
                    {completedVideos.map(v => (
                      <option key={v.id} value={`video:${v.id}`}>
                        {videoDisplayName(v, fallbackNumbers)} — {v.filename} ({v.duration ? `${Math.round(v.duration)}s` : 'analyzed'})
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="Specific Completed Analysis Runs">
                    {runs.filter(r => r.status === 'completed').slice(0, 15).map(r => {
                      const v = videos.find(x => x.id === r.video_id)
                      const meta = getRunMetadata(r)
                      return (
                        <option key={r.id} value={`run:${r.id}`}>
                          Run #{r.id.slice(0, 8)}: {v ? videoDisplayName(v, fallbackNumbers) : 'Video'} ({meta.profile}, {meta.speed})
                        </option>
                      )
                    })}
                  </optgroup>
                </select>
                {formType === 'video_analysis' && formScope === 'all' && (
                  <p className="text-xs text-rose-600 mt-1 font-medium">
                    * Please choose a specific video or completed analysis run for the Video Analysis Report.
                  </p>
                )}
              </div>

              {/* 3. Reporting Period */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-2.5">
                  3. Reporting Period
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mb-3">
                  {[
                    { id: 'today' as DatePeriod, label: 'Today' },
                    { id: '7d' as DatePeriod, label: 'Last 7 Days' },
                    { id: '30d' as DatePeriod, label: 'Last 30 Days' },
                    { id: 'custom' as DatePeriod, label: 'Custom Range' }
                  ].map(p => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setFormPeriod(p.id)}
                      className={cn(
                        "py-2 px-3 rounded-lg border text-xs font-bold cursor-pointer transition-all text-center",
                        formPeriod === p.id 
                          ? "border-blue-600 bg-blue-50/60 text-blue-900" 
                          : "border-slate-200 hover:border-slate-300 text-slate-700 bg-white"
                      )}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>

                {formPeriod === 'custom' && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 bg-slate-50 border border-slate-200 rounded-lg">
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">Start Date</label>
                      <input
                        type="date"
                        value={formCustomStart}
                        onChange={e => setFormCustomStart(e.target.value)}
                        className="w-full bg-white border border-slate-200 rounded-md p-2 text-xs text-slate-800 outline-none focus:ring-1 focus:ring-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">End Date</label>
                      <input
                        type="date"
                        value={formCustomEnd}
                        onChange={e => setFormCustomEnd(e.target.value)}
                        className="w-full bg-white border border-slate-200 rounded-md p-2 text-xs text-slate-800 outline-none focus:ring-1 focus:ring-blue-500"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* 4. Report Title */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-2">
                  4. Report Title
                </label>
                <input
                  type="text"
                  value={customTitle}
                  onChange={e => setCustomTitle(e.target.value)}
                  placeholder="Enter custom report title..."
                  className="w-full bg-white border border-slate-200 rounded-lg p-2.5 text-sm text-slate-800 outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 shadow-xs"
                />
              </div>

              {/* Data Preview & Policy Notice */}
              <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-2 text-xs text-slate-600">
                <div className="flex items-center gap-2 font-semibold text-slate-800">
                  <Info className="w-4 h-4 text-blue-600 shrink-0" />
                  <span>Real Data Assurance</span>
                </div>
                <p>
                  This report queries actual persisted records in Supabase (<code className="text-slate-800">video_assets</code>, <code className="text-slate-800">analysis_runs</code>, <code className="text-slate-800">tracked_objects</code>, <code className="text-slate-800">incidents</code>). Vehicle counts deduplicate recurring tracks across repeat runs. Speeds are explicitly declared uncalibrated.
                </p>
              </div>

              {validationError && (
                <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 rounded-lg text-xs font-medium flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                  <span>{validationError}</span>
                </div>
              )}

            </div>

            {/* Modal Actions */}
            <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => setIsGeneratorOpen(false)}
                className="w-full sm:w-auto px-4 py-2 border border-slate-200 hover:bg-slate-100 text-slate-700 text-sm font-semibold rounded-lg transition-colors cursor-pointer"
              >
                Cancel
              </button>

              <div className="flex items-center gap-2.5 w-full sm:w-auto">
                <button
                  type="button"
                  disabled={isGenerating || !!validationError}
                  onClick={() => handleGenerate('VIEW')}
                  className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-4 py-2 border border-blue-600 text-blue-600 hover:bg-blue-50 text-sm font-semibold rounded-lg transition-colors cursor-pointer disabled:opacity-50"
                >
                  <Eye className="w-4 h-4" />
                  <span>Save & Preview</span>
                </button>

                <button
                  type="button"
                  disabled={isGenerating || !!validationError}
                  onClick={() => handleGenerate('CSV')}
                  className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold rounded-lg transition-colors cursor-pointer disabled:opacity-50"
                >
                  <Download className="w-4 h-4" />
                  <span>Export CSV</span>
                </button>

                <button
                  type="button"
                  disabled={isGenerating || !!validationError}
                  onClick={() => handleGenerate('PDF')}
                  className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg transition-colors cursor-pointer disabled:opacity-50 shadow-sm"
                >
                  {isGenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
                  <span>Export PDF</span>
                </button>
              </div>
            </div>

          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* In-App Report Details / Viewer Modal */}
      {/* ==================================================================== */}
      {selectedReportForView && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-4xl overflow-hidden my-6">
            
            {/* Viewer Header */}
            <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="px-2 py-0.5 rounded text-[11px] font-bold uppercase tracking-wider bg-blue-500/20 text-blue-300 border border-blue-400/30">
                    {selectedReportForView.config?.reportTypeLabel || 'Report Details'}
                  </span>
                  <span className="text-xs text-slate-400">
                    #{selectedReportForView.id.slice(0, 8)}
                  </span>
                </div>
                <h3 className="text-lg font-bold">{selectedReportForView.title}</h3>
              </div>
              <button
                onClick={() => setSelectedReportForView(null)}
                className="text-slate-400 hover:text-white p-1 rounded-lg transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Viewer Body */}
            <div className="p-6 space-y-6 max-h-[75vh] overflow-y-auto">
              
              {/* Metadata Banner */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 p-4 bg-slate-50 border border-slate-200 rounded-xl text-xs">
                <div>
                  <span className="text-slate-400 block font-medium">Scope</span>
                  <span className="font-bold text-slate-800 text-sm mt-0.5 block truncate">
                    {selectedReportForView.config?.scopeLabel}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block font-medium">Time Window</span>
                  <span className="font-bold text-slate-800 text-sm mt-0.5 block">
                    {selectedReportForView.config?.period === 'custom'
                      ? `${selectedReportForView.config.startDate} to ${selectedReportForView.config.endDate}`
                      : selectedReportForView.config?.period?.toUpperCase()}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block font-medium">Generated At</span>
                  <span className="font-bold text-slate-800 text-sm mt-0.5 block">
                    {formatDate(new Date(selectedReportForView.created_at), 'MMM d, yyyy • h:mm a')}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block font-medium">Speed Status</span>
                  <span className="font-bold text-amber-700 text-sm mt-0.5 block">
                    Uncalibrated
                  </span>
                </div>
              </div>

              {/* KPI Cards */}
              {selectedReportForView.config?.summary && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="p-3.5 bg-white border border-slate-200 rounded-xl">
                    <span className="text-xs text-slate-500 font-medium">Unique Vehicles</span>
                    <div className="text-2xl font-bold text-slate-900 mt-1">
                      {selectedReportForView.config.summary.uniqueVehicles.toLocaleString()}
                    </div>
                    <span className="text-[11px] text-slate-400">Deduplicated across runs</span>
                  </div>

                  <div className="p-3.5 bg-white border border-slate-200 rounded-xl">
                    <span className="text-xs text-slate-500 font-medium">Recorded Incidents</span>
                    <div className="text-2xl font-bold text-slate-900 mt-1">
                      {selectedReportForView.config.summary.incidentCount}
                    </div>
                    <span className="text-[11px] text-slate-400">Safety infractions</span>
                  </div>

                  <div className="p-3.5 bg-white border border-slate-200 rounded-xl">
                    <span className="text-xs text-slate-500 font-medium">Analyzed Duration</span>
                    <div className="text-2xl font-bold text-slate-900 mt-1">
                      {selectedReportForView.config.summary.totalDurationSeconds}s
                    </div>
                    <span className="text-[11px] text-slate-400">
                      {selectedReportForView.config.summary.totalFramesAnalyzed.toLocaleString()} total frames
                    </span>
                  </div>

                  <div className="p-3.5 bg-white border border-slate-200 rounded-xl">
                    <span className="text-xs text-slate-500 font-medium">Incident Rate</span>
                    <div className="text-2xl font-bold text-slate-900 mt-1">
                      {selectedReportForView.config.summary.incidentRatePerVideo}
                    </div>
                    <span className="text-[11px] text-slate-400">Per video asset</span>
                  </div>
                </div>
              )}

              {/* Vehicle Classification Breakdown */}
              {selectedReportForView.config?.summary?.vehicleClasses && (
                <div className="border border-slate-200 rounded-xl overflow-hidden">
                  <div className="px-4 py-3 bg-slate-50 border-b border-slate-200">
                    <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                      Vehicle Classification Breakdown
                    </h4>
                  </div>
                  <div className="p-4 grid grid-cols-2 sm:grid-cols-4 gap-4">
                    {[
                      { label: 'Cars & Sedans', count: selectedReportForView.config.summary.vehicleClasses.cars, color: 'text-cyan-600', bg: 'bg-cyan-50' },
                      { label: 'Commercial Trucks', count: selectedReportForView.config.summary.vehicleClasses.trucks, color: 'text-amber-600', bg: 'bg-amber-50' },
                      { label: 'Buses & Transits', count: selectedReportForView.config.summary.vehicleClasses.buses, color: 'text-emerald-600', bg: 'bg-emerald-50' },
                      { label: 'Motorcycles & Bikes', count: selectedReportForView.config.summary.vehicleClasses.motorcycles, color: 'text-purple-600', bg: 'bg-purple-50' }
                    ].map(cls => {
                      const total = selectedReportForView.config.summary.uniqueVehicles || 1
                      const pct = ((cls.count / total) * 100).toFixed(1)
                      return (
                        <div key={cls.label} className={cn("p-3 rounded-lg border border-slate-200/80", cls.bg)}>
                          <span className="text-xs text-slate-600 font-medium">{cls.label}</span>
                          <div className={cn("text-xl font-bold mt-1", cls.color)}>{cls.count}</div>
                          <span className="text-xs text-slate-500">{pct}% of traffic</span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Incidents Severity Breakdown */}
              {selectedReportForView.config?.summary?.severities && (
                <div className="border border-slate-200 rounded-xl overflow-hidden">
                  <div className="px-4 py-3 bg-slate-50 border-b border-slate-200">
                    <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                      Incident Severity Distribution
                    </h4>
                  </div>
                  <div className="p-4 grid grid-cols-2 sm:grid-cols-4 gap-4">
                    <div className="p-3 rounded-lg border border-rose-200 bg-rose-50/50">
                      <span className="text-xs text-rose-800 font-medium">Critical</span>
                      <div className="text-xl font-bold text-rose-700 mt-1">
                        {selectedReportForView.config.summary.severities.critical}
                      </div>
                    </div>
                    <div className="p-3 rounded-lg border border-amber-200 bg-amber-50/50">
                      <span className="text-xs text-amber-800 font-medium">High</span>
                      <div className="text-xl font-bold text-amber-700 mt-1">
                        {selectedReportForView.config.summary.severities.high}
                      </div>
                    </div>
                    <div className="p-3 rounded-lg border border-blue-200 bg-blue-50/50">
                      <span className="text-xs text-blue-800 font-medium">Medium</span>
                      <div className="text-xl font-bold text-blue-700 mt-1">
                        {selectedReportForView.config.summary.severities.medium}
                      </div>
                    </div>
                    <div className="p-3 rounded-lg border border-slate-200 bg-slate-50">
                      <span className="text-xs text-slate-600 font-medium">Low</span>
                      <div className="text-xl font-bold text-slate-700 mt-1">
                        {selectedReportForView.config.summary.severities.low}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Direct Link to Video Review if Scoped to Video */}
              {selectedReportForView.config?.scopeType === 'video' && selectedReportForView.config?.scopeId && (
                <div className="p-4 bg-blue-50 border border-blue-200 rounded-xl flex items-center justify-between">
                  <div>
                    <h5 className="text-sm font-bold text-blue-950">Review Associated Video Footage</h5>
                    <p className="text-xs text-blue-700 mt-0.5">
                      Open synchronized artifact replay with bounding boxes and timeline scrubber for this video.
                    </p>
                  </div>
                  <Link
                    to={`/app/videos?video=${selectedReportForView.config.scopeId}`}
                    className="flex items-center gap-1.5 px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold shadow-xs"
                  >
                    <span>Open in History</span>
                    <ArrowUpRight className="w-3.5 h-3.5" />
                  </Link>
                </div>
              )}

            </div>

            {/* Viewer Footer Actions */}
            <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between">
              <button
                type="button"
                onClick={() => setSelectedReportForView(null)}
                className="px-4 py-2 border border-slate-200 hover:bg-slate-100 text-slate-700 text-xs font-semibold rounded-lg cursor-pointer transition-colors"
              >
                Close
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleDownloadSavedCsv(selectedReportForView)}
                  className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-lg cursor-pointer transition-colors shadow-xs"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download CSV</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleDownloadSavedPdf(selectedReportForView)}
                  className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg cursor-pointer transition-colors shadow-xs"
                >
                  <FileText className="w-3.5 h-3.5" />
                  <span>Download PDF</span>
                </button>
              </div>
            </div>

          </div>
        </div>
      )}

    </div>
  )
}

export default Reports
