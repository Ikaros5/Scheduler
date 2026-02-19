import Navbar from "@/components/Navbar";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import styles from "./page.module.css";

export default function Home() {
  return <HomeContent />;
}

async function HomeContent() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (user) {
    redirect("/myschedule");
  }

  return (
    <main className={styles.main}>
      <div className="container">
        <Navbar />

        <section className={styles.hero}>
          <div className={styles.heroContent}>
            <h1 className="animate-float">Sync your week <br /> with friends.</h1>
            <p>
              No more endless group chats. Visualize everyone&apos;s availability in a
              beautiful, interactive grid and find the perfect time to connect.
            </p>
            <div className={styles.ctaGroup}>
              <button className="btn-primary">
                Get Started Free
                <span>→</span>
              </button>
              <button className={styles.btnSecondary}>
                How it works
              </button>
            </div>
          </div>

          <div className={styles.visualSide}>
            <div className={`glass-card ${styles.previewCard}`}>
              <div className={styles.previewHeader}>
                <div className={styles.dotRed}></div>
                <div className={styles.dotYellow}></div>
                <div className={styles.dotGreen}></div>
              </div>
              <div className={styles.previewContent}>
                <div className={styles.previewGrid}>
                  {[...Array(24)].map((_, i) => (
                    <div
                      key={i}
                      className={`${styles.gridCell} ${i === 7 || i === 8 || i === 15 || i === 22 ? styles.activeCell : ''}`}
                    ></div>
                  ))}
                </div>
              </div>
            </div>
            <div className={styles.glowEffect}></div>
          </div>
        </section>

        <section className={styles.features}>
          <div className={`glass-card ${styles.featureCard}`}>
            <h3>Multi-Platform</h3>
            <p>Install as a PWA on your iPhone, Android, or PC for a native experience.</p>
          </div>
          <div className={`glass-card ${styles.featureCard}`}>
            <h3>Real-time Sync</h3>
            <p>See friends updating their availability live as they paint the grid.</p>
          </div>
          <div className={`glass-card ${styles.featureCard}`}>
            <h3>Smart Heatmaps</h3>
            <p>Automatically highlights the best slots with the most overlapping friends.</p>
          </div>
        </section>
      </div>
    </main>
  );
}
