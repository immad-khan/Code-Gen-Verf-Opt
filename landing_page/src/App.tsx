import { useEffect, useState } from "react";
import { clearSession, getSession, type AuthVia, type SessionUser } from "./auth";
import { Header } from "./components/Header";
import { Hero } from "./components/Hero";
import { Techniques } from "./components/Techniques";
import { Workflow } from "./components/Workflow";
import { Pipeline } from "./components/Pipeline";
import { Results } from "./components/Results";
import { CTA, Footer } from "./components/Footer";
import { AuthPage } from "./components/AuthPage";

type Route = "landing" | "auth" | "verified";
type Verified = { fresh: boolean; via?: AuthVia };

function routeFromHash(): Route {
  const h = window.location.hash;
  if (h.startsWith("#auth")) return "auth";
  if (h.startsWith("#verified")) return "verified";
  return "landing";
}

export default function App() {
  const [session, setSession] = useState<SessionUser | null>(() => getSession());
  const [justVerified, setJustVerified] = useState<Verified | null>(null);
  const [route, setRoute] = useState<Route>(routeFromHash);

  useEffect(() => {
    const onHash = () => setRoute(routeFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // keep the URL in step with the signed-in state
  useEffect(() => {
    if (route === "verified" && !session) window.location.replace("#auth");
    if (route === "auth" && session) window.location.replace("#verified");
  }, [route, session]);

  // landing anchors land below the sticky header; other routes start at the top
  useEffect(() => {
    if (route === "landing") {
      const id = window.location.hash.slice(1);
      if (id && id !== "top") {
        requestAnimationFrame(() => {
          document.getElementById(id)?.scrollIntoView({ behavior: "auto", block: "start" });
        });
      } else {
        window.scrollTo(0, 0);
      }
    } else {
      window.scrollTo(0, 0);
    }
  }, [route]);

  const handleAuthed = (user: SessionUser, fresh: boolean, via?: AuthVia) => {
    setSession(user);
    setJustVerified({ fresh, via });
    setRoute("verified");
    window.location.hash = "#verified";
  };

  const handleSignOut = () => {
    clearSession();
    setSession(null);
    setJustVerified(null);
    setRoute("landing");
    window.location.hash = "#top";
    window.scrollTo(0, 0);
  };

  // one stable AuthPage for both routes, so the brand panel never remounts mid-flow
  if (route === "auth" || route === "verified") {
    return <AuthPage session={session} justVerified={justVerified} onAuthed={handleAuthed} onSignOut={handleSignOut} />;
  }

  return (
    <div className="min-h-screen bg-white">
      <Header user={session} />
      <main>
        <Hero />
        <Techniques />
        <Workflow />
        <Pipeline />
        <Results />
        <CTA />
      </main>
      <Footer />
    </div>
  );
}
