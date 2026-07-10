-- ─────────────────────────────────────────────────────────────────────────
-- Seed: demo listings — 3 coherent posts per category (18 total)
-- ─────────────────────────────────────────────────────────────────────────
-- Populates the Argentina feed so a fresh deploy (or the public demo) shows a
-- realistic catalogue instead of one lonely card per category.
--
-- What this does:
--   • 6 existing demo posts (1 per category): keeps their copy but swaps the
--     random stock photos for imagery that MATCHES the service (a hairdresser
--     for "Peluquería", pipes for "Plomería", etc.).
--   • 12 new posts (2 per category) with coherent title/description/attributes
--     and matching photos, so every category lists 3 anuncios.
--
-- Images are Unsplash URLs (host whitelisted in next.config.ts). `getCloudinaryUrl`
-- passes non-Cloudinary URLs through untouched, so they render via next/image
-- without transformation.
--
-- Idempotent: keyed on a fixed `id` per row with ON CONFLICT DO UPDATE, so it
-- can be re-run and also corrects the 6 pre-existing rows in place. Seed rows
-- have user_id = NULL (no owner) — they are demo content, safe to delete.
-- ─────────────────────────────────────────────────────────────────────────

INSERT INTO posts (
  id, title, description, category, tier, price, currency, localidad,
  image_urls, profile_photo_url, attributes, post_slug, country_id,
  status, is_approved, is_hidden, is_paused, is_promoted, promo_price
)
SELECT
  v.id::uuid,
  v.title,
  v.description,
  v.category,
  v.tier,
  v.price::int,
  'ARS',
  v.localidad,
  string_to_array(v.images, '|'),
  (string_to_array(v.images, '|'))[1],
  v.attributes::jsonb,
  v.post_slug,
  c.cid,
  'published', true, false, false,
  v.is_promoted::boolean,
  v.promo_price::int
