import Navbar from "@/components/Navbar";
import ScheduleGrid from "@/components/ScheduleGrid";
import NotificationToggle from "@/components/NotificationToggle";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import styles from "../page.module.css";

export default async function MySchedulePage() {
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
                    <ScheduleGrid />
                </section>
            </div>
        </main>
    );
}
