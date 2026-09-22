import { Link, createFileRoute } from "@tanstack/react-router";

import "@/landing.css";

/** @knipignore */
export const Route = createFileRoute("/")({
  component: Landing,
});

const FEATURES = [
  {
    title: "A real language",
    body: "Model in TypeScript, not a toy DSL. Functions, modules, types, npm - the whole toolbox.",
    icon: (
      <path
        d="M8 6 3 12l5 6M16 6l5 6-5 6"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    ),
  },
  {
    title: "Two geometry kernels",
    body: "A mesh CSG kernel in TypeScript and a Rust kernel compiled to WebAssembly - swap them live.",
    icon: (
      <>
        <rect
          x="3"
          y="3"
          width="12"
          height="12"
          rx="1.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        />
        <rect
          x="9"
          y="9"
          width="12"
          height="12"
          rx="1.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        />
      </>
    ),
  },
  {
    title: "Live parameters",
    body: "Declare typed parameters and get sliders that reshape the model in real time.",
    icon: (
      <>
        <path
          d="M4 8h16M4 16h16"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <circle cx="9" cy="8" r="2.4" fill="currentColor" />
        <circle cx="15" cy="16" r="2.4" fill="currentColor" />
      </>
    ),
  },
  {
    title: "Print-ready export",
    body: "Export watertight STL straight from the browser, ready for the slicer and the printer.",
    icon: (
      <>
        <path
          d="M12 3v11M8 10l4 4 4-4"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M4 20h16"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </>
    ),
  },
  {
    title: "Runs anywhere",
    body: "It's the web, so it's everywhere - plus native desktop and mobile builds via Tauri.",
    icon: (
      <>
        <rect
          x="3"
          y="4"
          width="18"
          height="12"
          rx="1.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        />
        <path
          d="M8 20h8"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </>
    ),
  },
  {
    title: "Open source",
    body: "Part of the Omni ecosystem and open by default. Fork it, script it, build on it.",
    icon: (
      <>
        <circle
          cx="6"
          cy="7"
          r="2.6"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        />
        <circle
          cx="6"
          cy="18"
          r="2.6"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        />
        <circle
          cx="18"
          cy="7"
          r="2.6"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        />
        <path
          d="M6 9.6v5.8M18 9.6c0 4-6 2-6 5.4"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        />
      </>
    ),
  },
];

