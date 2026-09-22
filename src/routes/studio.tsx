import { Link, createFileRoute } from "@tanstack/react-router";

import FacetStudio from "@/FacetStudio";
import "@/landing.css";

// The Studio is built and working; it is gated while Facet is in preview.
// Flip this to true to open it to everyone.
const STUDIO_ENABLED = true;

/** @knipignore */
export const Route = createFileRoute("/studio")({
  component: StudioRoute,
});

function StudioRoute() {
  if (STUDIO_ENABLED) return <FacetStudio />;

  return (
    <div className="facet-landing">
      <section className="fl-gate">
        <span className="fl-eyebrow">Facet Studio</span>
        <div className="fl-gate-mark">🔶</div>
        <h1 className="fl-title">
          Under <span className="accent">construction</span>
        </h1>
        <p className="fl-sub">
          The Studio is being finished. Code-first modeling, live parameters,
          and STL export are on the way.
        </p>
        <Link to="/" className="fl-btn fl-btn-primary">
          Back to home
        </Link>
      </section>
    </div>
  );
}
