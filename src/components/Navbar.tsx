"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { User } from "@supabase/supabase-js";
import Link from "next/link";
import styles from "./Navbar.module.css";
import { useRouter, usePathname } from "next/navigation";

export default function Navbar() {
    const [user, setUser] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);
    const supabase = createClient();
    const router = useRouter();
    const pathname = usePathname();

    useEffect(() => {
        const getUser = async () => {
            const { data: { user } } = await supabase.auth.getUser();
            setUser(user);
            setLoading(false);
        };

        getUser();

        const { data: { subscription } } = supabase.auth.onAuthStateChange(
            (_event, session) => {
                setUser(session?.user ?? null);
            }
        );

        return () => subscription.unsubscribe();
    }, [supabase.auth]);

    const handleSignOut = async () => {
        await supabase.auth.signOut();
        router.push("/");
        router.refresh();
    };

    return (
        <nav className={styles.nav}>
            <div className={styles.navMain}>
                <Link href="/" className={styles.logo}>
                    <span className={styles.logoIcon}>🗓️</span>
                    <span className={styles.logoText}>Scheduler</span>
                </Link>

                {user && (
                    <div className={styles.navLinks}>
                        <Link
                            href="/myschedule"
                            className={`${styles.navLink} ${pathname === "/myschedule" ? styles.activeNavLink : ""}`}
                        >
                            My Schedule
                        </Link>
                        <Link
                            href="/calendar"
                            className={`${styles.navLink} ${pathname === "/calendar" ? styles.activeNavLink : ""}`}
                        >
                            Calendar
                        </Link>
                        {user.email === 'isaac.bassas@gmail.com' && (
                            <Link
                                href="/groups"
                                className={`${styles.navLink} ${pathname === "/groups" ? styles.activeNavLink : ""}`}
                            >
                                Groups
                            </Link>
                        )}
                    </div>
                )}
            </div>

            <div className={styles.actions}>
                {!loading && (
                    user ? (
                        <div className={styles.userMenu}>
                            <span className={styles.userEmail}>
                                {user.user_metadata?.display_name || user.email?.split('@')[0]}
                            </span>
                            <button onClick={handleSignOut} className={styles.btnSignOut}>
                                Sign Out
                            </button>
                        </div>
                    ) : (
                        <Link href="/login" className="btn-primary">
                            Sign In
                        </Link>
                    )
                )}
            </div>
        </nav>
    );
}
