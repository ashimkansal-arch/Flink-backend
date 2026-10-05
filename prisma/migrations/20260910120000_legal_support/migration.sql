-- Legal & Support: public Terms, Privacy, FAQs, and contact details.
-- System sidebar module, assigned to Super Admin.

CREATE TABLE "legal_support_content" (
  "id" VARCHAR(32) NOT NULL DEFAULT 'default',
  "terms_of_service" TEXT NOT NULL DEFAULT '',
  "privacy_policy" TEXT NOT NULL DEFAULT '',
  "contact_email" VARCHAR(160),
  "contact_phone" VARCHAR(20),
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_by_admin_id" UUID,

  CONSTRAINT "legal_support_content_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "legal_support_faqs" (
  "faq_id" UUID NOT NULL,
  "content_id" VARCHAR(32) NOT NULL DEFAULT 'default',
  "question" VARCHAR(240) NOT NULL,
  "answer" TEXT NOT NULL,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "legal_support_faqs_pkey" PRIMARY KEY ("faq_id")
);

CREATE INDEX "idx_legal_support_faqs_order" ON "legal_support_faqs"("content_id", "sort_order");

ALTER TABLE "legal_support_faqs"
  ADD CONSTRAINT "legal_support_faqs_content_id_fkey"
  FOREIGN KEY ("content_id") REFERENCES "legal_support_content"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "legal_support_content" ("id", "updated_at")
VALUES ('default', CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "admin_permissions" ("permission_id", "permission_key", "description")
SELECT gen_random_uuid(), v.key, v.description
FROM (VALUES
  ('legal-support:update', 'Can update Legal & Support content')
) AS v(key, description)
WHERE NOT EXISTS (
  SELECT 1 FROM "admin_permissions" p WHERE p."permission_key" = v.key
);

INSERT INTO "admin_modules" (
  "module_id",
  "name",
  "slug",
  "section_name",
  "section_slug",
  "path",
  "icon",
  "description",
  "is_active",
  "created_at",
  "updated_at"
)
SELECT
  gen_random_uuid(),
  'Legal & Support',
  'legal-support',
  'System',
  'system',
  '/legal-support',
  'Scale',
  'Terms, privacy policy, FAQs, and support contact details for the apps.',
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
WHERE NOT EXISTS (
  SELECT 1
  FROM "admin_modules" m
  WHERE m."slug" = 'legal-support' OR m."path" = '/legal-support'
);

INSERT INTO "role_modules" ("role_id", "module_id")
SELECT r."role_id", m."module_id"
FROM "admin_roles" r
CROSS JOIN "admin_modules" m
WHERE r."role_name" = 'super_admin'
  AND m."slug" = 'legal-support'
  AND m."is_active" = true
  AND NOT EXISTS (
    SELECT 1
    FROM "role_modules" rm
    WHERE rm."role_id" = r."role_id"
      AND rm."module_id" = m."module_id"
  );
