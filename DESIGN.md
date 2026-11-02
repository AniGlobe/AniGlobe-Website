# AniCard design direction

Two tools on one static page, built from public AniList or MyAnimeList profiles.
Profile data is not stored. Requests go to AniList or to Jikan, which provides
public MyAnimeList data.

## Who it is for

People who already keep an AniList or MyAnimeList list and want one readable
summary of it, plus a small daily distraction. They are on a phone as often as
a laptop.

## What it should feel like

Quiet and legible, closer to a printed index card than to a dashboard. The
number is the loud part; the frame around it stays out of the way. A reader
should scan a card in five seconds and still find detail on a second look.

## Palette

- Paper #fafafa, surface #ffffff, ink #0d0d0d. The base is neutral so the data
  carries the colour.
- One accent, #4d6bfe, used for the primary action and the genre bars only.
  Everything else is grey. The accent marks where to act and what to compare.

## Type

System sans for prose, because it is what the reader device already renders
best and it keeps page weight near zero. The monospace face is reserved for
numbers, scores and the share string, where fixed width helps compare digits.

## Layout

One column, capped at 760px. The card is the focal point of its screen and the
daily clue list is the focal point of its own. Space between blocks is the only
separator; no dividers, no boxes inside boxes.

## Motion

Hover and focus only. Nothing moves on its own. The one exception is the loading
shimmer, which says something is in flight and then stops.

## Dials

Dial: ENERGY 1 / RHYTHM 2 / MOTION 1

## Rules for future changes

- A new tool earns its own route in the registry, not a section bolted onto an
  existing page.
- No number appears on screen unless it came from the profile or the
  date-selected catalog entry. Placeholders say what they are.
- If a control cannot do anything yet, it does not ship.
