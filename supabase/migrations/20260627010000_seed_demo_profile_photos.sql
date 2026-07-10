-- ─────────────────────────────────────────────────────────────────────────
-- Seed: portrait profile photos for the demo listings
-- ─────────────────────────────────────────────────────────────────────────
-- The post-detail page shows a large circular avatar from `profile_photo_url`.
-- The demo seed pointed that at the service-scene cover image (e.g. a reclining
-- hair-wash shot), so the face-aware avatar crop had no face to centre on and
-- the circle looked off.
--
-- This gives each demo listing a real PORTRAIT headshot for its avatar:
--   • profile_photo_url → a head-and-shoulders portrait (centred via the
--     Unsplash fit=facearea crop in getProfileCircleUrl).
--   • the portrait is appended to image_urls so PostDetailView (which only
--     honours profile_photo_url when it's part of image_urls) actually uses it.
--   • image_urls[0] stays the service photo, so the FEED cover and the detail
--     gallery keep showing the service — only the avatar becomes the portrait.
--
-- Idempotent: the portrait is appended only if not already present, and
-- profile_photo_url is set explicitly, so re-running is a no-op.
-- ─────────────────────────────────────────────────────────────────────────

UPDATE posts AS p SET
  image_urls = CASE WHEN v.portrait = ANY(p.image_urls)
                    THEN p.image_urls
                    ELSE array_append(p.image_urls, v.portrait) END,
  profile_photo_url = v.portrait,
  updated_at = now()
FROM (VALUES
  ('0099f2f0-062a-4e6d-95da-265971092c2d','https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=900&h=1200&q=80'),
  ('178c2284-af87-4e69-956d-dc998656afb6','https://images.unsplash.com/photo-1554151228-14d9def656e4?auto=format&fit=crop&w=900&h=1200&q=80'),
  ('06b3664b-76b1-4f7b-8800-6a6a6995fde6','https://images.unsplash.com/photo-1607990283143-e81e7a2c9349?auto=format&fit=crop&w=900&h=1200&q=80'),
  ('b0b01651-e880-4954-9c24-9c350afd71b8','https://images.unsplash.com/photo-1758685847747-597ce085906e?auto=format&fit=crop&w=900&h=1200&q=80'),
  ('2864bfbb-b737-499d-8cde-1b7ec3dd465d','https://images.unsplash.com/photo-1609833545986-4ea566a4dc65?auto=format&fit=crop&w=900&h=1200&q=80'),
  ('715723cf-eeac-4ff9-a4cd-5ca69eef4546','https://images.unsplash.com/photo-1573497019940-1c28c88b4f3e?auto=format&fit=crop&w=900&h=1200&q=80'),
  ('d07dd0f8-e28d-4968-acbb-27638a7db2ae','https://images.unsplash.com/photo-1609371497456-3a55a205d5eb?auto=format&fit=crop&w=900&h=1200&q=80'),
  ('62d0cf74-ab6b-4f5f-ad7b-c049332734d2','https://images.unsplash.com/photo-1683128001135-277a32155c51?auto=format&fit=crop&w=900&h=1200&q=80'),
  ('f860673c-9f5b-475e-b63a-f201ff783945','https://images.unsplash.com/photo-1759521296013-559479e2a891?auto=format&fit=crop&w=900&h=1200&q=80'),
  ('8ed006c6-e370-42f8-95ac-b29dc2cd7f02','https://images.unsplash.com/photo-1728516687003-58347d3412b3?auto=format&fit=crop&w=900&h=1200&q=80'),
  ('bfe164f8-cb91-496e-95c2-21a4d780ecac','https://images.unsplash.com/photo-1530983822321-fcac2d3c0f06?auto=format&fit=crop&w=900&h=1200&q=80'),
  ('cc9dcecd-7c17-4c43-a24f-737b3ff411e0','https://images.unsplash.com/photo-1709675155252-f00141380412?auto=format&fit=crop&w=900&h=1200&q=80'),
  ('2afce6c9-2e1a-4de8-adf3-82f14c50c922','https://images.unsplash.com/photo-1549538281-a47acc208d37?auto=format&fit=crop&w=900&h=1200&q=80'),
  ('e9ec7883-07ba-45ad-8f34-e3d7c8b671e7','https://images.unsplash.com/photo-1752738372136-2602aaafdcb7?auto=format&fit=crop&w=900&h=1200&q=80'),
  ('60280bfc-7a60-42c9-ab77-093d775f0ab1','https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=900&h=1200&q=80'),
  ('baf92c8d-f559-4626-87b1-42d7ca5fe091','https://images.unsplash.com/photo-1623854767648-e7bb8009f0db?auto=format&fit=crop&w=900&h=1200&q=80'),
  ('a4cd6e74-1147-47d0-b5c9-804180b695f8','https://images.unsplash.com/photo-1678695972687-033fa0bdbac9?auto=format&fit=crop&w=900&h=1200&q=80'),
  ('90f9421f-a221-4f86-be6e-f2b1d0d4769e','https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&w=900&h=1200&q=80')
) AS v(id, portrait)
WHERE p.id = v.id::uuid;
