"use client";

import { useEffect, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";

function subscribe() {
  return () => {};
}

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const mounted = useSyncExternalStore(subscribe, () => true, () => false);
  const hydrated = useAuth((s) => s.hydrated);
  const hydrate = useAuth((s) => s.hydrate);
  const token = useAuth((s) => s.token);

  useEffect(() => {
    if (mounted) {
      hydrate();
    }
  }, [mounted, hydrate]);

  useEffect(() => {
    if (mounted && hydrated && !token) {
      router.replace("/connect");
    }
  }, [mounted, hydrated, token, router]);

  if (!mounted || !hydrated || !token) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>
    );
  }

  return <>{children}</>;
}
