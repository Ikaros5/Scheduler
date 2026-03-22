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
const DAYS_OF_WEEK = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

interface RecurrentRule {
    id: string;
    day_of_week: number;
    hour: number;
    start_date_idx: number;
    end_date_idx: number;
}

export default function ScheduleGrid() {
    const [user, setUser] = useState<User | null>(null);
    const [weekStart, setWeekStart] = useState<Date>(getMonday(new Date()));
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [recurrentRules, setRecurrentRules] = useState<RecurrentRule[]>([]);
    const [newRecDay, setNewRecDay] = useState(0);
    const [newRecHour, setNewRecHour] = useState(18);
    const [newRecStart, setNewRecStart] = useState("");
    const [newRecEnd, setNewRecEnd] = useState("");
    const [isDragging, setIsDragging] = useState(false);
    const [dragMode, setDragMode] = useState<"add" | "remove">("add");
    const [saving, setSaving] = useState(false);
    const [loading, setLoading] = useState(true);
    const [hasChanged, setHasChanged] = useState(false);
    const [cache, setCache] = useState<Record<number, Set<string>>>({});
    const dateInputRef = useRef<HTMLInputElement>(null);
    const supabase = createClient();

    const weekDays = getWeekDays(weekStart);
    const currentWeekIdx = weekDays[0].dbIndex;

    const recurrentSet = new Set<string>();
    recurrentRules.forEach(r => {
        weekDays.forEach(d => {
            if (d.dayOfWeek === r.day_of_week && d.dbIndex >= r.start_date_idx && d.dbIndex <= r.end_date_idx) {
                recurrentSet.add(`${d.dayOfWeek}-${r.hour}`);
            }
        });
    });

    useEffect(() => {
        async function getInitialUser() {
            const { data: { user } } = await supabase.auth.getUser();
            setUser(user);
        }
        getInitialUser();
    }, [supabase]);

    useEffect(() => {
        async function loadAvailability() {
            if (!user) return;

            // Load recurrent rules independently
            const { data: recData } = await supabase
                .from("recurrent_unavailability")
                .select("*")
                .eq("user_id", user.id);
            if (recData) {
                setRecurrentRules(recData);
            }

            if (cache[currentWeekIdx]) {
                setSelected(cache[currentWeekIdx]);
                setHasChanged(false);
                setLoading(false);
                return;
            }

            setSelected(new Set());
            setLoading(true);

            const startRange = weekDays[0].dbIndex;
            const endRange = weekDays[6].dbIndex;

            const { data } = await supabase
                .from("availability")
                .select("day_index, hour")
                .eq("user_id", user.id)
                .gte("day_index", startRange)
                .lte("day_index", endRange);

            if (data) {
                const loaded = new Set(data.map(d => `${d.day_index}-${d.hour}`));
                setSelected(loaded);
                setCache(prev => ({ ...prev, [currentWeekIdx]: loaded }));
            }
            setHasChanged(false);
            setLoading(false);
        }
        loadAvailability();
    }, [supabase, weekStart, user, currentWeekIdx]);

    const handleSave = async () => {
        if (!user || !hasChanged) return;
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
            
            // Do not save manual inserts if they are already covered by recurrent rule to save space
            if (dayMeta && recurrentSet.has(`${dayMeta.dayOfWeek}-${hour}`)) return false;

            return dayMeta ? isSlotValidAndFuture(dayMeta.date, hour) : false;
        }).map(key => {
            const [day_index, hour] = key.split("-").map(Number);
            return { user_id: user.id, day_index, hour };
        });

        if (inserts.length > 0) {
            await supabase.from("availability").insert(inserts);
        }

        setCache(prev => ({ ...prev, [currentWeekIdx]: new Set(selected) }));
        setHasChanged(false);
        setSaving(false);
    };

    const addRecurrentRule = async () => {
        if (!user) return;

        let startIdx = 20240101;
        let endIdx = 20991231;
        if (newRecStart) {
            startIdx = parseInt(newRecStart.replace(/-/g, ''));
        }
        if (newRecEnd) {
            endIdx = parseInt(newRecEnd.replace(/-/g, ''));
        }
        if (endIdx < startIdx) {
            alert("End date cannot be before start date!");
            return;
        }

        const { error } = await supabase.from("recurrent_unavailability").insert({
            user_id: user.id,
            day_of_week: newRecDay,
            hour: newRecHour,
            start_date_idx: startIdx,
            end_date_idx: endIdx
        });

        if (error) {
            alert("This rule already exists or an error occurred.");
        } else {
            const { data } = await supabase.from("recurrent_unavailability").select("*").eq("user_id", user.id);
            if (data) setRecurrentRules(data);
        }
    };

    const removeRecurrentRule = async (id: string) => {
        await supabase.from("recurrent_unavailability").delete().eq("id", id);
        setRecurrentRules(prev => prev.filter(r => r.id !== id));
    };

    const navigateWeek = async (direction: number) => {
        await handleSave();
        const next = new Date(weekStart);
        next.setDate(weekStart.getDate() + (direction * 7));
        setWeekStart(next);
    };

    const handleDateChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const date = new Date(e.target.value);
        if (!isNaN(date.getTime())) {
            await handleSave();
            setWeekStart(getMonday(date));
        }
    };

    const isTouchInteraction = useRef(false);

    const toggleCell = (day: typeof weekDays[0], hour: number) => {
        if (!isSlotValidAndFuture(day.date, hour)) return;
        if (recurrentSet.has(`${day.dayOfWeek}-${hour}`)) return; // Blocked by recurrent

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

    const handleMouseDown = (day: typeof weekDays[0], hour: number) => {
        if (isTouchInteraction.current) return;
        toggleCell(day, hour);
    };

    const handleMouseEnter = (day: typeof weekDays[0], hour: number) => {
        if (!isDragging || !isSlotValidAndFuture(day.date, hour)) return;
        if (isTouchInteraction.current) return;
        if (recurrentSet.has(`${day.dayOfWeek}-${hour}`)) return;

        const key = `${day.dbIndex}-${hour}`;
        const newSelected = new Set(selected);
        if (dragMode === "add") newSelected.add(key);
        else newSelected.delete(key);
        setSelected(newSelected);
        setHasChanged(true);
    };

    const handleTouchStart = (e: React.TouchEvent, day: typeof weekDays[0], hour: number) => {
        isTouchInteraction.current = true;
        setTimeout(() => { isTouchInteraction.current = false; }, 500);
        toggleCell(day, hour);
    };

    const handleTouchMove = (e: React.TouchEvent) => {
        if (!isDragging) return;
        if (e.cancelable) e.preventDefault();

        const touch = e.touches[0];
        const element = document.elementFromPoint(touch.clientX, touch.clientY) as HTMLElement;

        if (element?.dataset?.day && element?.dataset?.hour) {
            const dayIdx = parseInt(element.dataset.day);
            const hour = parseInt(element.dataset.hour);
            const dayMeta = weekDays.find(d => d.dbIndex === dayIdx);

            if (dayMeta && isSlotValidAndFuture(dayMeta.date, hour) && !recurrentSet.has(`${dayMeta.dayOfWeek}-${hour}`)) {
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

    if (!user && loading) return <div className={styles.loading}>Preparing your schedule...</div>;

    const monthName = weekStart.toLocaleString('default', { month: 'long' });
    const year = weekStart.getFullYear();

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
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
                                        const isRecurrent = recurrentSet.has(`${day.dayOfWeek}-${hour}`);
                                        const isSelected = selected.has(key) || isRecurrent;
                                        
                                        return (
                                            <div
                                                key={key}
                                                data-day={day.dbIndex}
                                                data-hour={hour}
                                                className={`${styles.cell} ${isSelected ? styles.active : ""} ${!validAndFuture ? styles.disabled : ""} ${isRecurrent ? styles.recurrentCell : ""}`}
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
                    <p>{loading ? "Loading..." : `${selected.size + recurrentRules.length * 4} busy slots marked`}</p>
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

            <div className={`glass-card ${styles.wrapper}`}>
                <div className={styles.monthHeader} style={{ marginBottom: '1rem', borderBottom: 'none' }}>
                    <h3>Recurrent Unavailability</h3>
                    <p className={styles.subtext}>Select a general time you can NEVER meet (e.g. Sunday Afternoons). This will permanently block it out in red.</p>
                </div>
                <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: '1.5rem' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                        <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Day of the Week</label>
                        <select className={styles.selectField} value={newRecDay} onChange={(e) => setNewRecDay(Number(e.target.value))}>
                            {DAYS_OF_WEEK.map((day, i) => (
                                <option key={i} value={i}>{day}</option>
                            ))}
                        </select>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                        <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Time Slot</label>
                        <select className={styles.selectField} value={newRecHour} onChange={(e) => setNewRecHour(Number(e.target.value))}>
                            {TIME_SLOTS.map(t => (
                                <option key={t.id} value={t.id}>{t.label} ({t.subtext})</option>
                            ))}
                        </select>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                        <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Start (Optional)</label>
                        <input type="date" className={styles.selectField} value={newRecStart} onChange={(e) => setNewRecStart(e.target.value)} style={{ minWidth: 'auto'}} />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                        <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>End (Optional)</label>
                        <input type="date" className={styles.selectField} value={newRecEnd} onChange={(e) => setNewRecEnd(e.target.value)} style={{ minWidth: 'auto'}} />
                    </div>
                    <button className="btn-primary" style={{ padding: '8px 16px', height: 'fit-content' }} onClick={addRecurrentRule}>
                        Add Block
                    </button>
                </div>

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                    {recurrentRules.map(rule => {
                        const dayName = DAYS_OF_WEEK[rule.day_of_week];
                        const timeName = TIME_SLOTS.find(t => t.id === rule.hour)?.label || 'Unknown';
                        
                        let dateRange = "";
                        if (rule.start_date_idx > 20240101 || rule.end_date_idx < 20991231) {
                            const sStr = String(rule.start_date_idx);
                            const eStr = String(rule.end_date_idx);
                            const startFmt = `${sStr.substring(6,8)}/${sStr.substring(4,6)}`;
                            const endFmt = `${eStr.substring(6,8)}/${eStr.substring(4,6)}`;
                            dateRange = ` (${startFmt} - ${endFmt})`;
                        }

                        return (
                            <span key={rule.id} style={{
                                background: 'rgba(239, 68, 68, 0.1)',
                                border: '1px solid rgba(239, 68, 68, 0.3)',
                                color: '#f87171',
                                padding: '6px 14px',
                                borderRadius: '16px',
                                fontSize: '0.85rem',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px',
                                transition: 'all 0.2s'
                            }}>
                                <span style={{ fontWeight: 600 }}>{dayName} {timeName}</span>
                                <span style={{ opacity: 0.7, fontSize: '0.75rem' }}>{dateRange}</span>
                                <button
                                    onClick={() => removeRecurrentRule(rule.id)}
                                    title="Remove Rule"
                                    style={{
                                        background: 'rgba(239, 68, 68, 0.2)', border: 'none', color: '#f87171', 
                                        cursor: 'pointer', fontSize: '1.2rem', lineHeight: 1,
                                        width: '20px', height: '20px', borderRadius: '50%',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center'
                                    }}
                                >×</button>
                            </span>
                        );
                    })}
                    {recurrentRules.length === 0 && <p className={styles.subtext}>No recurrent rules added yet.</p>}
                </div>
            </div>
        </div>
    );
}
