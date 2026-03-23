import Navbar from "@/components/Navbar";
import GroupCalendar from "@/components/GroupCalendar";
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
                    <GroupCalendar />
                </section>
            </div>
        </main>
    );
}
