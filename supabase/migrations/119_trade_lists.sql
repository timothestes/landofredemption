-- Trade lists: each user's Wants and Haves, shareable at /trades/<username>,
-- plus a private trade log of completed trades (bottom of this file).
--
-- Items are keyed by the same card identity as collection_cards
-- (card_name, card_set, card_img_file), so a row always points at one
-- printing's image. A Want with any_version = true means "any printing of
-- this card"; the stored printing is just the image shown for it.
--
-- Kept separate from collection_cards on purpose: Haves are a choice of what
-- to offer, not every spare copy, and Wants are cards not yet owned.

CREATE TABLE trade_lists (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  -- false: owner only. true: public — readable by anyone (RLS below) and
  -- shown at /trades/<username>.
  is_shared boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE trade_list_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('want', 'have')),
  card_name text NOT NULL,
  card_set text NOT NULL,
  card_img_file text NOT NULL DEFAULT '',
  any_version boolean NOT NULL DEFAULT false,
  -- Wants only: shown in a highlighted "Priority wants" group.
  priority boolean NOT NULL DEFAULT false,
  quantity integer NOT NULL DEFAULT 1 CHECK (quantity BETWEEN 1 AND 99),
  note text NOT NULL DEFAULT '' CHECK (char_length(note) <= 120),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, kind, card_name, card_set, card_img_file)
);

CREATE TRIGGER update_trade_lists_updated_at
  BEFORE UPDATE ON trade_lists
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_trade_list_items_updated_at
  BEFORE UPDATE ON trade_list_items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE trade_lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE trade_list_items ENABLE ROW LEVEL SECURITY;

-- trade_lists: owner manages their row; anyone can read a shared one.
CREATE POLICY "Owner or shared trade lists are viewable" ON trade_lists
  FOR SELECT USING (is_shared = true OR auth.uid() = user_id);
CREATE POLICY "Users can create own trade list" ON trade_lists
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own trade list" ON trade_lists
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own trade list" ON trade_lists
  FOR DELETE USING (auth.uid() = user_id);

-- trade_list_items: owner manages; anyone can read items of a shared list.
CREATE POLICY "Owner or shared trade list items are viewable" ON trade_list_items
  FOR SELECT USING (
    auth.uid() = user_id
    OR EXISTS (
      SELECT 1 FROM trade_lists
      WHERE trade_lists.user_id = trade_list_items.user_id
        AND trade_lists.is_shared = true
    )
  );
CREATE POLICY "Users can add own trade list items" ON trade_list_items
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own trade list items" ON trade_list_items
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own trade list items" ON trade_list_items
  FOR DELETE USING (auth.uid() = user_id);

-- Trade log: a private record of completed trades. Owner-only; never shared.
-- Logging a trade also adjusts collection_cards (the log_trade RPC in 120).
-- `cards` is a JSON array of
--   { direction: 'gave'|'received', cardName, cardSet, cardImgFile,
--     quantity, unitPrice }
-- where unitPrice is the YTG retail price per copy when logged (or null), so
-- a trade's value at the time survives later price changes.
CREATE TABLE trade_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  traded_on date NOT NULL DEFAULT current_date,
  partner text NOT NULL DEFAULT '' CHECK (char_length(partner) <= 60),
  notes text NOT NULL DEFAULT '' CHECK (char_length(notes) <= 2000),
  cards jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(cards) = 'array'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_trade_log_user_id ON trade_log (user_id, traded_on DESC);

ALTER TABLE trade_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own trade log" ON trade_log
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can add to own trade log" ON trade_log
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete from own trade log" ON trade_log
  FOR DELETE USING (auth.uid() = user_id);
