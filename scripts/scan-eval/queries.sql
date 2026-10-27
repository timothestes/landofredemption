-- E3 metrics and kill criteria for the card scanner
-- (docs/superpowers/specs/2026-10-26-card-scanner-design.md, "E3: after launch" and
-- "Kill, pivot and removal"). One named section per definition; run each through the
-- Supabase MCP or psql. Every query filters source = 'player' (eval rows never count).
--
-- Stored shapes:
--   scan_events.detections = the route's detections minus candidates: an array of
--     { id: '<scanId>:<i>', grid, orientation, read{..., confidence}, status
--       ('matched'|'check'|'not_found'), nameReason, printingReason, chosenKey, scores }
--   scan_events.outcomes   = written on commit by PR C, NOT YET WRITTEN. Assumed shape,
--     from the spec's "What is recorded": an array, one entry per committed detection:
--     { id: '<detection id>', finalKey, printingChanged: bool, nameChanged: bool,
--       removed: bool, removedAs: 'wrong'|'unwanted'|null, unresolved: bool }
--   If PR C stores a different shape, fix the `committed` CTE below (it is repeated in each
--   outcome query) and nothing else.
--
-- The `committed` CTE below is repeated IDENTICALLY in every outcome-based query, so the
-- correction predicate and the denominator are defined once and all of them agree.
-- A correction = nameChanged or printingChanged or (removed and removedAs = 'wrong').
-- Denominator = committed detections with outcomes, excluding removedAs = 'unwanted'
-- (a card the player did not want says nothing about the read) and unresolved ones.

-- name: correction_rate_by_status
-- correction rate = corrections / committed detections with outcomes, split by status
-- (check rows are prompted; matched rows are not: mixing them hides the silent error).
with committed as (
  select e.created_at, d.value as det, o.value as o,
         (coalesce((o.value ->> 'nameChanged')::boolean, false)
          or coalesce((o.value ->> 'printingChanged')::boolean, false)
          or coalesce(o.value ->> 'removedAs', '') = 'wrong') as corrected,
         coalesce((o.value ->> 'printingChanged')::boolean, false) as printing_changed
  from public.scan_events e
  cross join lateral jsonb_array_elements(coalesce(e.detections, '[]'::jsonb)) d
  join lateral jsonb_array_elements(coalesce(e.outcomes, '[]'::jsonb)) o on o.value ->> 'id' = d.value ->> 'id'
  where e.source = 'player' and e.status = 'done' and e.outcomes is not null
    and coalesce(o.value ->> 'removedAs', '') <> 'unwanted'
    and coalesce((o.value ->> 'unresolved')::boolean, false) = false
)
select det ->> 'status' as status,
       count(*) as committed,
       count(*) filter (where corrected) as corrected,
       round(100.0 * count(*) filter (where corrected) / nullif(count(*), 0), 1) as correction_pct
from committed
group by 1
order by 1;

-- name: not_found_rate
-- not-found rate = not_found detections / all detections; photos with zero detections
-- are reported separately (second row set via the zero_detection_photos column).
with det as (
  select e.id, d.value as d
  from public.scan_events e
  cross join lateral jsonb_array_elements(coalesce(e.detections, '[]'::jsonb)) d
  where e.source = 'player' and e.status = 'done'
)
select (select count(*) from det) as detections,
       (select count(*) from det where d ->> 'status' = 'not_found') as not_found,
       round(100.0 * (select count(*) from det where d ->> 'status' = 'not_found')
             / nullif((select count(*) from det), 0), 1) as not_found_pct,
       (select count(*) from public.scan_events
         where source = 'player' and status = 'done'
           and jsonb_array_length(coalesce(detections, '[]'::jsonb)) = 0) as zero_detection_photos,
       (select count(*) from public.scan_events where source = 'player' and status = 'done') as done_photos;


