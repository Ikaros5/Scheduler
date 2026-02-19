"use client";

import { useEffect, useState, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { User } from "@supabase/supabase-js";
import styles from "./ScheduleGrid.module.css";

import { isSlotValidAndFuture, ALL_SCHEDULE_HOURS, TIME_SLOTS } from "@/lib/schedule-logic";

const getMonday = (d: Date) => {
    const date = new Date(d);
    date.setHours(0, 0, 0, 0);
    const day = date.getDay();
    const diff = date.getDate() - day + (day === 0 ? -6 : 1);
    return new Date(date.setDate(diff));
};

const getWeekDays = (startDate: Date) => {
    return Array.from({ length: 7 }, (_, i) => {
        const d = new Date(startDate);
        d.setDate(startDate.getDate() + i);
        return {
            date: d,
            dayNum: d.getDate(),
            weekday: d.toLocaleDateString('en-US', { weekday: 'short' }),
            dayOfWeek: d.getDay(),
            dbIndex: parseInt(`${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`)
        };
    });
};

const HOURS = ALL_SCHEDULE_HOURS;

export default function ScheduleGrid() {
    const [user, setUser] = useState<User | null>(null);
    const [weekStart, setWeekStart] = useState<Date>(getMonday(new Date()));
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [isDragging, setIsDragging] = useState(false);
    const [dragMode, setDragMode] = useState<"add" | "remove">("add");
    const [saving, setSaving] = useState(false);
    const [loading, setLoading] = useState(true);
    const [hasChanged, setHasChanged] = useState(false);
    const [cache, setCache] = useState<Record<number, Set<string>>>({});
    const dateInputRef = useRef<HTMLInputElement>(null);
    const supabase = createClient();

    const weekDays = getWeekDays(weekStart);

    useEffect(() => {
        async function getInitialUser() {
            const { data: { user } } = await supabase.auth.getUser();
            setUser(user);
        }
        getInitialUser();
    }, [supabase]);

    const currentWeekIdx = weekDays[0].dbIndex;

    useEffect(() => {
        async function loadAvailability() {
            if (!user) return;

            // 1. If we have it in cache, show it INSTANTLY
            if (cache[currentWeekIdx]) {
                setSelected(cache[currentWeekIdx]);
                setHasChanged(false);
                return;
            }

            // 2. If not, clear immediately so user doesn't see old week's data
            setSelected(new Set());
            setLoading(true);

            const startRange = weekDays[0].dbIndex;
            const endRange = weekDays[6].dbIndex;

            const { data, error } = await supabase
                .from("availability")
                .select("day_index, hour")
                .eq("user_id", user.id)
                .gte("day_index", startRange)
                .lte("day_index", endRange);

            if (!error && data) {
                const loaded = new Set(data.map(d => `${d.day_index}-${d.hour}`));
                setSelected(loaded);
                // Save to cache
                setCache(prev => ({ ...prev, [currentWeekIdx]: loaded }));
            }
            setHasChanged(false); // Reset dirty flag on new load
            setLoading(false);
        }
        loadAvailability();
    }, [supabase, weekStart, user, currentWeekIdx]);

    const handleSave = async () => {
        if (!user || !hasChanged) return; // Only save if something actually changed
        setSaving(true);

        const startRange = weekDays[0].dbIndex;
        const endRange = weekDays[6].dbIndex;

        await supabase.from("availability")
            .delete()
            .eq("user_id", user.id)
            .gte("day_index", startRange)
            .lte("day_index", endRange);

        const inserts = Array.from(selected).filter(key => {
            const [dbIndex, hour] = key.split("-").map(Number);
            const dayMeta = weekDays.find(d => d.dbIndex === dbIndex);
            return dayMeta ? isSlotValidAndFuture(dayMeta.date, hour) : false;
        }).map(key => {
            const [day_index, hour] = key.split("-").map(Number);
            return { user_id: user.id, day_index, hour };
        });

        if (inserts.length > 0) {
            const { error } = await supabase.from("availability").insert(inserts);
            if (error) alert("Error saving: " + error.message);
        }

        // Update cache with current selections after save
        setCache(prev => ({ ...prev, [currentWeekIdx]: new Set(selected) }));
        setHasChanged(false);
        setSaving(false);
    };

    const navigateWeek = async (direction: number) => {
        await handleSave(); // Auto-save current state before moving
        const next = new Date(weekStart);
        next.setDate(weekStart.getDate() + (direction * 7));
        setWeekStart(next);
    };

    const handleDateChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const date = new Date(e.target.value);
        if (!isNaN(date.getTime())) {
            await handleSave(); // Auto-save current state before jumping
            setWeekStart(getMonday(date));
        }
    };

    const handleMouseDown = (day: typeof weekDays[0], hour: number) => {
        if (!isSlotValidAndFuture(day.date, hour)) return;
        const key = `${day.dbIndex}-${hour}`;
        const mode = selected.has(key) ? "remove" : "add";
        setDragMode(mode);
        setIsDragging(true);

        const newSelected = new Set(selected);
        if (mode === "add") newSelected.add(key);
        else newSelected.delete(key);
        setSelected(newSelected);
        setHasChanged(true);
    };

    const handleMouseEnter = (day: typeof weekDays[0], hour: number) => {
        if (!isDragging || !isSlotValidAndFuture(day.date, hour)) return;
        const key = `${day.dbIndex}-${hour}`;
        const newSelected = new Set(selected);
        if (dragMode === "add") newSelected.add(key);
        else newSelected.delete(key);
        setSelected(newSelected);
        setHasChanged(true);
    };

    const handleTouchStart = (e: React.TouchEvent, day: typeof weekDays[0], hour: number) => {
        if (!isSlotValidAndFuture(day.date, hour)) return;
        // Don't preventDefault here to allow tap vs scroll detection if needed, 
        // but we'll manage the drag state.
        const key = `${day.dbIndex}-${hour}`;
        const mode = selected.has(key) ? "remove" : "add";
        setDragMode(mode);
        setIsDragging(true);

        const newSelected = new Set(selected);
        if (mode === "add") newSelected.add(key);
        else newSelected.delete(key);
        setSelected(newSelected);
        setHasChanged(true);
    };

    const handleTouchMove = (e: React.TouchEvent) => {
        if (!isDragging) return;

        // Prevent scrolling while "painting"
        if (e.cancelable) e.preventDefault();

        const touch = e.touches[0];
        const element = document.elementFromPoint(touch.clientX, touch.clientY) as HTMLElement;

        if (element?.dataset?.day && element?.dataset?.hour) {
            const dayIdx = parseInt(element.dataset.day);
            const hour = parseInt(element.dataset.hour);
            const dayMeta = weekDays.find(d => d.dbIndex === dayIdx);

            if (dayMeta && isSlotValidAndFuture(dayMeta.date, hour)) {
                const key = `${dayIdx}-${hour}`;
                const newSelected = new Set(selected);
                if (dragMode === "add") newSelected.add(key);
                else newSelected.delete(key);
                setSelected(newSelected);
                setHasChanged(true);
            }
        }
    };

    const handleMouseUp = () => {
        setIsDragging(false);
    };

    // We remove the blocking loading screen to make the transition feel instant.
    // The grid will render immediately, and slots will appear as they load.
    if (!user && loading) return <div className={styles.loading}>Preparing your schedule...</div>;

    const monthName = weekStart.toLocaleString('default', { month: 'long' });
    const year = weekStart.getFullYear();

    return (
        <div
            className={`glass-card ${styles.wrapper}`}
            onMouseLeave={handleMouseUp}
            onMouseUp={handleMouseUp}
            onTouchEnd={handleMouseUp}
            onTouchMove={handleTouchMove}
        >
            <div className={styles.monthHeader}>
                <div className={styles.navGroup}>
                    <button onClick={() => navigateWeek(-1)} className={styles.navBtn}>←</button>
                    <div className={styles.titleWrapper} onClick={() => dateInputRef.current?.showPicker()}>
                        <h3>{monthName} {year}</h3>
                        <input
                            ref={dateInputRef}
                            type="date"
                            className={styles.hiddenInput}
                            onChange={handleDateChange}
                        />
                    </div>
                    <button onClick={() => navigateWeek(1)} className={styles.navBtn}>→</button>
                </div>
                <p className={styles.subtext}>Painted slots are times you are NOT available.</p>
            </div>

            <div className={styles.gridBodyWrapper}>
                <div className={styles.header}>
                    <div className={styles.timeLabel}></div>
                    {weekDays.map(day => (
                        <div key={day.dbIndex} className={styles.dayLabel}>
                            <span className={styles.weekday}>{day.weekday}</span>
                            <span className={styles.dateNum}>{day.dayNum}</span>
                        </div>
                    ))}
                </div>

                <div className={styles.gridBody}>
                    {HOURS.map(hour => {
                        const slotMeta = TIME_SLOTS.find(s => s.id === hour);
                        return (
                            <div key={hour} className={styles.row}>
                                <div className={styles.timeLabel}>
                                    <span className={styles.slotName}>{slotMeta?.label}</span>
                                    <span className={styles.slotTime}>{slotMeta?.subtext}</span>
                                </div>
                                {weekDays.map((day) => {
                                    const validAndFuture = isSlotValidAndFuture(day.date, hour);
                                    const key = `${day.dbIndex}-${hour}`;
                                    const isSelected = selected.has(key);
                                    return (
                                        <div
                                            key={key}
                                            data-day={day.dbIndex}
                                            data-hour={hour}
                                            className={`${styles.cell} ${isSelected ? styles.active : ""} ${!validAndFuture ? styles.disabled : ""}`}
                                            onMouseDown={() => handleMouseDown(day, hour)}
                                            onMouseEnter={() => handleMouseEnter(day, hour)}
                                            onTouchStart={(e) => handleTouchStart(e, day, hour)}
                                        />
                                    );
                                })}
                            </div>
                        );
                    })}
                </div>
            </div>

            <div className={styles.footer}>
                <p>{loading ? "Loading..." : `${selected.size} busy slots marked this week`}</p>
                <div className={styles.buttonWrapper}>
                    <button
                        className="btn-primary"
                        style={{ padding: '8px 16px', fontSize: '14px' }}
                        disabled={!user || saving || loading}
                        onClick={handleSave}
                    >
                        {user ? (saving ? "Saving..." : "Save") : "Sign in to Save"}
                    </button>
                </div>
            </div>
        </div>
    );
}


