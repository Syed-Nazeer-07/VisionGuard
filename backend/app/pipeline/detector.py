from pathlib import Path
from typing import List, Tuple, Dict, Any
import threading
import cv2
import numpy as np
import onnxruntime as ort

from app.config import settings
from app.core.logging import logger

COCO_LABELS = [
    "person", "bicycle", "car", "motorcycle", "airplane", "bus", "train", "truck", "boat",
    "traffic light", "fire hydrant", "stop sign", "parking meter", "bench", "bird", "cat",
    "dog", "horse", "sheep", "cow", "elephant", "bear", "zebra", "giraffe", "backpack",
    "umbrella", "handbag", "tie", "suitcase", "frisbee", "skis", "snowboard", "sports ball",
    "kite", "baseball bat", "baseball glove", "skateboard", "surfboard", "tennis racket",
    "bottle", "wine glass", "cup", "fork", "knife", "spoon", "bowl", "banana", "apple",
    "sandwich", "orange", "broccoli", "carrot", "hot dog", "pizza", "donut", "cake",
    "chair", "couch", "potted plant", "bed", "dining table", "toilet", "tv", "laptop",
    "mouse", "remote", "keyboard", "cell phone", "microwave", "oven", "toaster", "sink",
    "refrigerator", "book", "clock", "vase", "scissors", "teddy bear", "hair drier",
    "toothbrush"
]

# Traffic-relevant classes: person (0), bicycle (1), car (2), motorcycle (3), bus (5), truck (7)
ALLOWED_CLASSES = {0, 1, 2, 3, 5, 7}
ALLOWED_CLASSES_ARR = np.array(sorted(list(ALLOWED_CLASSES)), dtype=np.int32)

class RawDetection:
    __slots__ = ("cx", "cy", "w", "h", "prob", "class_id", "class_name")

    def __init__(self, cx: float, cy: float, w: float, h: float, prob: float, class_id: int, class_name: str):
        self.cx = cx
        self.cy = cy
        self.w = w
        self.h = h
        self.prob = prob
        self.class_id = class_id
        self.class_name = class_name

    def to_dict(self) -> Dict[str, Any]:
        return {
            "x": round(self.cx, 2),
            "y": round(self.cy, 2),
            "w": round(self.w, 2),
            "h": round(self.h, 2),
            "prob": round(self.prob, 4),
            "class_id": self.class_id,
            "class_name": self.class_name
        }

