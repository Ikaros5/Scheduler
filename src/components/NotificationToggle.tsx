"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { urlBase64ToUint8Array } from "@/lib/notifications";
import styles from "./NotificationToggle.module.css";

export default function NotificationToggle() {
    const [isSubscribed, setIsSubscribed] = useState(false);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const supabase = createClient();

    useEffect(() => {
        if (typeof window !== "undefined" && "serviceWorker" in navigator) {
            checkSubscription();
        } else {
            setLoading(false);
        }
    }, []);

    async function checkSubscription() {
        try {
            const registration = await navigator.serviceWorker.getRegistration();
            if (registration) {
                const subscription = await registration.pushManager.getSubscription();
                setIsSubscribed(!!subscription);
            } else {
                setIsSubscribed(false);
            }
        } catch (err) {
            console.error(err);
            setIsSubscribed(false);
        } finally {
            setLoading(false);
        }
    }

    async function subscribe() {
        setLoading(true);
        setError(null);

        try {
            const registration = await navigator.serviceWorker.register("/sw.js");
            await navigator.serviceWorker.ready;

            const subscription = await registration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: urlBase64ToUint8Array(
                    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!
                ),
            });

            const { data: { user } } = await supabase.auth.getUser();
            if (!user) throw new Error("User not logged in");

            const { error: upsertError } = await supabase
                .from("push_subscriptions")
                .upsert({
                    user_id: user.id,
                    subscription: subscription.toJSON(),
                });

            if (upsertError) throw upsertError;

            setIsSubscribed(true);
        } catch (err: any) {
            console.error("Subscription error:", err);
            setError(err.message || "Failed to enable notifications");
        } finally {
            setLoading(false);
        }
    }

    async function unsubscribe() {
        setLoading(true);
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.getSubscription();

        if (subscription) {
            await subscription.unsubscribe();
            const { data: { user } } = await supabase.auth.getUser();
            if (user) {
                await supabase.from("push_subscriptions").delete().eq("user_id", user.id);
            }
        }

        setIsSubscribed(false);
        setLoading(false);
    }

    if (loading) return null;

    return (
        <div className={styles.container}>
            {isSubscribed ? (
                <div className={styles.active}>
                    <span>🔔 Notifications Enabled</span>
                    <button onClick={unsubscribe} className={styles.btnLink}>Disable</button>
                </div>
            ) : (
                <div className={styles.inactive}>
                    <p>Get notified when friends update their schedule!</p>
                    <button onClick={subscribe} className="btn-primary" style={{ padding: '8px 16px', fontSize: '14px' }}>
                        Enable Push Notifications
                    </button>
                </div>
            )}
            {error && <div className={styles.error}>{error}</div>}
        </div>
    );
}
