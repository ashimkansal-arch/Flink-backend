import { randomUUID } from "node:crypto";
import { z } from "zod";

const checklistItemSchema = z.object({
  id: z.string().uuid(),
  label: z.string().min(1),
  done: z.boolean(),
});

type SessionChecklistItem = z.infer<typeof checklistItemSchema>;

export function parseChecklist(value: unknown): SessionChecklistItem[] {
  const parsed = z.array(checklistItemSchema).safeParse(value);
  return parsed.success ? parsed.data : [];
}

export function seedChecklist(labels: string[]): SessionChecklistItem[] {
  const seen = new Set<string>();
  const items: SessionChecklistItem[] = [];
  for (const label of labels) {
    const trimmed = label.trim();
    if (!trimmed || seen.has(trimmed.toLowerCase())) continue;
    seen.add(trimmed.toLowerCase());
    items.push({ id: randomUUID(), label: trimmed, done: false });
  }
  return items;
}

export function sessionDurationMinutes(input: {
  planDurationMinutes?: number | null;
  serviceSessionMinutes: Array<number | null | undefined>;
}): number {
  if (input.planDurationMinutes && input.planDurationMinutes > 0) {
    return input.planDurationMinutes;
  }
  const sum = input.serviceSessionMinutes.reduce<number>((total, minutes) => total + (minutes ?? 0), 0);
  return sum > 0 ? sum : 60;
}

function computeSessionTimer(input: {
  startedAt: Date;
  sessionMinutes: number;
  overtimeRatePaise: number;
  completedAt?: Date | null;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const clock = input.completedAt && input.completedAt.getTime() < now.getTime() ? input.completedAt : now;
  const durationSeconds = input.sessionMinutes * 60;
  const elapsedSeconds = Math.max(0, Math.floor((clock.getTime() - input.startedAt.getTime()) / 1000));
  const remainingSeconds = Math.max(0, durationSeconds - elapsedSeconds);
  return {
    startedAt: input.startedAt.toISOString(),
    durationMinutes: input.sessionMinutes,
    elapsedSeconds,
    remainingSeconds,
    overtimeSeconds: Math.max(0, elapsedSeconds - durationSeconds),
    overtimeRatePaise: input.overtimeRatePaise,
    expired: remainingSeconds === 0,
    serverTime: now.toISOString(),
  };
}

export function setChecklistItemDone(items: SessionChecklistItem[], itemId: string, done: boolean) {
  const index = items.findIndex((item) => item.id === itemId);
  if (index < 0) throw new Error("CHECKLIST_ITEM_NOT_FOUND");
  return items.map((item, i) => (i === index ? { ...item, done } : item));
}

export function sessionFromBooking(
  booking: {
    startedAt: Date | null;
    completedAt?: Date | null;
    sessionMinutes: number | null;
    sessionChecklist: unknown;
    overtimeRatePaise: number;
    plan?: { durationMinutes: number } | null;
  },
  services: Array<{ sessionMinutes?: number | null }> = [],
) {
  if (!booking.startedAt) return null;
  const durationMinutes =
    booking.sessionMinutes ??
    sessionDurationMinutes({
      planDurationMinutes: booking.plan?.durationMinutes,
      serviceSessionMinutes: services.map((service) => service.sessionMinutes),
    });
  const items = parseChecklist(booking.sessionChecklist);
  const currentIndex = items.findIndex((item) => !item.done);
  return {
    timer: computeSessionTimer({
      startedAt: booking.startedAt,
      sessionMinutes: durationMinutes,
      overtimeRatePaise: booking.overtimeRatePaise,
      completedAt: booking.completedAt,
    }),
    checklist: items.map((item, index) => ({
      ...item,
      status: (item.done ? "done" : index === currentIndex ? "in_progress" : "pending") as
        | "done"
        | "in_progress"
        | "pending",
    })),
  };
}
