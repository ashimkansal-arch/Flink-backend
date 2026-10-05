import { legalSupportRepository } from "../repositories/legal-support-repository";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function emptyToNull(value: string | null | undefined) {
  const trimmed = value?.trim() ?? "";
  return trimmed ? trimmed : null;
}

function toDto(row: Awaited<ReturnType<typeof legalSupportRepository.getOrCreate>>) {
  return {
    termsOfService: row.termsOfService,
    privacyPolicy: row.privacyPolicy,
    refundPolicy: row.refundPolicy,
    cancellationPolicy: row.cancellationPolicy,
    pricingAndPayment: row.pricingAndPayment,
    contactEmail: row.contactEmail,
    contactPhone: row.contactPhone,
    faqs: row.faqs.map((faq) => ({
      id: faq.id,
      question: faq.question,
      answer: faq.answer,
    })),
    updatedAt: row.updatedAt,
  };
}

export const legalSupportService = {
  async get() {
    return toDto(await legalSupportRepository.getOrCreate());
  },

  async update(
    input: {
      termsOfService: string;
      privacyPolicy: string;
      refundPolicy: string;
      cancellationPolicy: string;
      pricingAndPayment: string;
      contactEmail: string | null;
      contactPhone: string | null;
      faqs: { id?: string; question: string; answer: string }[];
    },
    adminId?: string,
  ) {
    const faqs = input.faqs.map((faq) => {
      const question = faq.question.trim();
      const answer = faq.answer.trim();
      if (!question || !answer) throw new Error("INVALID_FAQ");
      return {
        id: faq.id && UUID_RE.test(faq.id) ? faq.id : undefined,
        question,
        answer,
      };
    });

    return toDto(
      await legalSupportRepository.update({
        termsOfService: input.termsOfService.trim(),
        privacyPolicy: input.privacyPolicy.trim(),
        refundPolicy: input.refundPolicy.trim(),
        cancellationPolicy: input.cancellationPolicy.trim(),
        pricingAndPayment: input.pricingAndPayment.trim(),
        contactEmail: emptyToNull(input.contactEmail),
        contactPhone: emptyToNull(input.contactPhone),
        faqs,
        updatedByAdminId: adminId ?? null,
      }),
    );
  },
};
