import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/resume-import";

export default function OverviewPage() {
  requireProfile();
  redirect("/jobs");
}