FROM (
  VALUES
  -- ── Belleza y Bienestar ────────────────────────────────────────────────
  ('0099f2f0-062a-4e6d-95da-265971092c2d',
   'Peluquería y color a domicilio',
   'Cortes, color, brushing y peinados para eventos, en la comodidad de tu casa. Productos profesionales incluidos.',
   'belleza-bienestar', 'gold', '9000', 'Centro',
   'https://images.unsplash.com/photo-1634449571010-02389ed0f9b0?auto=format&fit=crop&w=800&h=1000&q=80|https://images.unsplash.com/photo-1700760934268-8aa0ef52ce0a?auto=format&fit=crop&w=800&h=1000&q=80',
   '{"rate":9000,"modality":["A domicilio","En local"],"languages":["Español"],"availability":["Lunes a viernes","Fines de semana"],"service_area":"Centro y zona norte","certifications":"","experience_years":10}',
   'peluqueria-color-domicilio', 'false', NULL),

  ('178c2284-af87-4e69-956d-dc998656afb6',
   'Manicura y uñas esculpidas',
   'Esmaltado semipermanente, kapping y uñas esculpidas en gel. Diseños personalizados y nail art. Atención con turno previo.',
   'belleza-bienestar', 'silver', '5000', 'Palermo',
   'https://images.unsplash.com/photo-1632345031435-8727f6897d53?auto=format&fit=crop&w=800&h=1000&q=80|https://images.unsplash.com/photo-1690749138086-7422f71dc159?auto=format&fit=crop&w=800&h=1000&q=80',
   '{"rate":5000,"modality":["En local","A domicilio"],"languages":["Español"],"availability":["Lunes a viernes","Fines de semana"],"service_area":"Palermo y Villa Crespo","certifications":"Curso profesional de manicura","experience_years":6}',
   'manicura-unas-esculpidas', 'true', '4000'),

  ('06b3664b-76b1-4f7b-8800-6a6a6995fde6',
   'Masajes descontracturantes y spa',
   'Masajes descontracturantes, drenaje linfático y relajación con aromaterapia. Camilla propia para atención a domicilio.',
   'belleza-bienestar', 'bronze', '7000', 'Belgrano',
   'https://images.unsplash.com/photo-1741522509438-a120c0bb5e88?auto=format&fit=crop&w=800&h=1000&q=80|https://images.unsplash.com/photo-1639162906614-0603b0ae95fd?auto=format&fit=crop&w=800&h=1000&q=80',
   '{"rate":7000,"modality":["A domicilio","En local"],"languages":["Español","Inglés"],"availability":["Lunes a viernes","Noches"],"service_area":"Belgrano y Núñez","certifications":"Masajista profesional","experience_years":8}',
   'masajes-descontracturantes-spa', 'false', NULL),

  -- ── Clases Particulares ────────────────────────────────────────────────
  ('b0b01651-e880-4954-9c24-9c350afd71b8',
   'Clases particulares de matemática y física',
   'Apoyo escolar y preparación de finales para secundario y CBC. Clases presenciales u online, material incluido.',
   'clases-particulares', 'silver', '6000', 'Online / A domicilio',
   'https://images.unsplash.com/photo-1453733190371-0a9bedd82893?auto=format&fit=crop&w=800&h=1000&q=80|https://images.unsplash.com/photo-1518133910546-b6c2fb7d79e3?auto=format&fit=crop&w=800&h=1000&q=80',
   '{"rate":6000,"modality":["A domicilio","Remoto"],"languages":["Español","Inglés"],"availability":["Lunes a viernes","Noches"],"service_area":"Online y a domicilio","certifications":"Profesora de Matemática (UBA)","experience_years":8}',
   'clases-matematica-fisica', 'false', NULL),

  ('2864bfbb-b737-499d-8cde-1b7ec3dd465d',
   'Clases de guitarra y teoría musical',
   'Guitarra criolla y eléctrica para todos los niveles. Lectura, armonía y repertorio a elección. Primera clase de prueba sin cargo.',
   'clases-particulares', 'bronze', '5500', 'Caballito',
   'https://images.unsplash.com/photo-1525201548942-d8732f6617a0?auto=format&fit=crop&w=800&h=1000&q=80|https://images.unsplash.com/photo-1758524944402-1903b38f848f?auto=format&fit=crop&w=800&h=1000&q=80',
   '{"rate":5500,"modality":["A domicilio","En local","Remoto"],"languages":["Español"],"availability":["Lunes a viernes","Fines de semana"],"service_area":"Caballito y alrededores","certifications":"Egresado de conservatorio","experience_years":7}',
   'clases-guitarra-teoria-musical', 'false', NULL),

  ('715723cf-eeac-4ff9-a4cd-5ca69eef4546',
   'Clases de inglés conversacional',
   'Inglés conversacional y preparación de exámenes (First, TOEFL). Clases dinámicas, material incluido y seguimiento personalizado.',
   'clases-particulares', 'silver', '6500', 'Online / A domicilio',
   'https://images.unsplash.com/photo-1543165796-5426273eaab3?auto=format&fit=crop&w=800&h=1000&q=80|https://images.unsplash.com/photo-1516979187457-637abb4f9353?auto=format&fit=crop&w=800&h=1000&q=80',
   '{"rate":6500,"modality":["Remoto","A domicilio"],"languages":["Español","Inglés"],"availability":["Lunes a viernes","Noches"],"service_area":"Online y a domicilio","certifications":"Traductora pública de inglés","experience_years":10}',
   'clases-ingles-conversacional', 'false', NULL),

  -- ── Eventos y Fotografía ───────────────────────────────────────────────
  ('d07dd0f8-e28d-4968-acbb-27638a7db2ae',
   'Fotografía de eventos y books',
   'Cobertura fotográfica de casamientos, cumpleaños y eventos corporativos. Books personales y de producto. Entrega en alta resolución.',
   'eventos-fotografia', 'silver', '25000', 'Toda la ciudad',
   'https://images.unsplash.com/photo-1493863641943-9b68992a8d07?auto=format&fit=crop&w=800&h=1000&q=80|https://images.unsplash.com/photo-1603574670812-d24560880210?auto=format&fit=crop&w=800&h=1000&q=80',
   '{"rate":25000,"modality":["A domicilio"],"languages":["Español","Inglés"],"availability":["Fines de semana"],"service_area":"Toda la ciudad","certifications":"","experience_years":6}',
   'fotografia-eventos-books', 'false', NULL),

  ('62d0cf74-ab6b-4f5f-ad7b-c049332734d2',
   'DJ y sonido para fiestas',
   'DJ para casamientos, cumpleaños y eventos corporativos. Equipo de sonido e iluminación propio. Música a medida para cada momento.',
   'eventos-fotografia', 'gold', '40000', 'Toda la ciudad',
   'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?auto=format&fit=crop&w=800&h=1000&q=80|https://images.unsplash.com/photo-1516873240891-4bf014598ab4?auto=format&fit=crop&w=800&h=1000&q=80',
   '{"rate":40000,"modality":["A domicilio"],"languages":["Español"],"availability":["Fines de semana","Noches"],"service_area":"Toda la ciudad y zona norte","certifications":"","experience_years":12}',
   'dj-sonido-fiestas', 'false', NULL),

  ('f860673c-9f5b-475e-b63a-f201ff783945',
   'Catering y mesa dulce para eventos',
   'Catering, finger food y mesa dulce para eventos sociales y corporativos. Opciones vegetarianas y sin TACC. Presupuesto a medida.',
   'eventos-fotografia', 'bronze', '35000', 'Toda la ciudad',
   'https://images.unsplash.com/photo-1675949873154-7496809f1c9b?auto=format&fit=crop&w=800&h=1000&q=80|https://images.unsplash.com/photo-1672698977671-9eb551549dcb?auto=format&fit=crop&w=800&h=1000&q=80',
   '{"rate":35000,"modality":["A domicilio"],"languages":["Español"],"availability":["Fines de semana"],"service_area":"Toda la ciudad","certifications":"Manipulación de alimentos","experience_years":9}',
   'catering-mesa-dulce-eventos', 'true', '28000'),

  -- ── Hogar y Reparaciones ───────────────────────────────────────────────
  ('8ed006c6-e370-42f8-95ac-b29dc2cd7f02',
   'Plomería y destapaciones 24hs',
   'Servicio de plomería para hogar y comercio. Destapaciones, instalaciones, reparación de pérdidas y calefones. Presupuesto sin cargo.',
   'hogar-reparaciones', 'gold', '8000', 'Centro y alrededores',
   'https://images.unsplash.com/photo-1749532125405-70950966b0e5?auto=format&fit=crop&w=800&h=1000&q=80|https://images.unsplash.com/photo-1676210134188-4c05dd172f89?auto=format&fit=crop&w=800&h=1000&q=80',
   '{"rate":8000,"modality":["A domicilio"],"languages":["Español"],"availability":["24 horas"],"service_area":"Centro y alrededores","certifications":"Matrícula de Gas N° 12345","experience_years":12}',
   'plomeria-destapaciones-24hs', 'false', NULL),

  ('bfe164f8-cb91-496e-95c2-21a4d780ecac',
   'Electricista matriculado',
   'Instalaciones eléctricas, tableros, disyuntores y reparación de cortocircuitos. Trabajos con materiales de primera marca y garantía.',
   'hogar-reparaciones', 'silver', '9500', 'Zona Oeste',
   'https://images.unsplash.com/photo-1621905251189-08b45d6a269e?auto=format&fit=crop&w=800&h=1000&q=80|https://images.unsplash.com/photo-1635335874521-7987db781153?auto=format&fit=crop&w=800&h=1000&q=80',
   '{"rate":9500,"modality":["A domicilio"],"languages":["Español"],"availability":["Lunes a viernes","24 horas"],"service_area":"Zona oeste y CABA","certifications":"Matrícula de electricista","experience_years":14}',
   'electricista-matriculado', 'false', NULL),

  ('cc9dcecd-7c17-4c43-a24f-737b3ff411e0',
   'Pintura y empapelado de interiores',
   'Pintura de interiores y exteriores, empapelado y trabajos en seco. Prolijidad, cuidado del mobiliario y entrega en tiempo y forma.',
   'hogar-reparaciones', 'bronze', '12000', 'Zona Sur',
   'https://images.unsplash.com/photo-1717281234297-3def5ae3eee1?auto=format&fit=crop&w=800&h=1000&q=80|https://images.unsplash.com/photo-1688372199140-cade7ae820fe?auto=format&fit=crop&w=800&h=1000&q=80',
   '{"rate":12000,"modality":["A domicilio"],"languages":["Español"],"availability":["Lunes a viernes","Fines de semana"],"service_area":"Zona sur y CABA","certifications":"","experience_years":11}',
   'pintura-empapelado-interiores', 'false', NULL),

  -- ── Tecnología y Soporte ───────────────────────────────────────────────
  ('2afce6c9-2e1a-4de8-adf3-82f14c50c922',
   'Soporte técnico y reparación de PC',
   'Reparación de computadoras y notebooks, eliminación de virus, instalación de software y armado de redes. Atención a domicilio o remota.',
   'tecnologia', 'bronze', '7000', 'Centro',
   'https://images.unsplash.com/photo-1756801370266-f589801cedc3?auto=format&fit=crop&w=800&h=1000&q=80|https://images.unsplash.com/photo-1591238372338-22d30c883a86?auto=format&fit=crop&w=800&h=1000&q=80',
   '{"rate":7000,"modality":["A domicilio","En local","Remoto"],"languages":["Español"],"availability":["Lunes a viernes"],"service_area":"Centro","certifications":"Técnico en Redes","experience_years":9}',
   'soporte-tecnico-reparacion-pc', 'false', NULL),

  ('e9ec7883-07ba-45ad-8f34-e3d7c8b671e7',
   'Desarrollo de páginas web y tiendas online',
   'Diseño y desarrollo de sitios web, landing pages y tiendas online. Optimización SEO, autogestión de contenidos y soporte post-entrega.',
   'tecnologia', 'gold', '50000', 'Online / A domicilio',
   'https://images.unsplash.com/photo-1498050108023-c5249f4df085?auto=format&fit=crop&w=800&h=1000&q=80|https://images.unsplash.com/photo-1619410283995-43d9134e7656?auto=format&fit=crop&w=800&h=1000&q=80',
   '{"rate":50000,"modality":["Remoto"],"languages":["Español","Inglés"],"availability":["Lunes a viernes"],"service_area":"Online (todo el país)","certifications":"Desarrollador full-stack","experience_years":8}',
   'desarrollo-web-tiendas-online', 'false', NULL),

  ('60280bfc-7a60-42c9-ab77-093d775f0ab1',
   'Reparación de celulares y tablets',
   'Cambio de pantallas, baterías y módulos de carga. Reparación de celulares y tablets de todas las marcas. Diagnóstico sin cargo.',
   'tecnologia', 'silver', '6000', 'Once',
   'https://images.unsplash.com/photo-1550041473-d296a3a8a18a?auto=format&fit=crop&w=800&h=1000&q=80|https://images.unsplash.com/photo-1746005718004-1f992c399428?auto=format&fit=crop&w=800&h=1000&q=80',
   '{"rate":6000,"modality":["En local","A domicilio"],"languages":["Español"],"availability":["Lunes a viernes","Fines de semana"],"service_area":"Once y Microcentro","certifications":"Técnico en electrónica","experience_years":7}',
   'reparacion-celulares-tablets', 'true', '4800'),

  -- ── Salud y Cuidados ───────────────────────────────────────────────────
  ('baf92c8d-f559-4626-87b1-42d7ca5fe091',
   'Enfermería y cuidado de adultos mayores',
   'Cuidado domiciliario de adultos mayores, control de signos vitales, aplicación de medicación y acompañamiento. Turnos diurnos y nocturnos.',
   'salud', 'gold', '5000', 'Zona Norte',
   'https://images.unsplash.com/photo-1762955911431-4c44c7c3f408?auto=format&fit=crop&w=800&h=1000&q=80|https://images.unsplash.com/photo-1624727828489-a1e03b79bba8?auto=format&fit=crop&w=800&h=1000&q=80',
   '{"rate":5000,"modality":["A domicilio"],"languages":["Español"],"availability":["Lunes a viernes","Fines de semana"],"service_area":"Zona norte","certifications":"Licenciada en Enfermería, Mat. Profesional","experience_years":15}',
   'enfermeria-cuidado-adultos-mayores', 'false', NULL),

  ('a4cd6e74-1147-47d0-b5c9-804180b695f8',
   'Kinesiología y rehabilitación a domicilio',
   'Sesiones de kinesiología y rehabilitación post-quirúrgica a domicilio. Tratamiento de lesiones, contracturas y recuperación funcional.',
   'salud', 'silver', '8000', 'Zona Norte',
   'https://images.unsplash.com/photo-1540205895360-4ad4cffb3aa8?auto=format&fit=crop&w=800&h=1000&q=80|https://images.unsplash.com/photo-1649751361457-01d3a696c7e6?auto=format&fit=crop&w=800&h=1000&q=80',
   '{"rate":8000,"modality":["A domicilio"],"languages":["Español"],"availability":["Lunes a viernes","Fines de semana"],"service_area":"Zona norte y CABA","certifications":"Lic. en Kinesiología, Mat. Profesional","experience_years":10}',
   'kinesiologia-rehabilitacion-domicilio', 'false', NULL),

  ('90f9421f-a221-4f86-be6e-f2b1d0d4769e',
   'Nutrición y planes alimentarios',
   'Consultas de nutrición y planes alimentarios personalizados. Descenso de peso, nutrición deportiva y hábitos saludables. Seguimiento online.',
   'salud', 'bronze', '7000', 'Online / A domicilio',
   'https://images.unsplash.com/photo-1512621776951-a57141f2eefd?auto=format&fit=crop&w=800&h=1000&q=80|https://images.unsplash.com/photo-1490818387583-1baba5e638af?auto=format&fit=crop&w=800&h=1000&q=80',
   '{"rate":7000,"modality":["Remoto","En local"],"languages":["Español"],"availability":["Lunes a viernes"],"service_area":"Online y consultorio","certifications":"Lic. en Nutrición","experience_years":9}',
   'nutricion-planes-alimentarios', 'false', NULL)
) AS v(id, title, description, category, tier, price, localidad, images, attributes, post_slug, is_promoted, promo_price)
CROSS JOIN (SELECT id AS cid FROM countries WHERE slug = 'argentina') c
ON CONFLICT (id) DO UPDATE SET
  title             = EXCLUDED.title,
  description       = EXCLUDED.description,
  category          = EXCLUDED.category,
  tier              = EXCLUDED.tier,
  price             = EXCLUDED.price,
  currency          = EXCLUDED.currency,
  localidad         = EXCLUDED.localidad,
  image_urls        = EXCLUDED.image_urls,
  profile_photo_url = EXCLUDED.profile_photo_url,
  attributes        = EXCLUDED.attributes,
  country_id        = EXCLUDED.country_id,
  status            = 'published',
  is_approved       = true,
  is_hidden         = false,
  is_paused         = false,
  is_promoted       = EXCLUDED.is_promoted,
  promo_price       = EXCLUDED.promo_price,
  updated_at        = now();
