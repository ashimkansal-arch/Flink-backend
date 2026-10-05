import { notificationCampaignRepository } from "../repositories/notification-campaign-repository";
import { userRepository } from "../repositories/user-repository";
import { serviceProviderRepository } from "../repositories/service-provider-repository";
import { notificationService } from "./notification-service";

const TONES = ["info", "success", "warning", "danger"] as const;
const AUDIENCES = ["customers", "workers"] as const;

export type BroadcastTone = (typeof TONES)[number];
export type BroadcastAudience = (typeof AUDIENCES)[number];

function mapAudience(value: string): BroadcastAudience {
  return value === "workers" || value === "providers" ? "workers" : "customers";
}

function toDto(row: {
  id: string;
  title: string;
  body: string;
  category: string;
  tone: string;
  audience: string;
  recipientCount: number;
  readAt: Date | null;
  archivedAt: Date | null;
  createdAt: Date;
}) {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    category: row.category,
    tone: row.tone,
    audience: mapAudience(row.audience),
    recipientCount: row.recipientCount,
    read: row.readAt != null,
    archived: row.archivedAt != null,
    createdAt: row.createdAt,
  };
}

export const notificationCampaignService = {
  async list() {
    const rows = await notificationCampaignRepository.list();
    return rows.map(toDto);
  },

  async broadcast(input: {
    title: string;
    body: string;
    tone: BroadcastTone;
    audience: BroadcastAudience;
    createdByAdminId: string;
  }) {
    const title = input.title.trim();
    const body = input.body.trim();
    if (!title || !body) throw new Error("TITLE_AND_MESSAGE_REQUIRED");

    const recipients =
      input.audience === "workers"
        ? (await serviceProviderRepository.listActiveIds()).map((row) => ({
            type: "provider" as const,
            id: row.id,
          }))
        : (await userRepository.listActiveCustomerIds()).map((row) => ({
            type: "customer" as const,
            id: row.id,
          }));

    const campaign = await notificationCampaignRepository.create({
      title,
      body,
      category: "system",
      tone: input.tone,
      audience: input.audience,
      recipientCount: recipients.length,
      createdByAdminId: input.createdByAdminId,
    });

    const payload = {
      title,
      body,
      tone: input.tone,
      campaignId: campaign.id,
    };
    for (const recipient of recipients) {
      notificationService.notify({
        recipientType: recipient.type,
        recipientId: recipient.id,
        templateKey: "admin.broadcast",
        payload,
        channels: ["push"],
      });
    }
    console.log(
      `[notification] broadcast queued campaign=${campaign.id} audience=${input.audience} recipients=${recipients.length}`,
    );

    return toDto(campaign);
  },

  async update(id: string, input: { read?: boolean; archived?: boolean }) {
    const existing = await notificationCampaignRepository.findById(id);
    if (!existing || existing.archivedAt) throw new Error("NOTIFICATION_NOT_FOUND");
    const row = await notificationCampaignRepository.update(id, {
      readAt: input.read === undefined ? undefined : input.read ? new Date() : null,
      archivedAt: input.archived ? new Date() : undefined,
    });
    return toDto(row);
  },
};
