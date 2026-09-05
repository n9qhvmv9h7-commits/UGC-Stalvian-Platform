import { redirect } from "next/navigation";

/* Access is invite-only — there is no public landing. Authenticated creators
   land on the dashboard; everyone else is bounced to /login by the app. */
export default function Home() {
  redirect("/dashboard");
}
