-- Rename provider_documents → provider_kyc_documents
ALTER TABLE "provider_documents" RENAME TO "provider_kyc_documents";

ALTER TABLE "provider_kyc_documents" RENAME CONSTRAINT "provider_documents_pkey" TO "provider_kyc_documents_pkey";
ALTER TABLE "provider_kyc_documents" RENAME CONSTRAINT "provider_documents_provider_id_fkey" TO "provider_kyc_documents_provider_id_fkey";
ALTER TABLE "provider_kyc_documents" RENAME CONSTRAINT "provider_documents_reviewed_by_fkey" TO "provider_kyc_documents_reviewed_by_fkey";
ALTER TABLE "provider_kyc_documents" RENAME CONSTRAINT "provider_documents_reviewed_by_supervisor_id_fkey" TO "provider_kyc_documents_reviewed_by_supervisor_id_fkey";

ALTER INDEX "idx_provider_docs_provider" RENAME TO "idx_provider_kyc_docs_provider";
ALTER INDEX "provider_documents_provider_id_document_type_key" RENAME TO "provider_kyc_documents_provider_id_document_type_key";
