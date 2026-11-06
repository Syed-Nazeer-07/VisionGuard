# Phase 3: independent analysis run histories

The old unique keys (video_id, track_id) and (camera_id, track_id) allowed
later inference runs to overwrite earlier track trajectories because the
tracker restarts IDs for every new run. The new migration keys tracks by
(analysis_run_id, track_id), preserving distinct runs.

## Staging and deployment checklist

1. Back up the Supabase database; review the live constraint catalog.
2. Apply migration 20261106020000_run_scoped_tracking.sql on staging
   **before deploying the web changes**. The prior web code's upsert conflict
   target stops working after the old unique constraints are dropped.
3. Run supabase/tests/run_track_history_assertions.sql on staging.
4. Analyze the same video twice in browser and backend modes. Each run must
   retain its own tracks and trajectories, even when both contain track #1.
5. Re-save the same run and verify its rows update without duplication.
6. In Video Review, select run A, run B and All Runs. Verify the selected
   artifact overlays and metrics belong only to the selected run; All Runs
   should use saved trajectories instead of painting one run's artifact.
7. Verify across refresh and restart, with Viewer and Operator permissions.
   Repeat after deploying Phase 1 security PR #2 if it has been merged.
8. Only then apply the migration in production before rolling out the
   updated frontend. Check old browser sessions are refreshed.

## Known limitations

- Already-overwritten old trajectories cannot be reconstructed automatically.
  Existing surviving rows are kept intact.
- Browser/backend multi-step History persistence is not transactional.
- Backend speed episode counts are not yet reviewable incident rows.
- Legacy tracking records without an analysis_run_id remain readable.
  They are not uniquely keyed by source: the existing FK uses ON DELETE SET NULL,
  and source-scoped partial unique indexes could block deletion of multiple
  runs using the same numerical track ID.
- Analytics needs run-scoped aggregation to avoid interpreting track rows
  from multiple runs as unique physical vehicles; the existing Analytics
  page already offers latest-run and selected-run scoping.
