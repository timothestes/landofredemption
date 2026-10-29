-- 124_scan_events_mode.sql
-- Card scanner, deck photo import (docs/superpowers/specs/2026-10-29-deck-photo-import-design.md,
-- "Migration 124_scan_events_mode.sql").
--
-- scan_events.mode: which scanner mode produced the photo. Collection scans are
-- the default, so existing rows read 'collection'. Written by finishScan
-- (lib/scan/events.ts). scan_reserve() is unchanged and caps still count every
-- mode. No index: the E3 queries filter small tables.

alter table public.scan_events
  add column if not exists mode text not null default 'collection'
    check (mode in ('collection', 'deck'));
