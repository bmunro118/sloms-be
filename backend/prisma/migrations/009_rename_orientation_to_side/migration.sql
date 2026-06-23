-- Migration: 009_rename_orientation_to_side
-- Description: Rename Orientation to Side on tblOrderedItems to match domain language.

ALTER TABLE "tblOrderedItems" RENAME COLUMN "Orientation" TO "Side";