class YOLODetector:
    def __init__(self, model_path: Path | str | None = None):
        self.model_path = Path(model_path or settings.MODEL_PATH).resolve()
        self.session: ort.InferenceSession | None = None
        self.input_name: str = ""
        self.output_name: str = ""
        self.active_provider: str = "Unknown"
        self.available_providers: List[str] = ort.get_available_providers()
        self.input_size: int = 640
        self._infer_lock = threading.Lock()
        
        # Pre-allocated reusable buffers for zero-allocation inference loop
        self._padded_buffer = np.full((self.input_size, self.input_size, 3), 114, dtype=np.uint8)
        self._input_tensor = np.empty((1, 3, self.input_size, self.input_size), dtype=np.float32)
        self._last_pad_geometry: Tuple[int, int, int, int] | None = None

        self._init_session()

    def _init_session(self) -> None:
        if not self.model_path.exists():
            logger.warning(f"ONNX model file not found at: {self.model_path}")
            return

        providers_to_try: List[str] = []
        if settings.PREFERRED_EXECUTION_PROVIDER and settings.PREFERRED_EXECUTION_PROVIDER in self.available_providers:
            providers_to_try.append(settings.PREFERRED_EXECUTION_PROVIDER)
        
        # Prefer DirectML on Windows when available, with graceful fallback to CPU
        for p in ("DmlExecutionProvider", "CPUExecutionProvider"):
            if p in self.available_providers and p not in providers_to_try:
                providers_to_try.append(p)
                
        if not providers_to_try:
            providers_to_try = ["CPUExecutionProvider"]

        try:
            sess_options = ort.SessionOptions()
            sess_options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
            sess_options.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
            
            # Configure bounded CPU intra/inter op threads to prevent thread contention
            if settings.CPU_INTRA_OP_THREADS > 0:
                sess_options.intra_op_num_threads = settings.CPU_INTRA_OP_THREADS
            if settings.CPU_INTER_OP_THREADS > 0:
                sess_options.inter_op_num_threads = settings.CPU_INTER_OP_THREADS

            # DirectML guidelines: disable memory pattern optimization for GPU buffer stability
            if "DmlExecutionProvider" in providers_to_try:
                sess_options.enable_mem_pattern = False

            try:
                self.session = ort.InferenceSession(str(self.model_path), sess_options, providers=providers_to_try)
            except Exception as dml_init_err:
                if "DmlExecutionProvider" in providers_to_try:
                    logger.warning(f"DirectML session initialization failed ({dml_init_err}); falling back to CPUExecutionProvider")
                    sess_options.enable_mem_pattern = True
                    self.session = ort.InferenceSession(str(self.model_path), sess_options, providers=["CPUExecutionProvider"])
                else:
                    raise dml_init_err

            self.active_provider = self.session.get_providers()[0]
            self.input_name = self.session.get_inputs()[0].name
            self.output_name = self.session.get_outputs()[0].name
            logger.info(
                f"YOLO11n model loaded successfully from {self.model_path} with provider: {self.active_provider} "
                f"(intra_op_threads={settings.CPU_INTRA_OP_THREADS}, inter_op_threads={settings.CPU_INTER_OP_THREADS})"
            )
        except Exception as e:
            logger.error(f"Failed to initialize ONNX Runtime session: {e}")
            self.session = None

    @property
    def is_ready(self) -> bool:
        return self.session is not None

    def letterbox(self, image: np.ndarray, target_size: int = 640) -> Tuple[np.ndarray, float, int, int]:
        """
        Resize image and pad to target_size x target_size using YOLO letterbox gray (114, 114, 114).
        Preserved for testing and standalone usage.
        """
        h, w = image.shape[:2]
        ratio = min(target_size / w, target_size / h)
        scaled_w = max(1, int(round(w * ratio)))
        scaled_h = max(1, int(round(h * ratio)))
        pad_w = int(round((target_size - scaled_w) / 2.0))
        pad_h = int(round((target_size - scaled_h) / 2.0))

        resized = cv2.resize(image, (scaled_w, scaled_h), interpolation=cv2.INTER_LINEAR)
        rgb_resized = cv2.cvtColor(resized, cv2.COLOR_BGR2RGB)
        padded = np.full((target_size, target_size, 3), 114, dtype=np.uint8)
        padded[pad_h:pad_h + scaled_h, pad_w:pad_w + scaled_w] = rgb_resized

        return padded, ratio, pad_w, pad_h

    def detect(
        self,
        bgr_frame: np.ndarray,
        conf_threshold: float | None = None,
        iou_threshold: float | None = None
    ) -> List[RawDetection]:
        if not self.is_ready or self.session is None:
            raise RuntimeError("YOLO model session is not initialized")

        conf_th = conf_threshold if conf_threshold is not None else settings.CONFIDENCE_THRESHOLD
        iou_th = iou_threshold if iou_threshold is not None else settings.IOU_THRESHOLD

        orig_h, orig_w = bgr_frame.shape[:2]
        target_size = self.input_size
        ratio = min(target_size / orig_w, target_size / orig_h)
        scaled_w = max(1, int(round(orig_w * ratio)))
        scaled_h = max(1, int(round(orig_h * ratio)))
        pad_w = int(round((target_size - scaled_w) / 2.0))
        pad_h = int(round((target_size - scaled_h) / 2.0))

        with self._infer_lock:
            # Check if padding geometry changed; if so, re-initialize letterbox border
            geom = (scaled_w, scaled_h, pad_w, pad_h)
            if self._last_pad_geometry != geom:
                self._padded_buffer.fill(114)
                self._last_pad_geometry = geom

            # 1. Resize and color-convert only the active video region
            resized = cv2.resize(bgr_frame, (scaled_w, scaled_h), interpolation=cv2.INTER_LINEAR)
            rgb_resized = cv2.cvtColor(resized, cv2.COLOR_BGR2RGB)
            self._padded_buffer[pad_h:pad_h + scaled_h, pad_w:pad_w + scaled_w] = rgb_resized

            # 2. Vectorized normalization directly into pre-allocated contiguous float32 tensor
            np.divide(self._padded_buffer.transpose(2, 0, 1), 255.0, out=self._input_tensor[0])

            # 3. ONNX Inference (with dynamic fallback to CPU if GPU execution encounters runtime error)
            try:
                outputs = self.session.run([self.output_name], {self.input_name: self._input_tensor})
            except Exception as run_err:
                if self.active_provider == "DmlExecutionProvider":
                    logger.warning(f"DirectML inference failed at runtime ({run_err}); falling back to CPUExecutionProvider")
                    sess_opts = ort.SessionOptions()
                    sess_opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
                    sess_opts.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
                    if settings.CPU_INTRA_OP_THREADS > 0:
                        sess_opts.intra_op_num_threads = settings.CPU_INTRA_OP_THREADS
                    if settings.CPU_INTER_OP_THREADS > 0:
                        sess_opts.inter_op_num_threads = settings.CPU_INTER_OP_THREADS
                    self.session = ort.InferenceSession(str(self.model_path), sess_opts, providers=["CPUExecutionProvider"])
                    self.active_provider = "CPUExecutionProvider"
                    outputs = self.session.run([self.output_name], {self.input_name: self._input_tensor})
                else:
                    raise run_err
            raw_output = outputs[0]  # shape: (1, 84, 8400)

        # Transpose raw model output: (84, 8400) -> (8400, 84)
        predictions = raw_output[0].T

        boxes = predictions[:, :4]  # cx, cy, w, h in 640 space
        scores = predictions[:, 4:]  # 80 class probabilities

        max_probs = np.max(scores, axis=1)
        class_ids = np.argmax(scores, axis=1)

        # 4. Vectorized filtering: anchors above threshold AND in target traffic classes
        # Class-specific confidence: person requires at least 0.38 (rejects roadside bollards and shadows),
        # vehicles require at least conf_th (default 0.25 - 0.28).
        min_probs = np.where(class_ids == 0, max(conf_th, 0.38), conf_th)
        mask = (max_probs >= min_probs) & np.isin(class_ids, ALLOWED_CLASSES_ARR)
        valid_indices = np.flatnonzero(mask)

        if len(valid_indices) == 0:
            return []

        # 5. Vectorized preparation for class-aware NMS (offset boxes by class to prevent cross-class suppression)
        v_boxes = boxes[valid_indices]
        v_probs = max_probs[valid_indices]
        v_cids = class_ids[valid_indices].astype(np.float32)

        tl_x = v_boxes[:, 0] - v_boxes[:, 2] * 0.5
        tl_y = v_boxes[:, 1] - v_boxes[:, 3] * 0.5

        # Class offsets: bicycles (1), motorcycles (3), and persons (0) do not suppress each other
        # Four-wheel road vehicles (car=2, bus=5, truck=7) share the vehicle suppression pool
        nms_groups = np.where(np.isin(v_cids, [2.0, 5.0, 7.0]), 2.0, v_cids)
        class_offsets = nms_groups * 4096.0
        boxes_for_nms = np.column_stack((tl_x + class_offsets, tl_y + class_offsets, v_boxes[:, 2], v_boxes[:, 3])).tolist()
        probs_for_nms = v_probs.tolist()

        indices = cv2.dnn.NMSBoxes(boxes_for_nms, probs_for_nms, conf_th, iou_th)
        if len(indices) == 0:
            return []

        selected_indices = indices.flatten() if hasattr(indices, "flatten") else [int(i[0]) for i in indices]

        candidates: List[RawDetection] = []
        for i in selected_indices:
            orig_idx = valid_indices[i]
            cx, cy, w, h = boxes[orig_idx]
            
            # Un-pad and scale back to original video pixels (CENTER format cx, cy, w, h)
            src_cx = max(0.0, min(float(orig_w), float((cx - pad_w) / ratio)))
            src_cy = max(0.0, min(float(orig_h), float((cy - pad_h) / ratio)))
            src_w = max(1.0, min(float(orig_w), float(w / ratio)))
            src_h = max(1.0, min(float(orig_h), float(h / ratio)))

            cid = int(class_ids[orig_idx])
            cname = COCO_LABELS[cid] if cid < len(COCO_LABELS) else f"class_{cid}"
            prob = float(max_probs[orig_idx])

            # Discard implausibly large boxes covering majority of screen
            if src_w > orig_w * 0.85 or src_h > orig_h * 0.85:
                continue

            # Discard tiny noise artifacts
            if src_w < 8.0 or src_h < 8.0:
                continue

            # Geometric plausibility check for class 0 ('person'):
            # Reject stationary vertical roadside poles, bollards, and signposts
            if cid == 0:
                aspect = src_h / max(1.0, src_w)
                if aspect > 3.2 or aspect < 1.1 or (src_w < 14.0 and aspect > 2.5) or (aspect > 2.8 and prob < 0.50):
                    continue
                if src_h < 18.0:
                    continue

            # Geometric plausibility check for vehicles (bicycle, car, motorcycle, bus, truck):
            # Reject painted road markings, lane dividers, crosswalk stripes, and curb shadows
            if cid in (1, 2, 3, 5, 7):
                veh_aspect = src_w / max(1.0, src_h)
                if veh_aspect > 4.0 or veh_aspect < 0.25:
                    continue
                if src_w < 12.0 or src_h < 12.0:
                    continue
                # Perspective road artifact rejection:
                # Road markings, lane dashes, and circular manhole covers in the lower road foreground (cy > 0.60 * orig_h)
                # cannot be smaller than 65px tall in perspective unless clipped at the image edge.
                if src_cy > orig_h * 0.60 and src_h < 65.0 and (src_cy + src_h * 0.5 < orig_h - 15.0):
                    continue

            candidates.append(RawDetection(
                cx=src_cx,
                cy=src_cy,
                w=src_w,
                h=src_h,
                prob=prob,
                class_id=cid,
                class_name=cname
            ))

        # 6. Containment suppression (IoM) and rider/vehicle unification
        # Sort candidates descending by confidence
        candidates.sort(key=lambda d: d.prob, reverse=True)
        results: List[RawDetection] = []
        for d in candidates:
            suppress = False
            for s in results:
                # Rule A: Sub-box containment for same class group (vehicles car/bus/truck, or bicycle/motorcycle)
                # If a smaller box is largely inside a larger vehicle box (IoM >= 0.55), suppress it
                same_group = (d.class_id == s.class_id) or \
                    (d.class_id in (2, 5, 7) and s.class_id in (2, 5, 7)) or \
                    (d.class_id in (1, 3) and s.class_id in (1, 3))
                if same_group:
                    x1 = max(d.cx - d.w * 0.5, s.cx - s.w * 0.5)
                    y1 = max(d.cy - d.h * 0.5, s.cy - s.h * 0.5)
                    x2 = min(d.cx + d.w * 0.5, s.cx + s.w * 0.5)
                    y2 = min(d.cy + d.h * 0.5, s.cy + s.h * 0.5)
                    iw = max(0.0, x2 - x1)
                    ih = max(0.0, y2 - y1)
                    inter = iw * ih
                    if inter > 0:
                        min_area = min(d.w * d.h, s.w * s.h)
                        if (inter / min_area) >= 0.55:
                            suppress = True
                            break

                # Rule B: Person rider overlapping two-wheeler (motorcycle or bicycle)
                # When a person detection overlaps a motorcycle/bicycle (IoM >= 0.40 or IoU >= 0.20),
                # the two-wheeler vehicle takes precedence (suppress person to prevent duplicate boxes)
                elif d.class_id == 0 and s.class_id in (1, 3):
                    x1 = max(d.cx - d.w * 0.5, s.cx - s.w * 0.5)
                    y1 = max(d.cy - d.h * 0.5, s.cy - s.h * 0.5)
                    x2 = min(d.cx + d.w * 0.5, s.cx + s.w * 0.5)
                    y2 = min(d.cy + d.h * 0.5, s.cy + s.h * 0.5)
                    iw = max(0.0, x2 - x1)
                    ih = max(0.0, y2 - y1)
                    inter = iw * ih
                    if inter > 0:
                        min_area = min(d.w * d.h, s.w * s.h)
                        if (inter / min_area) >= 0.40:
                            suppress = True
                            break

            if not suppress:
                results.append(d)

        return results
