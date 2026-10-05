ALTER TABLE "service_providers" ADD COLUMN "registered_by_supervisor_id" UUID;

ALTER TABLE "service_providers" ADD CONSTRAINT "service_providers_registered_by_supervisor_id_fkey"
  FOREIGN KEY ("registered_by_supervisor_id") REFERENCES "supervisors"("supervisor_id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "idx_providers_registered_by_supervisor" ON "service_providers"("registered_by_supervisor_id");
