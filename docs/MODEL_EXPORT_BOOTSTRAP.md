# Model-export bootstrap (no database changes)

This standalone pull request contains only the *manual* YOLO11n model export
workflow and its CLI validator/runtime checker. It has no changes to the
VisionGuard frontend, Python API, Supabase, or any production environment.

## Activation

1. Review and merge this small pull request into **main**.
2. Open [GitHub Actions](https://github.com/Syed-Nazeer-07/VisionGuard/actions).
   Select **Export YOLO11n ONNX (manual, license acknowledgement required)**.
3. Review [Ultralytics license terms](https://www.ultralytics.com/license)
   for model weights and software. Choose license acknowledgment `yes` only
   after review; choose `no` otherwise.
4. Click **Run workflow**. The x64 Linux runner fetches the official
   checkpoint, exports fixed-shape ONNX, verifies the graph and runs a CPU
   inference smoke test.
5. On success, open the run and download artifact
   **visionguard-yolo11n-onnx** from **Artifacts**. It expires after seven
   days and contains the binary and SHA-256 manifest.
6. Put `yolo11n.onnx` in
   `apps/web/public/models/yolo11n.onnx` of your local checkout of
   the **integration/staging-all-phases** branch (create the directory).
   Do not commit weights to Git.
7. Run `python scripts/validate_yolo_onnx.py` and
   `python scripts/smoke_yolo_onnx.py` locally on a supported platform;
   CPU/runtime verification from the GitHub runner is reported in Actions.

The staging integration branch already contains these same files, so the
bootstrap PR allows the model-export tool to be used **without** merging
risky database migrations or still-unverified real-camera features.

The generated file is not proof of recognition accuracy on real footage.
A physical camera, staging Supabase environment, and signed-storage
integration require separate verification.
