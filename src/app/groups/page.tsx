import Navbar from "@/components/Navbar";
import GroupsManager from "@/components/GroupsManager";
import NotificationToggle from "@/components/NotificationToggle";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import styles from "../page.module.css";

export default async function GroupsPage() {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
        redirect("/login");
    }

    // Security: Only allow exact admin email
    if (user.email !== 'isaac.bassas@gmail.com') {
        redirect("/myschedule");
    }

    return (
        <main className={styles.main}>
            <div className="container">
                <Navbar />
                <section className={styles.dashboard}>
                    <div className={styles.dashboardHeader}>
                        <NotificationToggle />
                    </div>
                    <GroupsManager />
                </section>
            </div>
        </main>
    );
}
