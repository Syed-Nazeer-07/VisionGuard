"""
VisionGuard Local Annotation Server & Web UI
Provides a zero-cloud, standalone annotation tool for ground-truth curation:
- Pan and zoom on 1080p full-resolution video frames
- Draw, move, resize, and delete bounding boxes
- Assign vehicle classes (car, truck, bus, motorcycle) with keyboard shortcuts (1, 2, 3, 4)
- Mark frames as human-verified
- Save directly to backend/eval/dataset/ground_truth.json
"""

import json
import os
from pathlib import Path
from typing import Dict, List, Any
import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

DATASET_DIR = Path("backend/eval/dataset").resolve()
IMAGES_DIR = DATASET_DIR / "images"
METADATA_PATH = DATASET_DIR / "metadata.json"
GROUND_TRUTH_PATH = DATASET_DIR / "ground_truth.json"

app = FastAPI(title="VisionGuard Annotation Tool")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class AnnotationBox(BaseModel):
    id: str | None = None
    box: List[float]  # [x, y, w, h] in top-left pixels
    class_name: str    # 'car', 'truck', 'bus', 'motorcycle'
    verified: bool = True

class FrameAnnotation(BaseModel):
    frame_id: str
    verified: bool = True
    boxes: List[AnnotationBox]

def load_ground_truth() -> Dict[str, Any]:
    if GROUND_TRUTH_PATH.exists():
        try:
            with open(GROUND_TRUTH_PATH, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {"version": "1.0", "frames": {}}

def save_ground_truth(data: Dict[str, Any]) -> None:
    GROUND_TRUTH_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(GROUND_TRUTH_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)

@app.get("/api/frames")
def get_frames():
    if not METADATA_PATH.exists():
        raise HTTPException(status_code=404, detail="Dataset metadata not found. Run sampler.py first.")
    with open(METADATA_PATH, "r", encoding="utf-8") as f:
        meta = json.load(f)
    gt = load_ground_truth()
    
    samples = meta.get("samples", [])
    for s in samples:
        f_id = s["sample_id"]
        is_verified = gt.get("frames", {}).get(f_id, {}).get("verified", False)
        box_count = len(gt.get("frames", {}).get(f_id, {}).get("boxes", []))
        s["is_verified"] = is_verified
        s["box_count"] = box_count

    return {
        "total_frames": len(samples),
        "verified_count": sum(1 for s in samples if s.get("is_verified")),
        "samples": samples
    }

@app.get("/api/images/{filename}")
def get_image(filename: str):
    img_path = IMAGES_DIR / filename
    if not img_path.exists():
        raise HTTPException(status_code=404, detail="Image not found")
    return FileResponse(img_path)

@app.get("/api/annotations/{sample_id}")
def get_frame_annotations(sample_id: str):
    gt = load_ground_truth()
    frame_data = gt.get("frames", {}).get(sample_id, {"verified": False, "boxes": []})
    return frame_data

@app.post("/api/annotations/{sample_id}")
def save_frame_annotations(sample_id: str, payload: FrameAnnotation):
    gt = load_ground_truth()
    gt["frames"][sample_id] = {
        "verified": payload.verified,
        "boxes": [b.dict() for b in payload.boxes]
    }
    save_ground_truth(gt)
    return {"status": "saved", "sample_id": sample_id, "box_count": len(payload.boxes)}

@app.get("/", response_class=HTMLResponse)
def index_html():
    return """
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>VisionGuard — Ground Truth Annotation Tool</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0f172a; color: #f8fafc; display: flex; flex-direction: column; height: 100vh; overflow: hidden; }
    header { background: #1e293b; padding: 10px 20px; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid #334155; }
    .title { font-size: 16px; font-weight: 600; display: flex; align-items: center; gap: 10px; }
    .badge { background: #3b82f6; font-size: 11px; padding: 2px 8px; border-radius: 4px; }
    .stats { font-size: 13px; color: #94a3b8; }
    .main-container { display: flex; flex: 1; overflow: hidden; }
    .sidebar { width: 320px; background: #1e293b; border-right: 1px solid #334155; display: flex; flex-direction: column; }
    .frame-list { flex: 1; overflow-y: auto; padding: 8px; }
    .frame-item { padding: 8px 12px; margin-bottom: 4px; border-radius: 6px; cursor: pointer; display: flex; justify-content: space-between; font-size: 13px; border: 1px solid transparent; }
    .frame-item:hover { background: #334155; }
    .frame-item.active { background: #1e3a8a; border-color: #3b82f6; }
    .frame-item.verified { border-left: 4px solid #10b981; }
    .viewport { flex: 1; position: relative; background: #020617; display: flex; align-items: center; justify-content: center; overflow: hidden; }
    canvas { display: block; cursor: crosshair; }
    .toolbar { position: absolute; top: 12px; left: 12px; background: rgba(30, 41, 59, 0.95); backdrop-filter: blur(8px); padding: 8px; border-radius: 8px; border: 1px solid #334155; display: flex; gap: 8px; align-items: center; z-index: 10; }
    button { background: #334155; color: white; border: 1px solid #475569; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 12px; font-weight: 500; display: flex; align-items: center; gap: 6px; }
    button:hover { background: #475569; }
    button.primary { background: #2563eb; border-color: #3b82f6; }
    button.primary:hover { background: #1d4ed8; }
    button.active-class { outline: 2px solid #38bdf8; font-weight: bold; }
    .cls-btn-car { background: #0369a1; }
    .cls-btn-truck { background: #b45309; }
    .cls-btn-bus { background: #6d28d9; }
    .cls-btn-motorcycle { background: #047857; }
    .help-box { font-size: 11px; color: #94a3b8; padding: 10px; border-top: 1px solid #334155; }
    .box-info { position: absolute; bottom: 12px; left: 12px; background: rgba(15, 23, 42, 0.9); padding: 8px 12px; border-radius: 6px; font-size: 12px; border: 1px solid #334155; }
  </style>
</head>
<body>
  <header>
    <div class="title">
      <span>VisionGuard Ground Truth Annotator</span>
      <span class="badge">Offline & Verified</span>
    </div>
    <div class="stats" id="statsText">Loading frames...</div>
    <div>
      <button class="primary" id="btnSave" onclick="saveCurrentFrame()">💾 Save Annotations (S)</button>
    </div>
  </header>
  <div class="main-container">
    <div class="sidebar">
      <div style="padding: 10px; border-bottom: 1px solid #334155; display: flex; gap: 6px;">
        <button onclick="prevFrame()" style="flex:1;">◀ Prev (A)</button>
        <button onclick="nextFrame()" style="flex:1;">Next (D) ▶</button>
      </div>
      <div class="frame-list" id="frameList"></div>
      <div class="help-box">
        <strong>Hotkeys:</strong><br>
        • Drag on canvas to draw bounding box<br>
        • Click existing box to select / resize<br>
        • [1] Car &nbsp; [2] Truck &nbsp; [3] Bus &nbsp; [4] Moto<br>
        • [Del] Delete box &nbsp; [S] Save &nbsp; [A/D] Prev/Next<br>
        • Scroll wheel to zoom, drag with Middle/Right click to pan
      </div>
    </div>
    <div class="viewport" id="viewport">
      <div class="toolbar">
        <span style="font-size:12px; color:#cbd5e1; margin-right:4px;">Class:</span>
        <button class="cls-btn-car active-class" id="btnClsCar" onclick="setClass('car')">1: Car</button>
        <button class="cls-btn-truck" id="btnClsTruck" onclick="setClass('truck')">2: Truck</button>
        <button class="cls-btn-bus" id="btnClsBus" onclick="setClass('bus')">3: Bus</button>
        <button class="cls-btn-motorcycle" id="btnClsMoto" onclick="setClass('motorcycle')">4: Moto</button>
        <div style="width:1px; height:20px; background:#475569; margin: 0 4px;"></div>
        <button onclick="resetZoom()">Fit View</button>
        <button onclick="deleteSelectedBox()">Delete Box (Del)</button>
      </div>
      <canvas id="canvas"></canvas>
      <div class="box-info" id="boxInfo">No box selected</div>
    </div>
  </div>

  <script>
    let frames = [];
    let currentIdx = 0;
    let currentImage = new Image();
    let boxes = [];
    let selectedBoxIdx = -1;
    let currentClass = 'car';
    let isDrawing = false;
    let drawStartX = 0, drawStartY = 0;
    let isPanning = false;
    let panStartX = 0, panStartY = 0;
    let scale = 1, panX = 0, panY = 0;
    let dragMode = null; // 'create', 'move', 'resize-handle'
    let resizeHandle = -1;

    const canvas = document.getElementById('canvas');
    const ctx = canvas.getContext('2d');
    const viewport = document.getElementById('viewport');

    const CLASS_COLORS = {
      car: '#38bdf8',
      truck: '#fb923c',
      bus: '#c084fc',
      motorcycle: '#4ade80'
    };

    async function init() {
      const res = await fetch('/api/frames');
      const data = await res.json();
      frames = data.samples;
      updateStats();
      renderFrameList();
      if (frames.length > 0) {
        loadFrame(0);
      }
    }

    function updateStats() {
      const verified = frames.filter(f => f.is_verified).length;
      document.getElementById('statsText').innerText =
        `Frame ${currentIdx + 1} of ${frames.length} | Verified: ${verified} / ${frames.length}`;
    }

    function renderFrameList() {
      const list = document.getElementById('frameList');
      list.innerHTML = '';
      frames.forEach((f, idx) => {
        const item = document.createElement('div');
        item.className = `frame-item ${idx === currentIdx ? 'active' : ''} ${f.is_verified ? 'verified' : ''}`;
        item.innerHTML = `
          <div><strong>#${f.frame_index}</strong> <span style="color:#94a3b8;">(${f.timestamp_seconds}s)</span></div>
          <div><span style="color:${f.box_count > 0 ? '#38bdf8' : '#64748b'};">${f.box_count || 0} boxes</span></div>
        `;
        item.onclick = () => loadFrame(idx);
        list.appendChild(item);
      });
    }

    async function loadFrame(idx) {
      currentIdx = idx;
      selectedBoxIdx = -1;
      updateStats();
      renderFrameList();

      const f = frames[idx];
      currentImage = new Image();
      currentImage.src = `/api/images/${f.image_filename}`;
      await currentImage.decode();

      // Load existing annotations
      const res = await fetch(`/api/annotations/${f.sample_id}`);
      const annoData = await res.json();
      boxes = (annoData.boxes || []).map(b => ({
        box: [...b.box],
        class_name: b.class_name
      }));

      resetZoom();
      redraw();
    }

    function resetZoom() {
      const vw = viewport.clientWidth;
      const vh = viewport.clientHeight;
      scale = Math.min(vw / 1920, vh / 1080) * 0.95;
      panX = (vw - 1920 * scale) / 2;
      panY = (vh - 1080 * scale) / 2;
      canvas.width = vw;
      canvas.height = vh;
      redraw();
    }

    window.onresize = resetZoom;

    function toImageCoords(clientX, clientY) {
      const rect = canvas.getBoundingClientRect();
      const x = (clientX - rect.left - panX) / scale;
      const y = (clientY - rect.top - panY) / scale;
      return [x, y];
    }

    function setClass(c) {
      currentClass = c;
      document.querySelectorAll('.toolbar button').forEach(b => b.classList.remove('active-class'));
      if (c === 'car') document.getElementById('btnClsCar').classList.add('active-class');
      if (c === 'truck') document.getElementById('btnClsTruck').classList.add('active-class');
      if (c === 'bus') document.getElementById('btnClsBus').classList.add('active-class');
      if (c === 'motorcycle') document.getElementById('btnClsMoto').classList.add('active-class');

      if (selectedBoxIdx >= 0 && selectedBoxIdx < boxes.length) {
        boxes[selectedBoxIdx].class_name = c;
        redraw();
      }
    }

    function deleteSelectedBox() {
      if (selectedBoxIdx >= 0 && selectedBoxIdx < boxes.length) {
        boxes.splice(selectedBoxIdx, 1);
        selectedBoxIdx = -1;
        redraw();
      }
    }

    async function saveCurrentFrame() {
      const f = frames[currentIdx];
      const payload = {
        frame_id: f.sample_id,
        verified: true,
        boxes: boxes.map((b, i) => ({
          id: `box_${i}`,
          box: [Math.round(b.box[0]), Math.round(b.box[1]), Math.round(b.box[2]), Math.round(b.box[3])],
          class_name: b.class_name,
          verified: true
        }))
      };

      const res = await fetch(`/api/annotations/${f.sample_id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        f.is_verified = true;
        f.box_count = boxes.length;
        updateStats();
        renderFrameList();
        const btn = document.getElementById('btnSave');
        btn.innerText = '✓ Saved!';
        setTimeout(() => btn.innerText = '💾 Save Annotations (S)', 1000);
      }
    }

    function prevFrame() { if (currentIdx > 0) loadFrame(currentIdx - 1); }
    function nextFrame() { if (currentIdx < frames.length - 1) loadFrame(currentIdx + 1); }

    // Mouse Interactions
    canvas.addEventListener('mousedown', (e) => {
      if (e.button === 1 || e.button === 2) {
        isPanning = true;
        panStartX = e.clientX - panX;
        panStartY = e.clientY - panY;
        return;
      }

      const [ix, iy] = toImageCoords(e.clientX, e.clientY);
      // Check hit on existing boxes (reverse order to pick top box)
      let hitIdx = -1;
      for (let i = boxes.length - 1; i >= 0; i--) {
        const [bx, by, bw, bh] = boxes[i].box;
        if (ix >= bx && ix <= bx + bw && iy >= by && iy <= by + bh) {
          hitIdx = i;
          break;
        }
      }

      if (hitIdx >= 0) {
        selectedBoxIdx = hitIdx;
        dragMode = 'move';
        drawStartX = ix;
        drawStartY = iy;
        currentClass = boxes[hitIdx].class_name;
        setClass(currentClass);
      } else {
        selectedBoxIdx = -1;
        dragMode = 'create';
        drawStartX = ix;
        drawStartY = iy;
        boxes.push({ box: [ix, iy, 0, 0], class_name: currentClass });
        selectedBoxIdx = boxes.length - 1;
      }
      redraw();
    });

    window.addEventListener('mousemove', (e) => {
      if (isPanning) {
        panX = e.clientX - panStartX;
        panY = e.clientY - panStartY;
        redraw();
        return;
      }

      if (!dragMode || selectedBoxIdx < 0) return;
      const [ix, iy] = toImageCoords(e.clientX, e.clientY);

      if (dragMode === 'create') {
        const bx = Math.min(drawStartX, ix);
        const by = Math.min(drawStartY, iy);
        const bw = Math.abs(ix - drawStartX);
        const bh = Math.abs(iy - drawStartY);
        boxes[selectedBoxIdx].box = [bx, by, bw, bh];
        redraw();
      } else if (dragMode === 'move') {
        const dx = ix - drawStartX;
        const dy = iy - drawStartY;
        boxes[selectedBoxIdx].box[0] += dx;
        boxes[selectedBoxIdx].box[1] += dy;
        drawStartX = ix;
        drawStartY = iy;
        redraw();
      }
    });

    window.addEventListener('mouseup', () => {
      if (isPanning) isPanning = false;
      if (dragMode === 'create' && selectedBoxIdx >= 0) {
        const b = boxes[selectedBoxIdx];
        if (b.box[2] < 5 || b.box[3] < 5) {
          boxes.splice(selectedBoxIdx, 1);
          selectedBoxIdx = -1;
        }
      }
      dragMode = null;
      redraw();
    });

    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const zoomFactor = e.deltaY < 0 ? 1.15 : 0.87;
      const [ix, iy] = toImageCoords(e.clientX, e.clientY);
      scale *= zoomFactor;
      panX = e.clientX - ix * scale;
      panY = e.clientY - iy * scale;
      redraw();
    });

    window.addEventListener('keydown', (e) => {
      if (e.key === '1') setClass('car');
      else if (e.key === '2') setClass('truck');
      else if (e.key === '3') setClass('bus');
      else if (e.key === '4') setClass('motorcycle');
      else if (e.key === 'Delete' || e.key === 'Backspace') deleteSelectedBox();
      else if (e.key === 's' || e.key === 'S') saveCurrentFrame();
      else if (e.key === 'a' || e.key === 'A') prevFrame();
      else if (e.key === 'd' || e.key === 'D') nextFrame();
    });

    function redraw() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.save();
      ctx.translate(panX, panY);
      ctx.scale(scale, scale);

      // Draw image
      if (currentImage.complete && currentImage.naturalWidth > 0) {
        ctx.drawImage(currentImage, 0, 0);
      }

      // Draw boxes
      boxes.forEach((b, idx) => {
        const [x, y, w, h] = b.box;
        const color = CLASS_COLORS[b.class_name] || '#ffffff';
        const isSelected = idx === selectedBoxIdx;

        ctx.strokeStyle = color;
        ctx.lineWidth = isSelected ? 3 / scale : 2 / scale;
        ctx.strokeRect(x, y, w, h);

        ctx.fillStyle = color;
        ctx.globalAlpha = isSelected ? 0.25 : 0.12;
        ctx.fillRect(x, y, w, h);
        ctx.globalAlpha = 1.0;

        // Label tag
        ctx.fillStyle = color;
        const fontSize = Math.max(11, Math.round(14 / scale));
        ctx.font = `${fontSize}px sans-serif`;
        const labelText = `${b.class_name} #${idx + 1}`;
        const tw = ctx.measureText(labelText).width;
        ctx.fillRect(x, Math.max(0, y - fontSize - 4), tw + 6, fontSize + 4);

        ctx.fillStyle = '#0f172a';
        ctx.fillText(labelText, x + 3, Math.max(fontSize, y - 2));
      });

      ctx.restore();

      // Update box info bar
      const info = document.getElementById('boxInfo');
      if (selectedBoxIdx >= 0 && selectedBoxIdx < boxes.length) {
        const b = boxes[selectedBoxIdx];
        info.innerHTML = `Selected: <strong>${b.class_name}</strong> | Box: [x=${Math.round(b.box[0])}, y=${Math.round(b.box[1])}, w=${Math.round(b.box[2])}, h=${Math.round(b.box[3])}]`;
      } else {
        info.innerText = `${boxes.length} boxes total in frame`;
      }
    }

    init();
  </script>
</body>
</html>
"""

if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8088)
