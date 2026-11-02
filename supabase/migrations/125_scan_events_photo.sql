-- 125_scan_events_photo.sql
-- Card scanner: what each upload looked like, so the real photos' size, turn and
-- timings can be read without keeping any image. Written by finishScan
-- (lib/scan/events.ts) as PhotoFacts: bytes, EXIF-oriented width/height, the
-- orientation tag, format, the client's original size, the tier size the model
-- read, the turn pass's rotation, the crop pass's groups and milliseconds per
-- stage. Nullable: rows finished before this column, and rejected rows, have none.
-- No index: the E3 queries filter small tables.

alter table public.scan_events
  add column if not exists photo jsonb;
