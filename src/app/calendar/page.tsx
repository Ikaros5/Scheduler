import Navbar from "@/components/Navbar";
import GroupCalendar from "@/components/GroupCalendar";
import NotificationToggle from "@/components/NotificationToggle";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import styles from "../page.module.css";

export default async function CalendarPage() {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
        redirect("/login");
    }

    return (
        <main className={styles.main}>
            <div className="container">
                <Navbar />
                <section className={styles.dashboard}>
                    <div className={styles.dashboardHeader}>
                        <NotificationToggle />
                    </div>
                    <GroupCalendar />
                </section>
            </div>
        </main>
    );
}