function Landing() {
  return (
    <div className="facet-landing">
      <nav className="fl-nav">
        <span className="fl-logo">
          <img src="/mark.svg" alt="" className="mark" /> Facet
        </span>
        <span className="fl-nav-spacer" />
        <span className="fl-nav-links">
          <a href="https://omni.dev" target="_blank" rel="noreferrer">
            Omni
          </a>
          <Link to="/studio">Studio</Link>
          <span className="fl-pill">Preview</span>
        </span>
      </nav>

      <div className="fl-wrap">
        <header className="fl-hero">
          <div>
            <span className="fl-eyebrow">Code-first parametric CAD</span>
            <h1 className="fl-title">
              Write code.
              <br />
              Get <span className="accent">geometry</span>.
            </h1>
            <p className="fl-sub">
              Facet turns code into solid geometry. Model parametric parts in
              real code, evaluate them with a proper geometry kernel, and export
              print-ready meshes - right in your browser.
            </p>
            <div className="fl-cta-row">
              <Link to="/studio" className="fl-btn fl-btn-primary">
                Open the Studio
              </Link>
              <a
                className="fl-btn fl-btn-ghost"
                href="https://omni.dev"
                target="_blank"
                rel="noreferrer"
              >
                Explore Omni
              </a>
            </div>
          </div>

          <div className="fl-visual">
            <div className="fl-code">
              <div>
                <span className="c-com">{"// a bracket, parametrically"}</span>
              </div>
              <div>
                <span className="c-key">const</span> t ={" "}
                <span className="c-fn">param</span>.
                <span className="c-fn">number</span>(
                <span className="c-num">"thickness"</span>, {"{ "}min:{" "}
                <span className="c-num">3</span>, max:{" "}
                <span className="c-num">12</span>
                {" }"});
              </div>
              <div>
                <span className="c-key">let</span> part ={" "}
                <span className="c-fn">cube</span>([
                <span className="c-num">40</span>,{" "}
                <span className="c-num">40</span>, t]);
              </div>
              <div>
                part = part.<span className="c-fn">subtract</span>(
              </div>
              <div>
                {"  "}
                <span className="c-fn">cylinder</span>(
                <span className="c-num">4</span>, t).
                <span className="c-fn">translate</span>(
                <span className="c-num">20</span>,{" "}
                <span className="c-num">20</span>,{" "}
                <span className="c-num">0</span>),
              </div>
              <div>);</div>
              <div>
                <span className="c-key">return</span> part;
              </div>
            </div>
            <BlueprintPart />
          </div>
        </header>
      </div>

      <div className="fl-wrap">
        <section className="fl-section">
          <div className="fl-kicker">How it works</div>
          <div className="fl-steps">
            <div className="fl-step">
              <div className="fl-step-num">01</div>
              <h3>Write code</h3>
              <p>
                Describe the part with primitives, transforms, and boolean ops.
              </p>
            </div>
            <div className="fl-step">
              <div className="fl-step-num">02</div>
              <h3>The kernel builds it</h3>
              <p>
                A solid-geometry kernel evaluates your code into real geometry.
              </p>
            </div>
            <div className="fl-step">
              <div className="fl-step-num">03</div>
              <h3>Preview &amp; export</h3>
              <p>
                Spin it in 3D, tune the parameters, and export STL to print.
              </p>
            </div>
          </div>
        </section>

        <section className="fl-section">
          <div className="fl-kicker">Built for makers who code</div>
          <div className="fl-features">
            {FEATURES.map((f) => (
              <div className="fl-card" key={f.title}>
                <svg className="ic" viewBox="0 0 24 24" aria-hidden="true">
                  {f.icon}
                </svg>
                <h3>{f.title}</h3>
                <p>{f.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="fl-section">
          <div className="fl-kicker">From code to the real world</div>
          <div className="fl-print">
            <div className="fl-print-copy">
              <h2>
                From code to a <span className="accent">real part</span>
              </h2>
              <p>
                Facet gets you a print-ready STL. Soon you'll be able to send it
                to MatterForge, our printing partner, and hold the real thing.
              </p>
              <a
                className="fl-btn fl-btn-primary"
                href="https://matterforge.io"
                target="_blank"
                rel="noreferrer"
              >
                Print with MatterForge <span className="soon">Soon</span>
              </a>
            </div>
            <PrintMotif />
          </div>
        </section>

        <section className="fl-section">
          <div className="fl-band">
            <h2>
              The Studio is <span className="accent">open</span>
            </h2>
            <p>
              Write code, tune live parameters, and export a print-ready STL -
              free, open source, right in your browser.
            </p>
            <Link to="/studio" className="fl-btn fl-btn-primary">
              Open the Studio
            </Link>
          </div>
        </section>

        <footer className="fl-footer">
          <span className="made">
            Made with 🔶 by{" "}
            <a href="https://omni.dev" target="_blank" rel="noreferrer">
              Omni
            </a>{" "}
            in partnership with{" "}
            <a href="https://matterforge.io" target="_blank" rel="noreferrer">
              MatterForge
            </a>
          </span>
          <span className="links">
            <Link to="/studio">Studio</Link>
            <a href="https://omni.dev" target="_blank" rel="noreferrer">
              omni.dev
            </a>
          </span>
        </footer>
      </div>
    </div>
  );
}

/** Isometric wireframe of a plate with a bored hole - the drafting motif. */
function BlueprintPart() {
  return (
    <svg className="fl-blueprint" viewBox="0 0 360 300" aria-hidden="true">
      <g fill="none" strokeLinejoin="round" strokeLinecap="round">
        {/* faint construction lines */}
        <g
          stroke="rgba(120,150,180,0.28)"
          strokeWidth="1"
          strokeDasharray="4 5"
        >
          <path d="M180 44v212M40 152h280" />
        </g>

        {/* side faces */}
        <g stroke="#dd6e33" strokeWidth="2">
          <path
            d="M110 158 180 200 180 246 110 204Z"
            fill="rgba(221,110,51,0.10)"
          />
          <path
            d="M250 158 180 200 180 246 250 204Z"
            fill="rgba(221,110,51,0.06)"
          />
          {/* top face */}
          <path
            d="M180 116 250 158 180 200 110 158Z"
            fill="rgba(221,110,51,0.14)"
          />
        </g>

        {/* bored hole - top rim + bottom rim */}
        <g stroke="#f0a566" strokeWidth="2">
          <ellipse
            cx="180"
            cy="157"
            rx="30"
            ry="16"
            fill="rgba(11,28,46,0.85)"
          />
          <ellipse
            cx="180"
            cy="171"
            rx="30"
            ry="16"
            fill="none"
            opacity="0.6"
          />
          <path d="M150 157v14M210 157v14" opacity="0.6" />
        </g>

        {/* dimension line */}
        <g stroke="rgba(147,168,189,0.9)" strokeWidth="1.2">
          <path d="M110 268 250 268" />
          <path d="M110 262v12M250 262v12" />
          <path
            d="M110 268l10-4v8ZM250 268l-10-4v8Z"
            fill="rgba(147,168,189,0.9)"
          />
        </g>
      </g>
      <text
        x="180"
        y="285"
        textAnchor="middle"
        fill="#93a8bd"
        fontFamily="ui-monospace, monospace"
        fontSize="12"
      >
        parametric
      </text>
    </svg>
  );
}

/** A part building up in printed layers - the code-to-print motif. */
function PrintMotif() {
  return (
    <svg className="fl-print-svg" viewBox="0 0 220 200" aria-hidden="true">
      <g fill="none" strokeLinejoin="round" strokeLinecap="round">
        {/* print bed */}
        <path
          d="M40 150 110 186 180 150 110 114Z"
          fill="rgba(147,168,189,0.08)"
          stroke="rgba(147,168,189,0.5)"
          strokeWidth="1.4"
        />
        {/* stacked layers */}
        <g stroke="#dd6e33" strokeWidth="2">
          <path
            d="M74 132 110 150 146 132 110 114Z"
            fill="rgba(221,110,51,0.16)"
          />
          <path
            d="M78 118 110 134 142 118 110 102Z"
            fill="rgba(221,110,51,0.13)"
          />
          <path
            d="M82 104 110 118 138 104 110 90Z"
            fill="rgba(221,110,51,0.10)"
          />
        </g>
        {/* rising layer lines */}
        <g stroke="rgba(240,165,102,0.55)" strokeWidth="1">
          <path d="M92 97 110 106 128 97M88 111 110 122 132 111M84 125 110 138 136 125" />
        </g>
      </g>
    </svg>
  );
}
