-- Remove an incorrect manual duplicate group for "Unclean Animals".
-- [Camels] (4/9, negates band abilities, paralyzes a Hero) and
-- [Rock Hyrax] (1/4, negates good draw abilities, bands to an animal)
-- are genuinely different cards that happen to share a base name.
-- Same pattern fixed in 021_remove_servants_of_king_duplicate_group.sql,
-- which this one fell through the cracks of.

DELETE FROM duplicate_card_group_members WHERE group_id = 1704;
DELETE FROM duplicate_card_groups WHERE id = 1704;

INSERT INTO dismissed_duplicate_suggestions (base_name, card_type) VALUES
  ('Unclean Animals', 'evil character')
ON CONFLICT (base_name) DO NOTHING;
