-- Admin addresses (one per admin user) and supervisor assigned-to admin
CREATE TABLE "admin_addresses" (
    "admin_address_id" UUID NOT NULL,
    "admin_id" UUID NOT NULL,
    "country" VARCHAR(80) NOT NULL DEFAULT 'India',
    "state" VARCHAR(80),
    "city" VARCHAR(80),
    "address_line_1" VARCHAR(200),
    "address_line_2" VARCHAR(200),
    "pincode" VARCHAR(10),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admin_addresses_pkey" PRIMARY KEY ("admin_address_id")
);

CREATE UNIQUE INDEX "admin_addresses_admin_id_key" ON "admin_addresses"("admin_id");

ALTER TABLE "admin_addresses" ADD CONSTRAINT "admin_addresses_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "admin_users"("admin_id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "supervisors" ADD COLUMN "assigned_to" UUID;

CREATE INDEX "idx_supervisors_assigned_to" ON "supervisors"("assigned_to");

ALTER TABLE "supervisors" ADD CONSTRAINT "supervisors_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "admin_users"("admin_id") ON DELETE SET NULL ON UPDATE CASCADE;
