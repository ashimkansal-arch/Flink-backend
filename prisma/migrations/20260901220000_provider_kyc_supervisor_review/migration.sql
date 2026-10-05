-- Provider KYC: supervisor review + one document per type per provider
ALTER TABLE "provider_documents" ADD COLUMN "reviewed_by_supervisor_id" UUID;

ALTER TABLE "provider_documents"
  ADD CONSTRAINT "provider_documents_reviewed_by_supervisor_id_fkey"
  FOREIGN KEY ("reviewed_by_supervisor_id") REFERENCES "supervisors"("supervisor_id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX "provider_documents_provider_id_document_type_key"
  ON "provider_documents"("provider_id", "document_type");
