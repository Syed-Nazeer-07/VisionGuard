export interface VideoDimensions {
  videoWidth: number;
  videoHeight: number;
}

export interface ContainerDimensions {
  containerWidth: number;
  containerHeight: number;
}

export interface ViewportTransform {
  scale: number;
  scaleX: number;
  scaleY: number;
  renderWidth: number;
  renderHeight: number;
  offsetX: number;
  offsetY: number;
  fit: 'contain' | 'cover';
  // Visible rectangle of the video picture inside the container (clamped to container)
  visibleRect: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

/**
 * Computes canonical coordinate transformation between source video pixels and display container.
 * Strictly preserves aspect ratio with mathematical equality for scaleX === scaleY.
 * Handles both 'contain' (normal mode letterboxing/pillarboxing) and 'cover' (fullscreen cropping).
 */
export function computeVideoTransform(
  source: VideoDimensions,
  container: ContainerDimensions,
  fit: 'contain' | 'cover'
): ViewportTransform {
  const { videoWidth, videoHeight } = source;
  const { containerWidth, containerHeight } = container;

  if (videoWidth <= 0 || videoHeight <= 0 || containerWidth <= 0 || containerHeight <= 0) {
    return {
      scale: 1,
      scaleX: 1,
      scaleY: 1,
      renderWidth: Math.max(0, containerWidth),
      renderHeight: Math.max(0, containerHeight),
      offsetX: 0,
      offsetY: 0,
      fit,
      visibleRect: { x: 0, y: 0, width: Math.max(0, containerWidth), height: Math.max(0, containerHeight) }
    };
  }

  const scale = fit === 'cover'
    ? Math.max(containerWidth / videoWidth, containerHeight / videoHeight)
    : Math.min(containerWidth / videoWidth, containerHeight / videoHeight);

  const renderWidth = videoWidth * scale;
  const renderHeight = videoHeight * scale;
  const offsetX = (containerWidth - renderWidth) / 2;
  const offsetY = (containerHeight - renderHeight) / 2;

  const visibleX = Math.max(0, offsetX);
  const visibleY = Math.max(0, offsetY);
  const visibleWidth = Math.min(containerWidth, renderWidth);
  const visibleHeight = Math.min(containerHeight, renderHeight);

  return {
    scale,
    scaleX: scale,
    scaleY: scale,
    renderWidth,
    renderHeight,
    offsetX,
    offsetY,
    fit,
    visibleRect: {
      x: visibleX,
      y: visibleY,
      width: visibleWidth,
      height: visibleHeight
    }
  };
}

/**
 * Transforms a bounding box with center coordinates (cx, cy, w, h) in source video pixels
 * to top-left coordinates (x, y, w, h) in display container pixels.
 */
export function sourceCenterBoxToDisplay(
  box: { x: number; y: number; w: number; h: number },
  transform: ViewportTransform
): { x: number; y: number; w: number; h: number } {
  const { scale, offsetX, offsetY } = transform;
  return {
    x: (box.x - box.w / 2) * scale + offsetX,
    y: (box.y - box.h / 2) * scale + offsetY,
    w: box.w * scale,
    h: box.h * scale
  };
}

/**
 * Transforms a bounding box with top-left coordinates (x, y, w, h) in source video pixels
 * to top-left coordinates (x, y, w, h) in display container pixels.
 */
export function sourceTopLeftBoxToDisplay(
  box: { x: number; y: number; w: number; h: number },
  transform: ViewportTransform
): { x: number; y: number; w: number; h: number } {
  const { scale, offsetX, offsetY } = transform;
  return {
    x: box.x * scale + offsetX,
    y: box.y * scale + offsetY,
    w: box.w * scale,
    h: box.h * scale
  };
}

/**
 * Transforms a 2D point from source video pixels to display container pixels.
 */
export function sourcePointToDisplay(
  pt: { x: number; y: number },
  transform: ViewportTransform
): { x: number; y: number } {
  return {
    x: pt.x * transform.scale + transform.offsetX,
    y: pt.y * transform.scale + transform.offsetY
  };
}

/**
 * Converts a center bounding box (cx, cy, w, h) to corner coordinates (x1, y1, x2, y2).
 */
export function centerBoxToCorners(box: { x: number; y: number; w: number; h: number }): { x1: number; y1: number; x2: number; y2: number } {
  return {
    x1: box.x - box.w / 2,
    y1: box.y - box.h / 2,
    x2: box.x + box.w / 2,
    y2: box.y + box.h / 2
  };
}

/**
 * Converts corner coordinates (x1, y1, x2, y2) to a center bounding box (cx, cy, w, h).
 */
export function cornersToCenterBox(corners: { x1: number; y1: number; x2: number; y2: number }): { x: number; y: number; w: number; h: number } {
  const w = Math.max(0, corners.x2 - corners.x1);
  const h = Math.max(0, corners.y2 - corners.y1);
  return {
    x: corners.x1 + w / 2,
    y: corners.y1 + h / 2,
    w,
    h
  };
}

