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
    rule_name: string;
    days_of_week: number[];
    hours: number[];
    start_date_idx: number;
    end_date_idx: number;
}

export default function ScheduleGrid() {
    const [user, setUser] = useState<User | null>(null);
    const [weekStart, setWeekStart] = useState<Date>(getMonday(new Date()));
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [recurrentRules, setRecurrentRules] = useState<RecurrentRule[]>([]);
    
    // New rule creation state
    const [newRecName, setNewRecName] = useState("");
    const [newRecDays, setNewRecDays] = useState<number[]>([]);
    const [newRecHours, setNewRecHours] = useState<number[]>([]);
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
            if (r.days_of_week.includes(d.dayOfWeek) && d.dbIndex >= r.start_date_idx && d.dbIndex <= r.end_date_idx) {
                r.hours.forEach(h => {
                    recurrentSet.add(`${d.dbIndex}-${h}`);
                });
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
            if (recurrentSet.has(key)) return false; // Don't save if recurrent handles it
            const [dbIndex, hour] = key.split("-").map(Number);
            const dayMeta = weekDays.find(d => d.dbIndex === dbIndex);
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

    const toggleDaySelection = (day: number) => {
        setNewRecDays(prev => prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]);
    };

    const toggleHourSelection = (hour: number) => {
        setNewRecHours(prev => prev.includes(hour) ? prev.filter(h => h !== hour) : [...prev, hour]);
    };

    const addRecurrentRule = async () => {
        if (!user) return;
        if (!newRecName.trim() || newRecDays.length === 0 || newRecHours.length === 0) {
            alert("Please provide a name, at least one day, and at least one time slot.");
            return;
        }

        let startIdx = 20240101;
        let endIdx = 20991231;
        if (newRecStart) startIdx = parseInt(newRecStart.replace(/-/g, ''));
        if (newRecEnd) endIdx = parseInt(newRecEnd.replace(/-/g, ''));
        
        if (endIdx < startIdx) {
            alert("End date cannot be before start date!");
            return;
        }

        const { error } = await supabase.from("recurrent_unavailability").insert({
            user_id: user.id,
            rule_name: newRecName.trim(),
            days_of_week: newRecDays,
            hours: newRecHours,
            start_date_idx: startIdx,
            end_date_idx: endIdx
        });

        if (error) {
            alert("An error occurred: " + error.message);
        } else {
            const { data } = await supabase.from("recurrent_unavailability").select("*").eq("user_id", user.id);
            if (data) setRecurrentRules(data);
            setNewRecName("");
            setNewRecDays([]);
            setNewRecHours([]);
            setNewRecStart("");
            setNewRecEnd("");
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
        if (recurrentSet.has(`${day.dbIndex}-${hour}`)) return;

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
        if (recurrentSet.has(`${day.dbIndex}-${hour}`)) return;

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

            if (dayMeta && isSlotValidAndFuture(dayMeta.date, hour) && !recurrentSet.has(`${dayIdx}-${hour}`)) {
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
                                        const isRecurrent = recurrentSet.has(key);
                                        const isSelected = selected.has(key);
                                        
                                        return (
                                            <div
                                                key={key}
                                                data-day={day.dbIndex}
                                                data-hour={hour}
                                                className={`${styles.cell} ${isSelected || isRecurrent ? styles.active : ""} ${!validAndFuture ? styles.disabled : ""} ${isRecurrent ? styles.recurrentCell : ""}`}
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
                    <p>{loading ? "Loading..." : `${selected.size + recurrentSet.size} busy slots marked`}</p>
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
                    <h3>Add Recurrent Block</h3>
                    <p className={styles.subtext}>Quickly block out periods you are never available (e.g. Work, Gym, Sleep).</p>
                </div>
                
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1.5rem', marginBottom: '2rem' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                        <label style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: 600 }}>1. Give it a name</label>
                        <input 
                            type="text" 
                            className={styles.selectField} 
                            placeholder="e.g. Work Schedule" 
                            value={newRecName} 
                            onChange={(e) => setNewRecName(e.target.value)} 
                            style={{ width: '100%' }}
                        />
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                        <label style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: 600 }}>2. Select Days</label>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                            {[1, 2, 3, 4, 5, 6, 0].map((dayIdx) => (
                                <button
                                    key={dayIdx}
                                    onClick={() => toggleDaySelection(dayIdx)}
                                    className={newRecDays.includes(dayIdx) ? styles.activeDayBtn : styles.dayBtn}
                                    title={DAYS_OF_WEEK[dayIdx]}
                                >
                                    {DAYS_OF_WEEK[dayIdx].substring(0, 3)}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                        <label style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: 600 }}>3. Select Slots</label>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                            {TIME_SLOTS.map(t => (
                                <button
                                    key={t.id}
                                    onClick={() => toggleHourSelection(t.id)}
                                    className={newRecHours.includes(t.id) ? styles.hourBtnActive : styles.hourBtn}
                                >
                                    {t.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                        <label style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: 600 }}>4. Duration (Optional)</label>
                        <div style={{ display: 'flex', gap: '8px' }}>
                            <input type="date" className={styles.selectField} value={newRecStart} onChange={(e) => setNewRecStart(e.target.value)} style={{ padding: '6px', minWidth: '0', flex: 1 }} />
                            <input type="date" className={styles.selectField} value={newRecEnd} onChange={(e) => setNewRecEnd(e.target.value)} style={{ padding: '6px', minWidth: '0', flex: 1 }} />
                        </div>
                    </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '1.5rem' }}>
                    <button className="btn-primary" style={{ padding: '10px 24px' }} onClick={addRecurrentRule}>
                        Add Recurrent Rule
                    </button>
                </div>

                <div style={{ marginTop: '2.5rem' }}>
                    <h4 style={{ fontSize: '0.9rem', marginBottom: '1rem', opacity: 0.8 }}>Existing Rules</h4>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        {recurrentRules.map(rule => {
                            const daysList = rule.days_of_week.map(d => DAYS_OF_WEEK[d].substring(0,3)).join(', ');
                            const hoursList = rule.hours.map(h => TIME_SLOTS.find(t => t.id === h)?.label).join(', ');
                            
                            let dateRange = "Forever";
                            if (rule.start_date_idx > 20240101 || rule.end_date_idx < 20991231) {
                                const sStr = String(rule.start_date_idx);
                                const eStr = String(rule.end_date_idx);
                                dateRange = `${sStr.substring(6,8)}/${sStr.substring(4,6)} - ${eStr.substring(6,8)}/${eStr.substring(4,6)}`;
                            }

                            return (
                                <div key={rule.id} className={styles.ruleItem}>
                                    <div className={styles.ruleMain}>
                                        <div className={styles.ruleHeaderInfo}>
                                            <span className={styles.ruleNameTag}>{rule.rule_name}</span>
                                            <span className={styles.ruleDateTag}>{dateRange}</span>
                                        </div>
                                        <div className={styles.ruleDetails}>
                                            <span className={styles.ruleDays}>{daysList}</span>
                                            <span className={styles.ruleSeparator}>•</span>
                                            <span className={styles.ruleHours}>{hoursList}</span>
                                        </div>
                                    </div>
                                    <button onClick={() => removeRecurrentRule(rule.id)} className={styles.ruleDeleteBtn}>×</button>
                                </div>
                            );
                        })}
                        {recurrentRules.length === 0 && <p className={styles.subtext}>No recurrent rules added yet.</p>}
                    </div>
                </div>
            </div>
        </div>
    );
}