-- name: uncorrected_rate_by_printing_reason
-- uncorrected rate by printingReason (not "accuracy": players fix what they notice).
-- Uncorrected = committed, not corrected, not removed. fuzzy must score below exact
-- (see the next query) and each printing reason is useful only if it separates.
with committed as (
  select e.created_at, d.value as det, o.value as o,
         (coalesce((o.value ->> 'nameChanged')::boolean, false)
          or coalesce((o.value ->> 'printingChanged')::boolean, false)
          or coalesce(o.value ->> 'removedAs', '') = 'wrong') as corrected,
         coalesce((o.value ->> 'printingChanged')::boolean, false) as printing_changed
  from public.scan_events e
  cross join lateral jsonb_array_elements(coalesce(e.detections, '[]'::jsonb)) d
  join lateral jsonb_array_elements(coalesce(e.outcomes, '[]'::jsonb)) o on o.value ->> 'id' = d.value ->> 'id'
  where e.source = 'player' and e.status = 'done' and e.outcomes is not null
    and coalesce(o.value ->> 'removedAs', '') <> 'unwanted'
    and coalesce((o.value ->> 'unresolved')::boolean, false) = false
)
select det ->> 'printingReason' as printing_reason,
       count(*) as committed,
       count(*) filter (where not corrected) as uncorrected,
       round(100.0 * count(*) filter (where not corrected) / nullif(count(*), 0), 1) as uncorrected_pct
from committed
group by 1
order by committed desc;

-- name: uncorrected_rate_by_name_reason
-- same, by nameReason (exact / fuzzy / reference / none): a reason code is useful only
-- if fuzzy scores below exact.
with committed as (
  select e.created_at, d.value as det, o.value as o,
         (coalesce((o.value ->> 'nameChanged')::boolean, false)
          or coalesce((o.value ->> 'printingChanged')::boolean, false)
          or coalesce(o.value ->> 'removedAs', '') = 'wrong') as corrected,
         coalesce((o.value ->> 'printingChanged')::boolean, false) as printing_changed
  from public.scan_events e
  cross join lateral jsonb_array_elements(coalesce(e.detections, '[]'::jsonb)) d
  join lateral jsonb_array_elements(coalesce(e.outcomes, '[]'::jsonb)) o on o.value ->> 'id' = d.value ->> 'id'
  where e.source = 'player' and e.status = 'done' and e.outcomes is not null
    and coalesce(o.value ->> 'removedAs', '') <> 'unwanted'
    and coalesce((o.value ->> 'unresolved')::boolean, false) = false
)
select det ->> 'nameReason' as name_reason,
       count(*) as committed,
       count(*) filter (where not corrected) as uncorrected,
       round(100.0 * count(*) filter (where not corrected) / nullif(count(*), 0), 1) as uncorrected_pct
from committed
group by 1
order by committed desc;

-- name: uncorrected_rate_by_confidence
-- same, by the stored read.confidence (calibration: the chip earns its place only if
-- high and low differ by >= 15 points with low covering >= a tenth of rows).
with committed as (
  select e.created_at, d.value as det, o.value as o,
         (coalesce((o.value ->> 'nameChanged')::boolean, false)
          or coalesce((o.value ->> 'printingChanged')::boolean, false)
          or coalesce(o.value ->> 'removedAs', '') = 'wrong') as corrected,
         coalesce((o.value ->> 'printingChanged')::boolean, false) as printing_changed
  from public.scan_events e
  cross join lateral jsonb_array_elements(coalesce(e.detections, '[]'::jsonb)) d
  join lateral jsonb_array_elements(coalesce(e.outcomes, '[]'::jsonb)) o on o.value ->> 'id' = d.value ->> 'id'
  where e.source = 'player' and e.status = 'done' and e.outcomes is not null
    and coalesce(o.value ->> 'removedAs', '') <> 'unwanted'
    and coalesce((o.value ->> 'unresolved')::boolean, false) = false
)
select det -> 'read' ->> 'confidence' as confidence,
       count(*) as committed,
       round(100.0 * count(*) / sum(count(*)) over (), 1) as share_pct,
       count(*) filter (where not corrected) as uncorrected,
       round(100.0 * count(*) filter (where not corrected) / nullif(count(*), 0), 1) as uncorrected_pct
