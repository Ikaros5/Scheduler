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
    reason?: string;
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
        schedule_filled_until?: number;
    };
}
interface MemberActivity {
    user_id: string;
    display_name: string;
    email: string;
    role: string;
    last_sign_in: string | null;
    last_availability_update: string | null;
    has_push_enabled: boolean;
    schedule_filled_until?: number;
}


export default function GroupCalendar() {
    const [weekStart, setWeekStart] = useState<Date>(getMonday(new Date()));
    const [viewMode, setViewMode] = useState<"weekly" | "monthly" | "yearly">("weekly");
    const [data, setData] = useState<AvailabilityData[]>([]);
    const [groups, setGroups] = useState<Group[]>([]);
    const [selectedGroup, setSelectedGroup] = useState<Group | null>(null);
    const [selectedGroupId, setSelectedGroupId] = useState<string>("");
    const [groupMembers, setGroupMembers] = useState<GroupMember[]>([]);
    const [sessions, setSessions] = useState<GroupSession[]>([]);
    const [userCount, setUserCount] = useState(0);
    const [loading, setLoading] = useState(false);
    const [cache, setCache] = useState<Record<string, { data: AvailabilityData[], sessions: GroupSession[] }>>({});
    const [isAdmin, setIsAdmin] = useState(false);
    const [memberActivity, setMemberActivity] = useState<MemberActivity[]>([]);
    const [remindingUserId, setRemindingUserId] = useState<string | null>(null);
    const dateInputRef = useRef<HTMLInputElement>(null);
    const supabase = createClient();

    const weekDays = getWeekDays(weekStart);

    const year = weekStart.getFullYear();
    const currentMonth = weekStart.getMonth();
    
    const monthDays = Array.from({ length: new Date(year, currentMonth + 1, 0).getDate() }, (_, i) => {
        const d = new Date(year, currentMonth, i + 1);
        return {
            date: d,
            dayNum: d.getDate(),
            weekday: d.toLocaleDateString('en-US', { weekday: 'short' }),
            dayOfWeek: d.getDay(),
            dbIndex: parseInt(`${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`)
        };
    });

    const yearMonths = Array.from({ length: 12 }, (_, i) => {
        return {
            month: i,
            name: new Date(year, i, 1).toLocaleString('default', { month: 'short' }),
            startIdx: parseInt(`${year}${String(i + 1).padStart(2, '0')}01`),
            endIdx: parseInt(`${year}${String(i + 1).padStart(2, '0')}${String(new Date(year, i + 1, 0).getDate()).padStart(2, '0')}`)
        };
    });

    useEffect(() => {
        async function fetchGroups() {
            setLoading(true);

            const { data: { user } } = await supabase.auth.getUser();
            if (!user) {
                setLoading(false);
                return;
            }

            setIsAdmin(user.email === 'admin@dnd.com');

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

    let startRange = weekDays[0].dbIndex;
    let endRange = weekDays[6].dbIndex;
    if (viewMode === 'monthly') {
        startRange = monthDays[0].dbIndex;
        endRange = monthDays[monthDays.length - 1].dbIndex;
    } else if (viewMode === 'yearly') {
        startRange = yearMonths[0].startIdx;
        endRange = yearMonths[11].endIdx;
    }

    const cacheKey = `${selectedGroupId}-${viewMode}-${startRange}-${endRange}`;

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
                    .select("user_id, role, group_id, profiles(display_name, email, schedule_filled_until)")
                    .in("group_id", targetGroupIds);

                const currentGroupMembers = (memberData || []) as any[];
                const uniqueMembersMap = new Map();
                currentGroupMembers.forEach(m => {
                    // Filter out the admin from scheduling logic
                    if (m.profiles?.email === 'admin@dnd.com') return;

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

            const { data: memberData } = await supabase
                .from("group_members")
                .select("user_id, role, group_id, profiles(display_name, email, schedule_filled_until)")
                .in("group_id", targetGroupIds);

            const currentGroupMembers = (memberData || []) as any[];
            const uniqueMembersMap = new Map();
            currentGroupMembers.forEach(m => {
                // Filter out the admin from scheduling logic
                if (m.profiles?.email === 'admin@dnd.com') return;

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
                .select("user_id, day_index, hour, reason")
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

            const recurrentPromise = memberIds.length > 0
                ? supabase.from("recurrent_unavailability").select("user_id, rule_name, days_of_week, hours, start_date_idx, end_date_idx").in("user_id", memberIds)
                : Promise.resolve({ data: [] });

            const [availResult, sessionResult, allMembershipsRes, recurrentRes] = await Promise.all([
                query,
                supabase
                    .from("group_sessions")
                    .select("*")
                    .in("group_id", targetGroupIds)
                    .gte("day_index", startRange)
                    .lte("day_index", endRange),
                membershipsPromise,
                recurrentPromise
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

            if (recurrentRes.data) {
                recurrentRes.data.forEach((rRule: any) => {
                    const allDaysToCheck: any[] = [];
                    if (viewMode === 'weekly') {
                        allDaysToCheck.push(...weekDays);
                    } else if (viewMode === 'monthly') {
                        allDaysToCheck.push(...monthDays);
                    } else {
                        for (let m = 0; m < 12; m++) {
                            const daysInMonth = new Date(year, m + 1, 0).getDate();
                            for (let d = 1; d <= daysInMonth; d++) {
                                const date = new Date(year, m, d);
                                allDaysToCheck.push({
                                    dayOfWeek: date.getDay(),
                                    dbIndex: parseInt(`${year}${String(m + 1).padStart(2, '0')}${String(d).padStart(2, '0')}`)
                                });
                            }
                        }
                    }

                    allDaysToCheck.forEach(day => {
                        if (rRule.days_of_week.includes(day.dayOfWeek) && 
                            day.dbIndex >= rRule.start_date_idx && 
                            day.dbIndex <= rRule.end_date_idx) {
                            
                            rRule.hours.forEach((h: number) => {
                                extraBusyData.push({
                                    user_id: rRule.user_id,
                                    day_index: day.dbIndex,
                                    hour: h,
                                    reason: rRule.rule_name
                                });
                            });
                        }
                    });
                });
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
        if (viewMode === 'weekly') {
            next.setDate(weekStart.getDate() + (direction * 7));
        } else if (viewMode === 'monthly') {
            next.setMonth(weekStart.getMonth() + direction);
        } else if (viewMode === 'yearly') {
            next.setFullYear(weekStart.getFullYear() + direction);
        }
        setWeekStart(getMonday(next));
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

        return `Unavailable:\n${unavailableMembers.map(m => {
            const reasonData = busyInSlot.find(d => d.user_id === m.user_id && d.reason);
            const reasonStr = reasonData?.reason ? `: ${reasonData.reason}` : '';
            return `- ${m.profiles?.display_name || 'Anonymous'}${m.role === 'dm' ? ' (DM)' : ''}${reasonStr}`;
        }).join('\n')}`;
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
        const busyInSlot = data.filter(d => d.day_index === dbIndex && d.hour === hour);
        const busyUserIds = new Set(busyInSlot.map(d => d.user_id));
        const busyCount = busyUserIds.size;
        return userCount - busyCount;
    };

    const getBestDayColorClass = (dbIndex: number) => {
        const sessionsInDay = sessions.filter(s => s.day_index === dbIndex);
        if (sessionsInDay.length > 0) return styles.sessionCell;

        let hasGreen = false;
        let hasYellow = false;

        const dateStr = dbIndex.toString();
        const dObj = new Date(parseInt(dateStr.substring(0,4)), parseInt(dateStr.substring(4,6))-1, parseInt(dateStr.substring(6,8)));
        const validHoursForDay = ALL_SCHEDULE_HOURS.filter(h => isHourActiveForDay(dObj.getDay(), h));
        
        if (validHoursForDay.length === 0) return styles.disabled;

        for (const hour of validHoursForDay) {
            const cls = getHeatmapClass(dbIndex, hour);
            if (cls === styles.heatGreen) hasGreen = true;
            if (cls === styles.heatYellow) hasYellow = true;
        }

        if (hasGreen) return styles.heatGreen;
        if (hasYellow) return styles.heatYellow;
        return styles.heatRed;
    };

    // Build member activity table whenever groupMembers changes
    useEffect(() => {
        if (groupMembers.length === 0 || !selectedGroupId) {
            setMemberActivity([]);
            return;
        }

        async function fetchActivity() {
            let activityData: MemberActivity[] = [];

            if (selectedGroupId === 'all') {
                // Combine activity for all groups
                const groupIds = groups.map(g => g.id);
                for (const gid of groupIds) {
                    const { data: rows } = await supabase.rpc('get_group_members_activity', { target_group_id: gid });
                    (rows || []).forEach((r: any) => {
                        const existing = activityData.find(a => a.user_id === r.user_id);
                        if (!existing) {
                            activityData.push(r as MemberActivity);
                        } else if (r.role === 'dm') {
                            existing.role = 'dm';
                        }
                    });
                }
            } else {
                const { data: rows } = await supabase.rpc('get_group_members_activity', { target_group_id: selectedGroupId });
                activityData = (rows || []) as MemberActivity[];
            }

            // Global filter: Remove admin from activity table
            activityData = activityData.filter(m => m.email !== 'admin@dnd.com');

            // Sort: oldest/never updated first
            activityData.sort((a, b) => {
                const aTime = a.last_availability_update ? new Date(a.last_availability_update).getTime() : 0;
                const bTime = b.last_availability_update ? new Date(b.last_availability_update).getTime() : 0;
                return aTime - bTime;
            });

            setMemberActivity(activityData);
        }
        fetchActivity();
    }, [groupMembers, selectedGroupId, groups]);

    async function remindUser(userId: string) {
        setRemindingUserId(userId);
        try {
            const res = await fetch('/api/notify-user', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId }),
            });
            const result = await res.json();
            if (!res.ok) throw new Error(result.error || 'Failed');
            alert('Reminder sent! ✅');
        } catch (err: any) {
            alert(`Could not send reminder: ${err.message}`);
        } finally {
            setRemindingUserId(null);
        }
    }

    function formatLastUpdated(iso: string | null): string {
        if (!iso) return 'Never';
        
        // Force comparison in Europe/Madrid timezone
        const d = new Date(iso);
        const options: Intl.DateTimeFormatOptions = { 
            timeZone: 'Europe/Madrid',
            year: 'numeric',
            month: 'short',
            day: '2-digit'
        };
        
        const nowInSpain = new Intl.DateTimeFormat('en-GB', { ...options, hour: 'numeric' }).format(new Date());
        const dInSpain = new Intl.DateTimeFormat('en-GB', options).format(d);
        
        const today = new Intl.DateTimeFormat('en-GB', options).format(new Date());
        const yesterdayDate = new Date();
        yesterdayDate.setDate(yesterdayDate.getDate() - 1);
        const yesterday = new Intl.DateTimeFormat('en-GB', options).format(yesterdayDate);

        if (dInSpain === today) return 'Today';
        if (dInSpain === yesterday) return 'Yesterday';

        const diffMs = new Date().getTime() - d.getTime();
        const diffDays = Math.floor(diffMs / 86400000);
        if (diffDays < 7 && diffDays > 0) return `${diffDays} days ago`;

        return dInSpain;
    }

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
                    <div className={styles.viewToggle} style={{ marginRight: '1rem' }}>
                        <button className={`${styles.toggleBtn} ${viewMode === 'weekly' ? styles.active : ''}`} onClick={() => setViewMode('weekly')}>Weekly</button>
                        <button className={`${styles.toggleBtn} ${viewMode === 'monthly' ? styles.active : ''}`} onClick={() => setViewMode('monthly')}>Monthly</button>
                        <button className={`${styles.toggleBtn} ${viewMode === 'yearly' ? styles.active : ''}`} onClick={() => setViewMode('yearly')}>Yearly</button>
                    </div>
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

            {viewMode === 'weekly' && (
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
            )}

            {viewMode === 'monthly' && (
                <div className={styles.monthlyGrid}>
                    {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => <div key={d} className={styles.monthlyDayHeader}>{d}</div>)}
                    {Array.from({ length: monthDays[0].date.getDay() }).map((_, i) => <div key={`empty-${i}`} className={styles.monthlyEmpty}></div>)}
                    {monthDays.map(day => (
                        <div key={day.dbIndex} className={`${styles.monthlyCell} ${getBestDayColorClass(day.dbIndex)}`} title={day.date.toDateString()}>
                            {day.dayNum}
                        </div>
                    ))}
                </div>
            )}

            {viewMode === 'yearly' && (
                <div className={styles.yearlyGrid}>
                    {yearMonths.map(month => {
                        const mDays = Array.from({ length: new Date(year, month.month + 1, 0).getDate() }, (_, i) => {
                            const d = new Date(year, month.month, i + 1);
                            return {
                                dayOfWeek: d.getDay(),
                                dayNum: d.getDate(),
                                dbIndex: parseInt(`${year}${String(month.month + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`)
                            };
                        });
                        return (
                            <div key={month.month} className={styles.yearlyMonthBlock}>
                                <h4 className={styles.yearlyMonthName}>{month.name}</h4>
                                <div className={styles.yearlyMiniGrid}>
                                    {Array.from({ length: new Date(year, month.month, 1).getDay() }).map((_, i) => <div key={`empty-${i}`} className={styles.monthlyEmpty}></div>)}
                                    {mDays.map(day => (
                                        <div key={day.dbIndex} className={`${styles.yearlyCell} ${getBestDayColorClass(day.dbIndex)}`} title={`${month.name} ${day.dayNum}`} />
                                    ))}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

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

            {memberActivity.length > 0 && (
                <div className={styles.activitySection}>
                    <h4 className={styles.activityTitle}>Member Activity (Spain Time)</h4>
                    <div className={styles.tableResponsive}>
                        <table className={styles.activityTable}>
                            <thead>
                                <tr>
                                    <th>Member</th>
                                    <th>Role</th>
                                    <th>Last Active</th>
                                    <th>Last Updated</th>
                                    <th>Filled Until</th>
                                    {isAdmin && (
                                        <>
                                            <th>Push Enabled</th>
                                            <th>Actions</th>
                                        </>
                                    )}
                                </tr>
                            </thead>
                            <tbody>
                                {memberActivity.map(m => {
                                    const isStale = !m.last_availability_update || (new Date().getTime() - new Date(m.last_availability_update).getTime()) > 7 * 86400000;
                                    return (
                                        <tr key={m.user_id} className={isStale ? styles.staleRow : ''}>
                                            <td>
                                                <div className={styles.memberCell}>
                                                    <div className={styles.memberAvatar}>
                                                        {(m.display_name || m.email).substring(0, 2).toUpperCase()}
                                                    </div>
                                                    <div>
                                                        <span className={styles.memberName}>{m.display_name}</span>
                                                        <span className={styles.memberEmail}>{m.email}</span>
                                                    </div>
                                                </div>
                                            </td>
                                            <td>
                                                <span className={m.role === 'dm' ? styles.dmBadge : styles.memberBadge}>
                                                    {m.role === 'dm' ? 'DM' : 'Player'}
                                                </span>
                                            </td>
                                            <td>
                                                <span className={styles.loginDot}>
                                                    {formatLastUpdated(m.last_sign_in)}
                                                </span>
                                            </td>
                                            <td>
                                                <span className={isStale ? styles.staleDot : styles.freshDot}>
                                                    {formatLastUpdated(m.last_availability_update)}
                                                </span>
                                            </td>
                                            <td>
                                                <span className={styles.freshDot}>
                                                    {m.schedule_filled_until ? (() => {
                                                        const s = m.schedule_filled_until.toString();
                                                        return s.length === 8 ? `${s.substring(6,8)}/${s.substring(4,6)}/${s.substring(0,4)}` : 'Unknown';
                                                    })() : 'Not Set'}
                                                </span>
                                            </td>
                                            {isAdmin && (
                                                <>
                                                    <td>
                                                        <span style={{ 
                                                            color: m.has_push_enabled ? '#34d399' : '#94a3b8',
                                                            fontSize: '0.75rem',
                                                            fontWeight: 600,
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            gap: '4px'
                                                        }}>
                                                            <span style={{ 
                                                                display: 'inline-block', 
                                                                width: '6px', 
                                                                height: '6px', 
                                                                borderRadius: '50%',
                                                                backgroundColor: m.has_push_enabled ? '#34d399' : '#94a3b8'
                                                            }} />
                                                            {m.has_push_enabled ? 'Active' : 'Missing'}
                                                        </span>
                                                    </td>
                                                    <td>
                                                        <button
                                                            className={styles.remindBtn}
                                                            onClick={() => remindUser(m.user_id)}
                                                            disabled={remindingUserId === m.user_id}
                                                        >
                                                            {remindingUserId === m.user_id ? 'Sending...' : '🔔 Remind'}
                                                        </button>
                                                    </td>
                                                </>
                                            )}
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    );
}
