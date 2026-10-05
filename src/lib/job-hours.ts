const INDIA_TZ = "Asia/Kolkata";
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/** Accepts `HH:mm` or `HH:mm:ss` from HTML time inputs. */
export function normalizeHhmm(value: string) {
  const match = /^(\d{1,2}):([0-5]\d)(?::[0-5]\d(?:\.\d+)?)?$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  if (hours > 23) return null;
  return `${String(hours).padStart(2, "0")}:${match[2]}`;
}

export function timeToMinutes(hhmm: string) {
  const normalized = normalizeHhmm(hhmm) ?? hhmm;
  const [hours, minutes] = normalized.split(":").map(Number);
  return hours * 60 + minutes;
}


export function utcTimeHhmm(value?: Date | null) {
  if (!value) return null;
  return `${String(value.getUTCHours()).padStart(2, "0")}:${String(value.getUTCMinutes()).padStart(2, "0")}`;
}



export function indiaClock(at = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: INDIA_TZ,
      weekday: "short",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(at)
      .map((part) => [part.type, part.value]),
  );
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  const time = `${parts.hour}:${parts.minute}`;
  const dayOfWeek = WEEKDAYS.indexOf(parts.weekday as (typeof WEEKDAYS)[number]);
  return { date, time, dayOfWeek: dayOfWeek < 0 ? at.getUTCDay() : dayOfWeek, minutes: timeToMinutes(time) };
}

// India has no DST, so a fixed offset converts IST wall-clock times to exact instants.
const INDIA_UTC_OFFSET = "+05:30";
const DAY_MINUTES = 24 * 60;

/** Absolute instant for an IST wall-clock `YYYY-MM-DD` + `HH:mm`, independent of the server TZ. */
export function indiaDateTime(date: string, hhmm: string) {
  const time = normalizeHhmm(hhmm) ?? hhmm;
  return new Date(`${date}T${time}:00${INDIA_UTC_OFFSET}`);
}

/** Day of week (0 = Sun) of a calendar date, independent of the server TZ. */
export function dayOfWeekOf(date: string) {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

/** `HH:mm` → `9:00 AM` for customer-facing messages. */
export function formatHhmm12(hhmm: string) {
  const minutes = timeToMinutes(hhmm) % DAY_MINUTES;
  const hours = Math.floor(minutes / 60);
  const suffix = hours < 12 ? "AM" : "PM";
  return `${hours % 12 || 12}:${String(minutes % 60).padStart(2, "0")} ${suffix}`;
}

/**
 * True when a job starting at `hhmm` and lasting `durationMinutes` starts and finishes inside the
 * admin job hours. `start === end` means open all day; `start > end` is an overnight window.
 */
export function jobFitsHours(hhmm: string, durationMinutes: number, start: string, end: string) {
  const time = normalizeHhmm(hhmm);
  const from = normalizeHhmm(start);
  const to = normalizeHhmm(end);
  if (!time || !from || !to) return false;
  const startMinutes = timeToMinutes(from);
  const endMinutes = timeToMinutes(to);
  if (startMinutes === endMinutes) return durationMinutes <= DAY_MINUTES;
  const jobStart = timeToMinutes(time);
  const jobEnd = jobStart + durationMinutes;
  if (startMinutes < endMinutes) return jobStart >= startMinutes && jobEnd <= endMinutes;
  if (jobStart >= startMinutes) return jobEnd <= endMinutes + DAY_MINUTES;
  return jobEnd <= endMinutes;
}

/** Latest `HH:mm` a job of this length can start and still finish by the end of job hours. */
export function latestJobStart(durationMinutes: number, end: string) {
  const minutes = (((timeToMinutes(end) - durationMinutes) % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

export function addDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

/** The current Monday–Sunday week in IST (`nextStartDate` is the following Monday, for half-open ranges). */
export function indiaWeek(at = new Date()) {
  const clock = indiaClock(at);
  const startDate = addDays(clock.date, -((clock.dayOfWeek + 6) % 7));
  const nextStartDate = addDays(startDate, 7);
  return {
    startDate,
    endDate: addDays(startDate, 6),
    nextStartDate,
  };
}
