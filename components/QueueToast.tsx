"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { toast } from "sonner";

/** Fires a queued-application toast when redirected here with ?queued=1, then strips it from the URL. */
export function QueueToast() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (searchParams.get("queued") !== "1") return;
    const company = searchParams.get("company") || "";
    const title = searchParams.get("title") || "This role";
    toast.success("Added to the resume queue", {
      id: `queued-${title}-${company}`,
      description: company ? `${title} at ${company}` : title,
    });
    const next = new URLSearchParams(searchParams);
    next.delete("queued");
    next.delete("company");
    next.delete("title");
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
