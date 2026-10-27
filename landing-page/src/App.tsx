import { Header } from "./components/Header";
import { Hero } from "./components/Hero";
import { Techniques } from "./components/Techniques";
import { Workflow } from "./components/Workflow";
import { Pipeline } from "./components/Pipeline";
import { Results } from "./components/Results";
import { CTA, Footer } from "./components/Footer";

export default function App() {
  return (
    <div className="min-h-screen bg-white">
      <Header />
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
