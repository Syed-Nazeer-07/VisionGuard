import { describe, expect, it, vi } from 'vitest'
import { liveAnalysisSession, sourceKeyOf } from './liveAnalysisSession'

describe('liveAnalysisSession', () => {
  it('keeps the uploaded video across camera switches and clears only on request', () => {
    const listener = vi.fn()
    const unsubscribe = liveAnalysisSession.subscribe(listener)

    expect(sourceKeyOf(liveAnalysisSession.get())).toBe('')

    liveAnalysisSession.selectVideo('video-15')
    liveAnalysisSession.setVideoLabel('video-15', 'Video 15')
    expect(sourceKeyOf(liveAnalysisSession.get())).toBe('video:video-15')

    // Camera mode without a chosen camera: no source yet, video retained.
    liveAnalysisSession.selectCamera(null)
    expect(sourceKeyOf(liveAnalysisSession.get())).toBe('')
    expect(liveAnalysisSession.get().videoId).toBe('video-15')

    liveAnalysisSession.selectCamera('camera-1')
    expect(sourceKeyOf(liveAnalysisSession.get())).toBe('camera:camera-1')
    expect(liveAnalysisSession.get()).toMatchObject({ mode: 'camera', videoId: 'video-15', videoLabel: 'Video 15' })

    liveAnalysisSession.showUploadedVideo()
    expect(sourceKeyOf(liveAnalysisSession.get())).toBe('video:video-15')

    const before = liveAnalysisSession.get()
    const calls = listener.mock.calls.length
    liveAnalysisSession.showUploadedVideo() // no-op: same snapshot, no notification
    expect(liveAnalysisSession.get()).toBe(before)
    expect(listener.mock.calls.length).toBe(calls)

    liveAnalysisSession.clearVideo()
    expect(liveAnalysisSession.get()).toMatchObject({ mode: 'uploaded-video', videoId: null, videoLabel: null, cameraId: 'camera-1' })
    expect(sourceKeyOf(liveAnalysisSession.get())).toBe('')

    unsubscribe()
  })

  it('does not write the active source to Web Storage (a refresh must reset it)', () => {
    localStorage.clear()
    sessionStorage.clear()
    liveAnalysisSession.selectVideo('video-16')
    liveAnalysisSession.selectCamera('camera-2')
    expect(localStorage.length).toBe(0)
    expect(sessionStorage.length).toBe(0)
  })
})
