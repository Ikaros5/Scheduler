"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import styles from "./GroupsManager.module.css";
import { TIME_SLOTS } from "@/lib/schedule-logic";
import { User } from "@supabase/supabase-js";

interface Profile {
    id: string;
    email: string;
    display_name: string;
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
    group_id: string;
    user_id: string;
    role: string;
    profiles: Profile;
}

export default function GroupsManager() {
    const [profiles, setProfiles] = useState<Profile[]>([]);
    const [groups, setGroups] = useState<Group[]>([]);
    const [members, setMembers] = useState<GroupMember[]>([]);
    const [sessions, setSessions] = useState<GroupSession[]>([]);
    const [loading, setLoading] = useState(true);
    const [newGroupName, setNewGroupName] = useState("");
    const [user, setUser] = useState<User | null>(null);
    const supabase = createClient();

    useEffect(() => {
        async function init() {
            const { data: { user } } = await supabase.auth.getUser();
            setUser(user);
            fetchData();
        }
        init();
    }, []);

    async function fetchData() {
        setLoading(true);
        const [pRes, gRes, mRes, sRes] = await Promise.all([
            supabase.from("profiles").select("*"),
            supabase.from("groups").select("*").order("name"),
            supabase.from("group_members").select("*, profiles(*)"),
            supabase.from("group_sessions").select("*")
        ]);

        if (pRes.data) setProfiles(pRes.data);
        if (gRes.data) setGroups(gRes.data);
        if (mRes.data) setMembers(mRes.data as any);
        if (sRes.data) setSessions(sRes.data);
        setLoading(false);
    }

    async function createGroup() {
        if (!newGroupName.trim()) return;
        const { error } = await supabase.from("groups").insert({ name: newGroupName });
        if (error) {
            alert(error.message);
        } else {
            setNewGroupName("");
            fetchData();
        }
    }

    async function deleteGroup(id: string) {
        if (!confirm("Are you sure? This will delete the group and remove all members.")) return;
        await supabase.from("groups").delete().eq("id", id);
        fetchData();
    }

    async function updateMissingCount(id: string, count: number) {
        const { error } = await supabase
            .from("groups")
            .update({ missing_count: count })
            .eq("id", id);

        if (error) {
            alert(error.message);
        } else {
            setGroups(groups.map(g => g.id === id ? { ...g, missing_count: count } : g));
        }
    }

    async function addSession(groupId: string, dayIndex: number, hour: number) {
        const { error } = await supabase
            .from("group_sessions")
            .insert({ group_id: groupId, day_index: dayIndex, hour: hour });

        if (error) {
            alert(error.message);
        } else {
            fetchData();
        }
    }

    async function deleteSession(id: string) {
        const { error } = await supabase
            .from("group_sessions")
            .delete()
            .eq("id", id);

        if (error) {
            alert(error.message);
        } else {
            fetchData();
        }
    }

    async function addMember(groupId: string, userId: string) {
        if (!userId) return;
        const { error } = await supabase.from("group_members").insert({ group_id: groupId, user_id: userId, role: 'member' });
        if (error) {
            alert(error.message);
        } else {
            fetchData();
        }
    }

    async function removeMember(groupId: string, userId: string) {
        await supabase.from("group_members").delete().eq("group_id", groupId).eq("user_id", userId);
        fetchData();
    }

    async function toggleRole(groupId: string, userId: string, currentRole: string) {
        const newRole = currentRole === 'dm' ? 'member' : 'dm';
        const { error } = await supabase
            .from("group_members")
            .update({ role: newRole })
            .eq("group_id", groupId)
            .eq("user_id", userId);

        if (error) {
            alert(error.message);
        } else {
            fetchData();
        }
    }

    async function notifyGroup(groupId: string) {
        try {
            const res = await fetch("/api/notify-group", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ groupId })
            });

            if (!res.ok) throw new Error("Failed to send notification.");

            const data = await res.json();
            alert(`Sent ${data.sentCount || 0} notifications to active group members!`);
        } catch (err: any) {
            alert(err.message || "Something went wrong.");
        }
    }

    const getInitials = (name: string, email: string) => {
        if (name) return name.substring(0, 2).toUpperCase();
        return email.substring(0, 2).toUpperCase();
    };

    if (loading) return <div className={styles.loading}>Loading groups...</div>;

    return (
        <div className={styles.wrapper}>
            <div className={styles.header}>
                <h2>Group Management</h2>
                <p className={styles.subtext}>Create and organize your inner circles.</p>
            </div>

            <div className={styles.topActions}>
                <input
                    type="text"
                    placeholder="E.g. Squad, Family, Design Team..."
                    className={styles.inputField}
                    value={newGroupName}
                    onChange={(e) => setNewGroupName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && createGroup()}
                />
                <button className="btn-primary" onClick={createGroup}>Create Group</button>
            </div>

            <div className={styles.groupsGrid}>
                {groups.map(group => {
                    const groupMembers = members
                        .filter(m => m.group_id === group.id)
                        .sort((a, b) => {
                            // 1. Sort by role: 'dm' first
                            if (a.role === 'dm' && b.role !== 'dm') return -1;
                            if (a.role !== 'dm' && b.role === 'dm') return 1;

                            // 2. Sort alphabetically by name
                            const nameA = (a.profiles.display_name || a.profiles.email).toLowerCase();
                            const nameB = (b.profiles.display_name || b.profiles.email).toLowerCase();
                            return nameA.localeCompare(nameB);
                        });
                    return (
                        <div key={group.id} className={`glass-card ${styles.groupCard}`}>
                            <div className={styles.groupHeader}>
                                <div className={styles.groupTitleArea}>
                                    <div className={styles.groupMainLine}>
                                        <h3>{group.name}</h3>
                                        <div className={styles.missingControl}>
                                            <label className={styles.missingLabel}>Missing:</label>
                                            <input
                                                type="number"
                                                className={styles.missingInput}
                                                value={group.missing_count}
                                                onChange={(e) => updateMissingCount(group.id, parseInt(e.target.value) || 0)}
                                                min="0"
                                            />
                                        </div>
                                    </div>
                                    <span className={styles.memberCount}>{groupMembers.length} Members</span>
                                </div>
                                <div className={styles.groupHeaderActions}>
                                    <button className={styles.notifyBtn} onClick={() => notifyGroup(group.id)}>Notify</button>
                                    <button className={styles.deleteBtn} onClick={() => deleteGroup(group.id)}>Delete</button>
                                </div>
                            </div>

                            <div className={styles.memberList}>
                                {groupMembers.map(member => (
                                    <div key={member.user_id} className={styles.memberItem}>
                                        <div className={styles.memberInfo}>
                                            <div className={styles.avatar}>
                                                {getInitials(member.profiles.display_name, member.profiles.email)}
                                            </div>
                                            <div className={styles.memberName}>
                                                <span className={styles.nameText}>{member.profiles.display_name || 'Anonymous'}</span>
                                                <span className={styles.emailText}>{member.profiles.email}</span>
                                                {member.role === 'dm' && <span className={styles.dmBadge}>DM</span>}
                                            </div>
                                        </div>
                                        <div style={{ display: 'flex', alignItems: 'center' }}>
                                            <button
                                                className={`${styles.roleToggle} ${member.role === 'dm' ? styles.roleToggleActive : ''}`}
                                                onClick={() => toggleRole(group.id, member.user_id, member.role)}
                                                title={member.role === 'dm' ? "Demote to Member" : "Promote to DM"}
                                            >
                                                {member.role === 'dm' ? '★ DM' : '☆ DM'}
                                            </button>
                                            <button
                                                className={styles.removeBtn}
                                                onClick={() => removeMember(group.id, member.user_id)}
                                                title="Remove from group"
                                            >
                                                ✕
                                            </button>
                                        </div>
                                    </div>
                                ))}

                                {groupMembers.length === 0 && (
                                    <p className={styles.subtext} style={{ fontSize: '0.85rem', textAlign: 'center', padding: '1rem' }}>
                                        No members added yet.
                                    </p>
                                )}
                            </div>


                            <div className={styles.addMemberArea}>
                                <select
                                    className={styles.memberSelect}
                                    onChange={(e) => addMember(group.id, e.target.value)}
                                    value=""
                                >
                                    <option value="" disabled>+ Add a friend to {group.name}</option>
                                    {profiles
                                        .filter(p => !members.some(m => m.group_id === group.id && m.user_id === p.id))
                                        .map(p => (
                                            <option key={p.id} value={p.id}>
                                                {p.display_name || p.email}
                                            </option>
                                        ))}
                                </select>
                            </div>

                            {groupMembers.some(m => m.user_id === user?.id && m.role === 'dm') && (
                                <div className={styles.sessionArea}>
                                    <h4 className={styles.sectionTitle}>Session Planning</h4>

                                    <div className={styles.sessionsList}>
                                        {sessions.filter(s => s.group_id === group.id).map(session => {
                                            const year = Math.floor(session.day_index / 10000);
                                            const month = Math.floor((session.day_index % 10000) / 100);
                                            const dayNum = session.day_index % 100;
                                            const slot = TIME_SLOTS.find(ts => ts.id === session.hour);

                                            return (
                                                <div key={session.id} className={styles.sessionItem}>
                                                    <div className={styles.sessionInfo}>
                                                        <span className={styles.sessionDate}>{dayNum}/{month}/{year}</span>
                                                        <span className={styles.sessionSlot}>{slot?.label}</span>
                                                    </div>
                                                    <button
                                                        className={styles.deleteSessionSmall}
                                                        onClick={() => deleteSession(session.id)}
                                                    >
                                                        ✕
                                                    </button>
                                                </div>
                                            );
                                        })}
                                    </div>

                                    <div className={styles.sessionInputs}>
                                        <div className={styles.inputGroup}>
                                            <input
                                                type="date"
                                                className={styles.sessionDateInput}
                                                onChange={(e) => {
                                                    const date = new Date(e.target.value);
                                                    if (!isNaN(date.getTime())) {
                                                        const idx = parseInt(`${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`);
                                                        (group as any)._pendingDay = idx;
                                                    } else {
                                                        (group as any)._pendingDay = null;
                                                    }
                                                }}
                                            />
                                        </div>
                                        <div className={styles.inputGroup}>
                                            <select
                                                className={styles.sessionSelect}
                                                onChange={(e) => (group as any)._pendingHour = parseInt(e.target.value) || null}
                                            >
                                                <option value="">-- Block --</option>
                                                {TIME_SLOTS.map(slot => (
                                                    <option key={slot.id} value={slot.id}>{slot.label}</option>
                                                ))}
                                            </select>
                                        </div>
                                        <button
                                            className={styles.saveSessionBtn}
                                            onClick={() => {
                                                const day = (group as any)._pendingDay;
                                                const hour = (group as any)._pendingHour;
                                                if (day && hour) {
                                                    addSession(group.id, day, hour);
                                                } else {
                                                    alert("Please select both a date and a block.");
                                                }
                                            }}
                                        >
                                            + Add Session
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
