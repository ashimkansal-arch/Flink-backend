import { db, readDb } from "../lib/prisma";
import { randomUUID } from "node:crypto";

const CONTENT_ID = "default";

export type LegalSupportFaqInput = {
  id?: string;
  question: string;
  answer: string;
};

export const legalSupportRepository = {
  async get() {
    return readDb.legalSupportContent.findUnique({
      where: { id: CONTENT_ID },
      include: { faqs: { orderBy: { sortOrder: "asc" } } },
    });
  },

  async getOrCreate() {
    const existing = await this.get();
    if (existing) return existing;
    return db.legalSupportContent.create({
      data: { id: CONTENT_ID },
      include: { faqs: { orderBy: { sortOrder: "asc" } } },
    });
  },

  async update(data: {
    termsOfService: string;
    privacyPolicy: string;
    refundPolicy: string;
    cancellationPolicy: string;
    pricingAndPayment: string;
    contactEmail: string | null;
    contactPhone: string | null;
    faqs: LegalSupportFaqInput[];
    updatedByAdminId?: string | null;
  }) {
    await this.getOrCreate();
    return db.$transaction(async (tx) => {
      await tx.legalSupportFaq.deleteMany({ where: { contentId: CONTENT_ID } });
      if (data.faqs.length > 0) {
        await tx.legalSupportFaq.createMany({
          data: data.faqs.map((faq, index) => ({
            id: faq.id ?? randomUUID(),
            contentId: CONTENT_ID,
            question: faq.question,
            answer: faq.answer,
            sortOrder: index,
          })),
        });
      }
      return tx.legalSupportContent.update({
        where: { id: CONTENT_ID },
        data: {
          termsOfService: data.termsOfService,
          privacyPolicy: data.privacyPolicy,
          refundPolicy: data.refundPolicy,
          cancellationPolicy: data.cancellationPolicy,
          pricingAndPayment: data.pricingAndPayment,
          contactEmail: data.contactEmail,
          contactPhone: data.contactPhone,
          updatedByAdminId: data.updatedByAdminId ?? null,
        },
        include: { faqs: { orderBy: { sortOrder: "asc" } } },
      });
    });
  },
};
