import Link from "next/link";
import { PageHeader } from "@/components/UI";
import { savedNewsletterProfile } from "@/lib/newsletter-profile";
import { NewsletterWorkspace } from "@/components/NewsletterWorkspace";
import styles from "./newsletters.module.css";
import { latestResearchRun, savedResearchPolicy } from "@/lib/newsletter-research-store";

export const dynamic = "force-dynamic";

export default async function NewslettersPage() {
  const profile = await savedNewsletterProfile().catch(() => null);
  const [run, policy] = await Promise.all([latestResearchRun(), savedResearchPolicy()]);
  return (
    <div className={`page profile-page ${styles.page}`}>
      <PageHeader eyebrow="Experimental" title="Newsletter opportunities" description="Find companies where your product and design skills could be useful, even before a role is posted." />
      <div className={styles.profileNote}>
        <span>{profile ? `Matching against your search profile${profile.targetRoles.length ? `: ${profile.targetRoles.join(" / ")}` : "."}` : "Add your strengths and summary to your search profile before analyzing a newsletter."}</span>
        <Link className="text-link" href="/profile">{profile ? "Edit profile" : "Set up profile"}</Link>
      </div>
      <NewsletterWorkspace profileReady={Boolean(profile)} initialRun={run} initialPolicy={policy} />
    </div>
  );
}