from committed
group by 1
order by 1;

-- name: abandonment_24h
-- abandonment = done scans with no outcomes after 24 hours / done scans. Only scans
-- older than 24 h are eligible (younger ones may still be committed).
select count(*) as done_scans_older_than_24h,
       count(*) filter (where outcomes is null) as abandoned,
       round(100.0 * count(*) filter (where outcomes is null) / nullif(count(*), 0), 1) as abandoned_pct
from public.scan_events
where source = 'player' and status = 'done' and created_at < now() - interval '24 hours';


-- name: rejections_by_cap_per_day
select date_trunc('day', created_at)::date as day,
       rejected_cap,
       count(*) as rejections
from public.scan_events
where source = 'player' and status = 'rejected'
group by 1, 2
order by 1 desc, 2;


-- name: failure_rate
-- Two kinds of failed row, reported apart:
--   model failures = failed with attempts > 0: the call to Claude was made and failed
--     (rate limit, overload, billing, bad key/model, refusal, unparseable, mismatch).
--     Rate = model failures / (done + model failures), i.e. of photos that reached the model.
--   input failures = failed with attempts = 0: the model was never called (undecodable
--     photo, pixel limit, missing API key). Reported as a count and share of done + failed.
-- Rejected rows never called the model and pending rows are in flight; both are excluded.
select count(*) filter (where status = 'failed' and attempts > 0) as model_failed,
       count(*) filter (where status = 'done') + count(*) filter (where status = 'failed' and attempts > 0) as reached_model,
       round(100.0 * count(*) filter (where status = 'failed' and attempts > 0)
             / nullif(count(*) filter (where status = 'done' or (status = 'failed' and attempts > 0)), 0), 1) as model_failure_pct,
       count(*) filter (where status = 'failed' and coalesce(attempts, 0) = 0) as input_failed,
       round(100.0 * count(*) filter (where status = 'failed' and coalesce(attempts, 0) = 0) / nullif(count(*), 0), 1) as input_failure_pct
from public.scan_events
where source = 'player' and status in ('done', 'failed');


-- name: latency_p50_p95
select count(*) as done_scans,
       percentile_cont(0.5) within group (order by latency_ms) as p50_ms,
       percentile_cont(0.95) within group (order by latency_ms) as p95_ms
from public.scan_events
where source = 'player' and status = 'done' and latency_ms is not null;


-- name: cost_per_day
-- cost per day over done and failed (billed failures keep their cost).
select date_trunc('day', created_at)::date as day,
       count(*) as photos,
       sum(cost_usd) as cost_usd
from public.scan_events
where source = 'player' and status in ('done', 'failed')
group by 1
order by 1 desc;


-- name: distinct_committing_players
-- Outcomes are written on commit, so a row with outcomes is a committed scan.
select count(distinct user_id) as committing_players,
       count(*) as committed_scans
from public.scan_events
where source = 'player' and outcomes is not null;


-- name: kill_correction_rate_days_7_14
-- KILL: correction rate > 30% over days 7-14 after launch, minimum 100 committed
-- detections. Launch = the first player row. Action: keep Beta, pull v1.1 legend
-- fields and the second look forward.
with committed as (
  select e.created_at, d.value as det, o.value as o,
         (coalesce((o.value ->> 'nameChanged')::boolean, false)
          or coalesce((o.value ->> 'printingChanged')::boolean, false)
          or coalesce(o.value ->> 'removedAs', '') = 'wrong') as corrected,
         coalesce((o.value ->> 'printingChanged')::boolean, false) as printing_changed
  from public.scan_events e
  cross join lateral jsonb_array_elements(coalesce(e.detections, '[]'::jsonb)) d
  join lateral jsonb_array_elements(coalesce(e.outcomes, '[]'::jsonb)) o on o.value ->> 'id' = d.value ->> 'id'
  where e.source = 'player' and e.status = 'done' and e.outcomes is not null
    and coalesce(o.value ->> 'removedAs', '') <> 'unwanted'
    and coalesce((o.value ->> 'unresolved')::boolean, false) = false
)
select count(*) as committed,
       count(*) filter (where corrected) as corrected,
       round(100.0 * count(*) filter (where corrected) / nullif(count(*), 0), 1) as correction_pct,
       count(*) >= 100 as enough_data,
       (count(*) >= 100 and 100.0 * count(*) filter (where corrected) / count(*) > 30) as kill_triggered
