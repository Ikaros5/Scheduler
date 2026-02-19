"use client";

import { useEffect, useState, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import styles from "./GroupCalendar.module.css";
import { isHourActiveForDay, ALL_SCHEDULE_HOURS, TIME_SLOTS } from "@/lib/schedule-logic";

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

interface AvailabilityData {
    user_id: string;
    day_index: number;
    hour: number;
}

interface Group {
    id: string;
    name: string;
    missing_count: number;
}

interface GroupSession {
    id: string;
    group_id: string;
    day_index: number;
    hour: number;
}

interface GroupMember {
    user_id: string;
    role: string;
    profiles?: {
        display_name: string;
        email: string;
    };
}

export default function GroupCalendar() {
    const [weekStart, setWeekStart] = useState<Date>(getMonday(new Date()));
    const [data, setData] = useState<AvailabilityData[]>([]);
    const [groups, setGroups] = useState<Group[]>([]);
    const [selectedGroup, setSelectedGroup] = useState<Group | null>(null);
    const [selectedGroupId, setSelectedGroupId] = useState<string>("");
    const [groupMembers, setGroupMembers] = useState<GroupMember[]>([]);
    const [sessions, setSessions] = useState<GroupSession[]>([]);
    const [userCount, setUserCount] = useState(0);
    const [loading, setLoading] = useState(false);
    const [cache, setCache] = useState<Record<string, { data: AvailabilityData[], sessions: GroupSession[] }>>({});
    const dateInputRef = useRef<HTMLInputElement>(null);
    const supabase = createClient();

    const weekDays = getWeekDays(weekStart);

    useEffect(() => {
        async function fetchGroups() {
            setLoading(true);

            const { data: { user } } = await supabase.auth.getUser();
            if (!user) {
                setLoading(false);
                return;
            }

            // Fetch groups where the user is a member
            const { data: memberData } = await supabase
                .from("group_members")
                .select("group_id, groups(*)")
                .eq("user_id", user.id);

            if (memberData && memberData.length > 0) {
                const userGroups = memberData
                    .map(m => m.groups as unknown as Group)
                    .filter(g => g !== null)
                    .sort((a, b) => a.name.localeCompare(b.name));

                setGroups(userGroups);
                if (userGroups.length > 0) {
                    setSelectedGroupId("all");
                }
            } else {
                setGroups([]);
            }
            setLoading(false);
        }
        fetchGroups();
    }, [supabase]);

    const currentWeekIdx = weekDays[0].dbIndex;
    const cacheKey = `${selectedGroupId}-${currentWeekIdx}`;

    useEffect(() => {
        async function fetchData() {
            if (!selectedGroupId) {
                setLoading(false);
                return;
            }

            let targetGroupIds: string[] = [];
            if (selectedGroupId === "all") {
                targetGroupIds = groups.map(g => g.id);
            } else {
                targetGroupIds = [selectedGroupId];
            }

            if (targetGroupIds.length === 0) {
                setLoading(false);
                return;
            }

            // 1. Check cache for instant load
            if (cache[cacheKey]) {
                const cached = cache[cacheKey];
                setData(cached.data);
                setSessions(cached.sessions);

                // Still need groupMembers for tooltip/logic
                const { data: memberData } = await supabase
                    .from("group_members")
                    .select("user_id, role, group_id, profiles(display_name, email)")
                    .in("group_id", targetGroupIds);

                const currentGroupMembers = (memberData || []) as any[];
                const uniqueMembersMap = new Map();
                currentGroupMembers.forEach(m => {
                    if (!uniqueMembersMap.has(m.user_id)) {
                        uniqueMembersMap.set(m.user_id, { ...m });
                    } else if (m.role === 'dm') {
                        uniqueMembersMap.get(m.user_id).role = 'dm';
                    }
                });
                const uniqueMembers = Array.from(uniqueMembersMap.values());

                setGroupMembers(uniqueMembers);
                setUserCount(uniqueMembers.length);
                const groupInfo = selectedGroupId === "all" ? null : groups.find(g => g.id === selectedGroupId);
                setSelectedGroup(groupInfo || null);
                return;
            }

            // 2. Clear immediately to avoid ghosting
            setData([]);
            setSessions([]);
            setLoading(true);

            const startRange = weekDays[0].dbIndex;
            const endRange = weekDays[6].dbIndex;

            const { data: memberData } = await supabase
                .from("group_members")
                .select("user_id, role, group_id, profiles(display_name, email)")
                .in("group_id", targetGroupIds);

            const currentGroupMembers = (memberData || []) as any[];
            const uniqueMembersMap = new Map();
            currentGroupMembers.forEach(m => {
                if (!uniqueMembersMap.has(m.user_id)) {
                    uniqueMembersMap.set(m.user_id, { ...m });
                } else if (m.role === 'dm') {
                    uniqueMembersMap.get(m.user_id).role = 'dm';
                }
            });
            const uniqueMembers = Array.from(uniqueMembersMap.values());
            const memberIds = uniqueMembers.map(m => m.user_id);
            setGroupMembers(uniqueMembers);

            const groupInfo = selectedGroupId === "all" ? null : groups.find(g => g.id === selectedGroupId);
            setSelectedGroup(groupInfo || null);

            let query = supabase
                .from("availability")
                .select("user_id, day_index, hour")
                .gte("day_index", startRange)
                .lte("day_index", endRange);

            if (memberIds.length > 0) {
                query = query.in("user_id", memberIds);
                setUserCount(memberIds.length);
            } else {
                query = query.eq("user_id", "00000000-0000-0000-0000-000000000000");
                setUserCount(0);
            }

            const membershipsPromise = memberIds.length > 0
                ? supabase.from("group_members").select("user_id, group_id").in("user_id", memberIds)
                : Promise.resolve({ data: [] });

            const [availResult, sessionResult, allMembershipsRes] = await Promise.all([
                query,
                supabase
                    .from("group_sessions")
                    .select("*")
                    .in("group_id", targetGroupIds)
                    .gte("day_index", startRange)
                    .lte("day_index", endRange),
                membershipsPromise
            ]);

            let extraBusyData: AvailabilityData[] = [];
            if (allMembershipsRes.data && allMembershipsRes.data.length > 0) {
                const allGroupIds = Array.from(new Set(allMembershipsRes.data.map((m: any) => m.group_id)));
                if (allGroupIds.length > 0) {
                    const { data: allSessionsRes } = await supabase
                        .from("group_sessions")
                        .select("group_id, day_index, hour")
                        .in("group_id", allGroupIds)
                        .gte("day_index", startRange)
                        .lte("day_index", endRange);

                    if (allSessionsRes) {
                        allSessionsRes.forEach((session: any) => {
                            const usersInSessionGroup = allMembershipsRes.data!
                                .filter((m: any) => m.group_id === session.group_id)
                                .map((m: any) => m.user_id);

                            usersInSessionGroup.forEach((uid: string) => {
                                if (memberIds.includes(uid)) {
                                    extraBusyData.push({
                                        user_id: uid,
                                        day_index: session.day_index,
                                        hour: session.hour
                                    });
                                }
                            });
                        });
                    }
                }
            }

            const finalAvail = [...(availResult.data || []), ...extraBusyData];
            const finalSessions = sessionResult.data || [];

            setData(finalAvail);
            setSessions(finalSessions);

            // Save to cache
            setCache(prev => ({
                ...prev,
                [cacheKey]: { data: finalAvail, sessions: finalSessions }
            }));

            setLoading(false);
        }

        fetchData();
    }, [supabase, weekStart, selectedGroupId, groups, cacheKey]);

    const navigateWeek = (direction: number) => {
        const next = new Date(weekStart);
        next.setDate(weekStart.getDate() + (direction * 7));
        setWeekStart(next);
    };

    const handleDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const date = new Date(e.target.value);
        if (!isNaN(date.getTime())) {
            setWeekStart(getMonday(date));
        }
    };

    const getTooltip = (dbIndex: number, hour: number) => {
        if (!selectedGroupId) return "";
        const busyInSlot = data.filter(d => d.day_index === dbIndex && d.hour === hour);
        const busyUserIds = new Set(busyInSlot.map(d => d.user_id));

        const unavailableMembers = groupMembers.filter(m => busyUserIds.has(m.user_id));

        if (unavailableMembers.length === 0) return "Everyone is available! ✨";

        return `Unavailable:\n${unavailableMembers.map(m => `- ${m.profiles?.display_name || 'Anonymous'}${m.role === 'dm' ? ' (DM)' : ''}`).join('\n')}`;
    };

    const getHeatmapClass = (dbIndex: number, hour: number) => {
        if (userCount === 0 || !selectedGroupId) return "";

        const busyInSlot = data.filter(d => d.day_index === dbIndex && d.hour === hour);
        const busyUserIds = new Set(busyInSlot.map(d => d.user_id));
        const busyCount = busyUserIds.size;
        const availableCount = userCount - busyCount;

        const allowedMissing = selectedGroup?.missing_count || 0;

        const dms = groupMembers.filter(m => m.role === 'dm');
        const missingDms = dms.filter(dm => busyUserIds.has(dm.user_id));
        const allDmsUnavailable = dms.length > 0 && missingDms.length === dms.length;

        const missingPlayersCount = busyCount - missingDms.length;

        if (availableCount === userCount) return styles.heatGreen;
        if (allDmsUnavailable || missingPlayersCount > allowedMissing) return styles.heatRed;
        if (missingPlayersCount <= allowedMissing) return styles.heatYellow;

        return "";
    };

    const getMatchesCount = (dbIndex: number, hour: number) => {
        const busyCount = data.filter(d => d.day_index === dbIndex && d.hour === hour).length;
        return userCount - busyCount;
    };

    // Remove the blocking loading screen to make navigation instant.
    // The calendar will update in the background.
    if (!selectedGroupId && loading) return <div className={styles.loading}>Preparing group schedule...</div>;

    const monthName = weekStart.toLocaleString('default', { month: 'long' });
    const year = weekStart.getFullYear();

    return (
        <div className={`glass-card ${styles.wrapper}`}>
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

                <div className={styles.groupSelector}>
                    <select
                        value={selectedGroupId}
                        onChange={(e) => setSelectedGroupId(e.target.value)}
                        className={styles.selectInput}
                    >
                        {groups.length > 0 && <option value="all">All Groups</option>}
                        {groups.map(group => (
                            <option key={group.id} value={group.id}>{group.name}</option>
                        ))}
                        {groups.length === 0 && <option value="">No groups found</option>}
                    </select>
                </div>

                <p className={styles.subtext}>
                    {selectedGroupId === "all"
                        ? "Showing combined overlap for all your groups."
                        : selectedGroupId
                            ? `Showing overlap for ${groups.find(g => g.id === selectedGroupId)?.name}.`
                            : "Create a group to see overlap data."}
                </p>
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
                    {ALL_SCHEDULE_HOURS.map(hour => {
                        const slotMeta = TIME_SLOTS.find(s => s.id === hour);
                        return (
                            <div key={hour} className={styles.row}>
                                <div className={styles.timeLabel}>
                                    <span className={styles.slotName}>{slotMeta?.label}</span>
                                    <span className={styles.slotTime}>{slotMeta?.subtext}</span>
                                </div>
                                {weekDays.map((day) => {
                                    const active = isHourActiveForDay(day.dayOfWeek, hour);
                                    const count = getMatchesCount(day.dbIndex, hour);
                                    const sessionsInSlot = sessions.filter(s => s.day_index === day.dbIndex && s.hour === hour);
                                    const isSession = sessionsInSlot.length > 0;

                                    return (
                                        <div
                                            key={`${day.dbIndex}-${hour}`}
                                            className={`${styles.cell} ${active ? getHeatmapClass(day.dbIndex, hour) : styles.disabled} ${isSession ? styles.sessionCell : ""}`}
                                            title={isSession ? "Planned Session" : (active ? getTooltip(day.dbIndex, hour) : "Unavailable")}
                                        >
                                            {isSession && (
                                                <span
                                                    className={styles.sessionLabel}
                                                    style={{ textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%', padding: '0 2px' }}
                                                >
                                                    {sessionsInSlot.map(s => groups.find(g => g.id === s.group_id)?.name || "Session").join(', ')}
                                                </span>
                                            )}
                                            {active && !isSession && <span className={styles.countBadge}>{count}</span>}
                                        </div>
                                    );
                                })}
                            </div>
                        );
                    })}
                </div>
            </div>

            <div className={styles.legend}>
                <div className={styles.legendItem}>
                    <div className={`${styles.legendBox} ${styles.heatGreen}`}></div>
                    <span>Ideal (Full)</span>
                </div>
                <div className={styles.legendItem}>
                    <div className={`${styles.legendBox} ${styles.heatYellow}`}></div>
                    <span>Acceptable (Within {selectedGroup?.missing_count || 0})</span>
                </div>
                <div className={styles.legendItem}>
                    <div className={`${styles.legendBox} ${styles.heatRed}`}></div>
                    <span>Poor (Absent DMs or {'>'} {selectedGroup?.missing_count || 0})</span>
                </div>
                <div className={styles.legendItem}>
                    <div className={`${styles.legendBox} ${styles.sessionCell}`} style={{ border: 'none', background: 'var(--primary)', boxShadow: '0 0 10px var(--primary-glow)' }}></div>
                    <span>Appointed Session</span>
                </div>
            </div>
        </div>
    );
}
