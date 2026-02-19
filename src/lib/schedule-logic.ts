/**
 * Logic for checking if a specific slot is available on a specific day of the week.
 * Slots:
 * 9 = Morning (9 to 13)
 * 18 = Afternoon (18 to 22)
 * 22 = Night (20 to 1)
 * 
 * 0 = Sunday, 1 = Monday, ..., 5 = Friday, 6 = Saturday
 */

export interface TimeSlot {
    id: number;
    label: string;
    subtext: string;
}

export const TIME_SLOTS: TimeSlot[] = [
    { id: 9, label: "Morning", subtext: "9 to 13" },
    { id: 18, label: "Afternoon", subtext: "18 to 22" },
    { id: 22, label: "Night", subtext: "20 to 1" }
];

export function isHourActiveForDay(dayOfWeek: number, slotId: number): boolean {
    // Afternoon and Night are active every day
    if (slotId === 18 || slotId === 22) return true;

    // Morning is only active on weekends
    if (slotId === 9) {
        return dayOfWeek === 6 || dayOfWeek === 0;
    }

    return false;
}

export function getSlotDate(dayDate: Date, hour: number): Date {
    const d = new Date(dayDate);
    d.setHours(hour, 0, 0, 0);
    // Rollover for the Night slot which ends at 1am. 
    // If we use 22 as ID, it's on the same day.
    // If we were using 0 or 1, we'd add a day.
    if (hour < 5) {
        d.setDate(d.getDate() + 1);
    }
    return d;
}

export function isSlotValidAndFuture(dayDate: Date, hour: number): boolean {
    const dayOfWeek = dayDate.getDay();
    if (!isHourActiveForDay(dayOfWeek, hour)) return false;

    const slotDate = getSlotDate(dayDate, hour);
    return slotDate > new Date();
}

export const ALL_SCHEDULE_HOURS = [9, 18, 22];