from committed c
join (select min(created_at) as t from public.scan_events where source = 'player') launch
  on c.created_at >= launch.t + interval '7 days' and c.created_at < launch.t + interval '14 days';

-- name: kill_printing_share_of_corrections_14d
-- KILL: printing share of corrections > 0.5, trailing 14 days, minimum 30 corrections.
-- Printing share = corrections with printingChanged / all corrections.
-- Action: start Stage A2.
with committed as (
  select e.created_at, d.value as det, o.value as o,
         (coalesce((o.value ->> 'nameChanged')::boolean, false)
          or coalesce((o.value ->> 'printingChanged')::boolean, false)
          or coalesce(o.value ->> 'removedAs', '') = 'wrong') as corrected,
         coalesce((o.value ->> 'printingChanged')::boolean, false) as printing_changed
  from public.scan_events e
  cross join lateral jsonb_array_elements(coalesce(e.detections, '[]'::jsonb)) d
  join lateral jsonb_array_elements(coalesce(e.outcomes, '[]'::jsonb)) o on o.value ->> 'id' = d.value ->> 'id'
  where e.source = 'player' and e.status = 'done' and e.outcomes is not null
    and coalesce(o.value ->> 'removedAs', '') <> 'unwanted'
    and coalesce((o.value ->> 'unresolved')::boolean, false) = false
)
select count(*) as corrections,
       count(*) filter (where printing_changed) as printing_corrections,
       round(count(*) filter (where printing_changed)::numeric / nullif(count(*), 0), 3) as printing_share,
       count(*) >= 30 as enough_data,
       (count(*) >= 30 and count(*) filter (where printing_changed)::numeric / count(*) > 0.5) as kill_triggered
from committed
where corrected and created_at >= now() - interval '14 days';

-- name: kill_failure_or_latency_3d
-- KILL: model failure rate > 10% or p95 latency > 20 s, trailing 3 days. Action:
-- investigate before anything else ships. No minimum n is specified; read n alongside
-- the flags. Model failure = failed with attempts > 0, over photos that reached the
-- model (done + model failures); input failures (attempts = 0: undecodable, pixel limit,
-- missing key) never called the model and are reported beside it, not in the kill.
select count(*) filter (where status = 'done' or (status = 'failed' and attempts > 0)) as reached_model,
       count(*) filter (where status = 'failed' and attempts > 0) as model_failed,
       count(*) filter (where status = 'failed' and coalesce(attempts, 0) = 0) as input_failed,
       round(100.0 * count(*) filter (where status = 'failed' and attempts > 0)
             / nullif(count(*) filter (where status = 'done' or (status = 'failed' and attempts > 0)), 0), 1) as model_failure_pct,
       percentile_cont(0.95) within group (order by latency_ms) filter (where status = 'done' and latency_ms is not null) as p95_ms,
       coalesce(100.0 * count(*) filter (where status = 'failed' and attempts > 0)
             / nullif(count(*) filter (where status = 'done' or (status = 'failed' and attempts > 0)), 0) > 10, false) as failure_kill,
       coalesce(percentile_cont(0.95) within group (order by latency_ms) filter (where status = 'done' and latency_ms is not null) > 20000, false) as latency_kill
from public.scan_events
where source = 'player' and created_at >= now() - interval '3 days';
