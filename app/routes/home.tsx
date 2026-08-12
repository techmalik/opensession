import { Form, Link } from "react-router";
import { useEffect, useState, type ReactNode } from "react";
import { and, asc, eq } from "drizzle-orm";
import type { Route } from "./+types/home";
import { getDb } from "../lib/db.server";
import { getUser } from "../lib/session.server";
import { featuredActiveEvent } from "../lib/events.server";
import { landingFor, DEMO_ACCOUNTS, DEMO_CREDENTIALS } from "../lib/roles";
import { useReveal } from "../lib/reveal";
import { Logo, LogoMark, GithubIcon } from "../components/brand";
import { forms } from "../../database/schema";

// The front door: a marketing page for the OpenSession project itself, not for one
// event. It explains the product, links to the source, and drops a visitor straight
// into a live, populated demo. A specific event's own page lives at /e/:eventSlug.

const GITHUB_URL = "https://github.com/techmalik/opensession";
const CANONICAL_URL = "https://opensession.opensession.workers.dev/";

export function meta(): Route.MetaDescriptors {
  const title = "OpenSession, open-source speaker and content management";
  const description =
    "Run call for papers, blind review, agenda scheduling, a speaker portal, and public embeds on infrastructure you own. MIT licensed, self-hostable on Cloudflare.";
  return [
    { title },
    { name: "description", content: description },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    { property: "og:type", content: "website" },
    { property: "og:url", content: CANONICAL_URL },
    { tagName: "link", rel: "canonical", href: CANONICAL_URL },
  ];
}

export async function loader({ request }: Route.LoaderArgs) {
  const user = await getUser(request);
  const db = getDb();

  // The featured event (Settings > Featured event), so a visitor-created event
  // cannot take over the homepage. Latest active is only the fallback.
  const row = await featuredActiveEvent();
  const event = row
    ? {
        name: row.name,
        slug: row.slug,
        location: row.location,
        timezone: row.timezone,
        startsAt: row.startsAt,
        endsAt: row.endsAt,
      }
    : undefined;

  const openForm = event
    ? await db
        .select({ name: forms.name, closesAt: forms.closesAt })
        .from(forms)
        .where(and(eq(forms.eventId, row!.id), eq(forms.status, "published")))
        .orderBy(asc(forms.closesAt))
        .get()
    : undefined;

  return { user, event, openForm: openForm ?? null, demoAccounts: DEMO_ACCOUNTS, demoCredentials: DEMO_CREDENTIALS };
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const { user, event, demoAccounts, demoCredentials } = loaderData;

  return (
    <>
      <SiteHeader user={user} />
      <main>
        <Hero user={user} event={event} />
        <Pipeline />
        <FeatureGrid />
        <LiveEmbed event={event} />
        <OpenSource />
        <DemoSection user={user} demoAccounts={demoAccounts} demoCredentials={demoCredentials} event={event} />
      </main>
      <SiteFooter event={event} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

const navLinks = [
  { href: "#features", label: "Features" },
  { href: "#open-source", label: "Open source" },
  { href: "/docs/api", label: "API docs" },
  { href: "#demo", label: "Demo" },
];

function SiteHeader({ user }: { user: { role: string } | null }) {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    function onScroll() {
      setScrolled(window.scrollY > 4);
    }
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={`sticky top-0 z-40 bg-white transition-shadow duration-200 ${
        scrolled ? "border-b border-slate-200 shadow-sm" : "border-b border-transparent"
      }`}
    >
      <div className="mx-auto flex h-16 w-full max-w-[1100px] items-center justify-between px-4 sm:px-6">
        <Link to="/" aria-label="OpenSession home">
          <Logo />
        </Link>

        <nav aria-label="Primary" className="hidden items-center gap-6 text-sm text-slate-500 md:flex">
          {navLinks.map((link) => (
            <a key={link.href} href={link.href} className="hover:text-slate-900">
              {link.label}
            </a>
          ))}
        </nav>

        <div className="hidden items-center gap-4 md:flex">
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noreferrer"
            aria-label="OpenSession on GitHub"
            className="text-slate-500 hover:text-slate-900"
          >
            <GithubIcon />
          </a>
          {user ? (
            <Link to={landingFor(user.role)} className="text-sm font-medium text-accent hover:underline">
              Go to dashboard
            </Link>
          ) : (
            <Link to="/login" className="text-sm text-slate-500 hover:text-slate-900">
              Sign in
            </Link>
          )}
          <a href="#demo" className="inline-flex h-9 items-center rounded-md bg-accent px-3 text-sm font-medium text-white hover:bg-accent-hover">
            Try the demo
          </a>
        </div>

        <div className="flex items-center gap-1 md:hidden">
        <a
          href={GITHUB_URL}
          target="_blank"
          rel="noreferrer"
          aria-label="OpenSession on GitHub"
          className="flex h-11 w-11 items-center justify-center text-slate-500 hover:text-slate-900"
        >
          <GithubIcon />
        </a>
        <details>
          <summary
            aria-label="Menu"
            className="flex h-11 w-11 cursor-pointer list-none items-center justify-center rounded-md text-slate-500 hover:bg-slate-50 hover:text-slate-900"
          >
            <MenuGlyph />
          </summary>
          <div className="fixed inset-x-0 top-16 z-40 border-b border-slate-200 bg-white px-4 pb-4 shadow-sm">
            <nav aria-label="Primary" className="flex flex-col text-base">
              {navLinks.map((link) => (
                <a key={link.href} href={link.href} className="min-h-11 py-2.5 text-slate-900">
                  {link.label}
                </a>
              ))}
              <a href={GITHUB_URL} target="_blank" rel="noreferrer" className="flex min-h-11 items-center gap-2 py-2.5 text-slate-900">
                <GithubIcon /> GitHub
              </a>
              {user ? (
                <Link to={landingFor(user.role)} className="min-h-11 py-2.5 font-medium text-accent">
                  Go to dashboard
                </Link>
              ) : (
                <Link to="/login" className="min-h-11 py-2.5 text-slate-900">
                  Sign in
                </Link>
              )}
            </nav>
          </div>
        </details>
        </div>
      </div>
    </header>
  );
}

function MenuGlyph() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M3 5h14M3 10h14M3 15h14" stroke="#0f172a" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Hero
// ---------------------------------------------------------------------------

function Hero({ user, event }: { user: { role: string } | null; event: { slug: string } | undefined }) {
  return (
    <section className="border-b border-slate-200 bg-slate-50">
      <div className="mx-auto grid w-full max-w-[1100px] gap-10 px-4 py-16 sm:px-6 md:grid-cols-2 md:items-center md:py-24 [&>*]:min-w-0">
        <div>
          <h1 className="text-[28px] font-semibold leading-tight tracking-tight text-slate-900 md:text-[36px]">
            Speaker and content management, open source.
          </h1>
          <p className="mt-4 text-base leading-relaxed text-slate-500">
            Run the whole pipeline from call for papers to published agenda: submissions, blind review,
            scheduling, speaker portal, and embeds, on infrastructure you own. Built as an open-source
            alternative to tools like Sessionboard.
          </p>

          <div className="mt-6 flex flex-wrap gap-3">
            <a href="#demo" className="inline-flex h-11 items-center rounded-md bg-accent px-5 text-base font-medium text-white hover:bg-accent-hover">
              Try the live demo
            </a>
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-11 items-center rounded-md border border-slate-200 bg-white px-5 text-base font-medium text-slate-900 hover:bg-slate-50"
            >
              View on GitHub
            </a>
          </div>

          <ul className="mt-6 flex flex-wrap gap-x-5 gap-y-1.5 text-[13px] text-slate-500">
            <li>MIT licensed</li>
            <li>Self-hostable on Cloudflare</li>
            <li>No per-event pricing</li>
          </ul>

          {user ? null : (
            <p className="mt-6 text-[13px] text-slate-500">
              Have an account?{" "}
              <Link to="/login" className="font-medium text-accent hover:underline">
                Sign in
              </Link>
            </p>
          )}
        </div>

        <SubmissionsMockup event={event} />
      </div>
    </section>
  );
}

/** A browser-frame mockup of the submissions table, real component styling and
 *  hardcoded sample rows, not a screenshot. Fixture names from spec/fixtures-sample-data.json. */
function SubmissionsMockup({ event }: { event: { slug: string } | undefined }) {
  const rows = [
    { title: "Shipping durable agents on the edge", speaker: "Jordan Alvarez", track: "Engineering", status: "Accepted" },
    { title: "Blind review at scale", speaker: "Priya Raman", track: "Practice", status: "Accept Queue" },
    { title: "Scheduling without double-booking", speaker: "Marcus Okafor", track: "Engineering", status: "Pending" },
    { title: "What conference organizers actually need", speaker: "Sam Whitfield", track: "Product", status: "Pending" },
  ];
  const statusColor: Record<string, string> = {
    Accepted: "bg-accent",
    "Accept Queue": "bg-sky-600",
    Pending: "bg-slate-400",
  };

  const ref = useReveal<HTMLDivElement>();
  return (
    <div ref={ref} className="reveal overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center gap-1.5 border-b border-slate-200 bg-slate-50 px-3 py-2">
        <span className="h-2.5 w-2.5 rounded-full bg-slate-300" />
        <span className="h-2.5 w-2.5 rounded-full bg-slate-300" />
        <span className="h-2.5 w-2.5 rounded-full bg-slate-300" />
        <span className="ml-2 text-[12px] text-slate-400">
          opensession.workers.dev/admin/{event?.slug ?? "your-event"}/submissions
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[420px] text-[13px]">
          <thead>
            <tr className="border-b border-slate-200 text-left text-slate-500">
              <th scope="col" className="px-3 py-2 font-medium">Title</th>
              <th scope="col" className="px-3 py-2 font-medium">Speaker</th>
              <th scope="col" className="px-3 py-2 font-medium">Track</th>
              <th scope="col" className="px-3 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.title} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                <td className="max-w-[180px] truncate px-3 py-2.5 font-medium text-slate-900">{row.title}</td>
                <td className="px-3 py-2.5 text-slate-500">{row.speaker}</td>
                <td className="px-3 py-2.5 text-slate-500">{row.track}</td>
                <td className="px-3 py-2.5">
                  <span className="inline-flex items-center gap-1.5">
                    <span className={`h-1.5 w-1.5 rounded-full ${statusColor[row.status]}`} />
                    {row.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

const pipelineSteps = [
  { name: "Collect", detail: "CFP forms with conditional fields, published to a public URL." },
  { name: "Review", detail: "Blind scoring rounds assign submissions to evaluators." },
  { name: "Decide", detail: "Accept and decline queues, with real decision emails sent as a separate step." },
  { name: "Schedule", detail: "Agenda builder with room and speaker conflict detection." },
  { name: "Publish", detail: "Embeds, an iCal feed, and public pages, no re-entry." },
];

function Pipeline() {
  return (
    <Section id="pipeline">
      <SectionHeading>One pipeline, start to finish.</SectionHeading>
      <ol className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-5 [&>*]:min-w-0">
        {pipelineSteps.map((step, i) => (
          <RevealLi key={step.name}>
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-900 text-[12px] font-medium text-white">
                {i + 1}
              </span>
              <h3 className="text-sm font-semibold text-slate-900">{step.name}</h3>
            </div>
            <p className="mt-2 text-[13px] leading-relaxed text-slate-500">{step.detail}</p>
          </RevealLi>
        ))}
      </ol>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Feature grid
// ---------------------------------------------------------------------------

const features: { name: string; sentences: [string, string]; glyph: ReactNode }[] = [
  {
    name: "Form builder",
    sentences: [
      "Build CFP forms with conditional fields that show or hide based on another answer.",
      "Forms open and close on a schedule, and closed forms reject submissions server-side.",
    ],
    glyph: <GlyphForm />,
  },
  {
    name: "Abstract review",
    sentences: [
      "Evaluation plans assign submissions to reviewers with configurable blind scoring.",
      "Evaluators never see other evaluators' scores when the plan is blind.",
    ],
    glyph: <GlyphReview />,
  },
  {
    name: "Agenda builder",
    sentences: [
      "Drag or place sessions onto a room and time grid.",
      "Room and speaker double-booking is detected and surfaced, not silently allowed.",
    ],
    glyph: <GlyphAgenda />,
  },
  {
    name: "Speaker portal",
    sentences: [
      "Speakers manage their profile, tasks, and file requests from one portal.",
      "Speakers see only their own submissions and schedule.",
    ],
    glyph: <GlyphPortal />,
  },
  {
    name: "Public embeds and API",
    sentences: [
      "Five embeddable widgets, an iCal feed, and public event pages, all server-rendered.",
      "A public REST API mirrors the same data with token authentication.",
    ],
    glyph: <GlyphEmbed />,
  },
  {
    name: "Integrations",
    sentences: [
      "Two-way sync with Airtable, transactional email through Brevo.",
      "Accepted sessions can push to Accelevents on a schedule.",
    ],
    glyph: <GlyphIntegration />,
  },
];

function FeatureGrid() {
  return (
    <Section id="features" tone="slate">
      <SectionHeading>Six areas, one system.</SectionHeading>
      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 [&>*]:min-w-0">
        {features.map((feature) => (
          <RevealDiv key={feature.name} className="rounded-lg border border-slate-200 bg-white p-5">
            <div className="text-slate-900">{feature.glyph}</div>
            <h3 className="mt-3 text-sm font-semibold text-slate-900">{feature.name}</h3>
            <p className="mt-1.5 text-[13px] leading-relaxed text-slate-500">{feature.sentences[0]}</p>
            <p className="mt-1.5 text-[13px] leading-relaxed text-slate-500">{feature.sentences[1]}</p>
          </RevealDiv>
        ))}
      </div>
    </Section>
  );
}

function GlyphBase({ children }: { children: ReactNode }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      {children}
    </svg>
  );
}
function GlyphForm() {
  return (
    <GlyphBase>
      <rect x="4" y="3" width="16" height="18" rx="2" stroke="#0b7b57" strokeWidth="1.6" />
      <path d="M7.5 8h9M7.5 12h9M7.5 16h5" stroke="#0b7b57" strokeWidth="1.6" strokeLinecap="round" />
    </GlyphBase>
  );
}
function GlyphReview() {
  return (
    <GlyphBase>
      <path d="M12 3.5l2.6 5.3 5.9.85-4.25 4.15 1 5.85L12 16.8l-5.25 2.85 1-5.85L3.5 9.65l5.9-.85L12 3.5z" stroke="#0b7b57" strokeWidth="1.6" strokeLinejoin="round" />
    </GlyphBase>
  );
}
function GlyphAgenda() {
  return (
    <GlyphBase>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" stroke="#0b7b57" strokeWidth="1.6" />
      <path d="M3.5 9h17M8 3v3M16 3v3" stroke="#0b7b57" strokeWidth="1.6" strokeLinecap="round" />
    </GlyphBase>
  );
}
function GlyphPortal() {
  return (
    <GlyphBase>
      <circle cx="12" cy="8" r="3.2" stroke="#0b7b57" strokeWidth="1.6" />
      <path d="M5 20c0-3.6 3.1-6.5 7-6.5s7 2.9 7 6.5" stroke="#0b7b57" strokeWidth="1.6" strokeLinecap="round" />
    </GlyphBase>
  );
}
function GlyphEmbed() {
  return (
    <GlyphBase>
      <path d="M8 8L4 12l4 4M16 8l4 4-4 4M14 5l-4 14" stroke="#0b7b57" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </GlyphBase>
  );
}
function GlyphIntegration() {
  return (
    <GlyphBase>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" stroke="#0b7b57" strokeWidth="1.6" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" stroke="#0b7b57" strokeWidth="1.6" />
      <path d="M10.5 7h3a3 3 0 0 1 3 3v3.5M7 10.5V13a3 3 0 0 0 3 3h3.5" stroke="#0b7b57" strokeWidth="1.6" strokeLinecap="round" />
    </GlyphBase>
  );
}

// ---------------------------------------------------------------------------
// Live embed
// ---------------------------------------------------------------------------

function LiveEmbed({ event }: { event: { slug: string; name: string } | undefined }) {
  const ref = useReveal<HTMLDivElement>();
  return (
    <Section id="live-embed">
      <SectionHeading>This is the actual product.</SectionHeading>
      <p className="mt-2 max-w-[640px] text-[13px] text-slate-500">
        The frame below is the real, server-rendered agenda embed for {event?.name ?? "the featured event"}, the
        same one an organizer pastes onto their own site. Every event gets these five widgets plus an iCal feed.
      </p>

      {event ? (
        <div ref={ref} className="reveal mt-6 overflow-hidden rounded-lg border border-slate-200 shadow-sm">
          <div className="flex items-center gap-1.5 border-b border-slate-200 bg-slate-50 px-3 py-2">
            <span className="h-2.5 w-2.5 rounded-full bg-slate-300" />
            <span className="h-2.5 w-2.5 rounded-full bg-slate-300" />
            <span className="h-2.5 w-2.5 rounded-full bg-slate-300" />
            <span className="ml-2 truncate text-[12px] text-slate-400">
              opensession.workers.dev/embed/v1/{event.slug}/agenda
            </span>
          </div>
          <iframe
            src={`/embed/v1/${event.slug}/agenda`}
            title={`${event.name} public agenda`}
            loading="lazy"
            className="h-[480px] w-full bg-white"
          />
        </div>
      ) : (
        <p className="mt-6 text-[13px] text-slate-500">No featured event is set yet.</p>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Open source
// ---------------------------------------------------------------------------

function OpenSource() {
  const ref = useReveal<HTMLDivElement>();
  return (
    <section id="open-source" className="border-y border-slate-800 bg-slate-900">
      <div ref={ref} className="reveal mx-auto grid w-full max-w-[1100px] gap-10 px-4 py-16 sm:px-6 md:grid-cols-2 md:items-center [&>*]:min-w-0">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-white">Own your speaker data.</h2>
          <ul className="mt-4 space-y-2 text-[14px] text-slate-300">
            <li>MIT license, full source on GitHub.</li>
            <li>Self-host with a single wrangler deploy.</li>
            <li>A public REST API mirrors every event, session, and speaker.</li>
          </ul>
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noreferrer"
            className="mt-6 inline-flex h-11 items-center gap-2 rounded-md bg-white px-5 text-base font-medium text-slate-900 hover:bg-slate-100"
          >
            <GithubIcon /> View on GitHub
          </a>
        </div>
        <pre className="overflow-x-auto rounded-lg border border-slate-700 bg-slate-950 p-4 text-[13px] leading-relaxed text-slate-200">
          <code>{`git clone ${GITHUB_URL}.git
npm install
npm run db:local
npm run deploy`}</code>
        </pre>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Demo
// ---------------------------------------------------------------------------

function DemoSection({
  user,
  demoAccounts,
  demoCredentials,
  event,
}: {
  user: { role: string } | null;
  demoAccounts: { key: string; label: string; blurb: string }[];
  demoCredentials: { role: string; email: string; password: string }[];
  event: { slug: string } | undefined;
}) {
  return (
    <Section id="demo" tone="slate">
      <SectionHeading>Explore a live event.</SectionHeading>

      {user ? (
        <p className="mt-3 text-[13px] text-slate-500">
          You are already signed in.{" "}
          <Link to={landingFor(user.role)} className="font-medium text-accent hover:underline">
            Go to your dashboard
          </Link>
          .
        </p>
      ) : (
        <>
          <p className="mt-2 max-w-[640px] text-[13px] text-slate-500">
            Sign in to the populated demo event as any role. No password needed.
          </p>
          <ul className="mt-5 grid gap-3 sm:grid-cols-3 [&>*]:min-w-0">
            {demoAccounts.map((account) => (
              <RevealLi key={account.key}>
                <Form method="post" action={`/demo/${account.key}`}>
                  <button
                    type="submit"
                    className="flex h-full w-full flex-col items-start rounded-md border border-slate-200 bg-white px-4 py-3 text-left hover:border-accent hover:bg-slate-50"
                  >
                    <span className="text-base font-medium text-slate-900">{account.label}</span>
                    <span className="mt-0.5 text-[13px] text-slate-500">{account.blurb}</span>
                  </button>
                </Form>
              </RevealLi>
            ))}
          </ul>
        </>
      )}

      {event ? (
        <p className="mt-6 text-[13px] text-slate-500">
          Or browse the{" "}
          <Link to={`/e/${event.slug}`} className="font-medium text-accent hover:underline">
            public event page
          </Link>{" "}
          with no login at all.
        </p>
      ) : null}

      <div className="mt-8 max-w-[520px] overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-[13px]">
          <caption className="border-b border-slate-200 px-4 py-2 text-left text-[12px] text-slate-500">
            Demo credentials, if you want to sign in directly
          </caption>
          <thead>
            <tr className="border-b border-slate-200 text-left text-slate-500">
              <th scope="col" className="px-4 py-2 font-medium">Role</th>
              <th scope="col" className="px-4 py-2 font-medium">Email</th>
              <th scope="col" className="px-4 py-2 font-medium">Password</th>
            </tr>
          </thead>
          <tbody>
            {demoCredentials.map((cred) => (
              <tr key={cred.email} className="border-b border-slate-100 last:border-0">
                <td className="px-4 py-2 text-slate-900">{cred.role}</td>
                <td className="px-4 py-2 font-mono text-[12px] text-slate-500">{cred.email}</td>
                <td className="px-4 py-2 font-mono text-[12px] text-slate-500">{cred.password}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Footer
// ---------------------------------------------------------------------------

function SiteFooter({ event }: { event: { slug: string } | undefined }) {
  return (
    <footer className="border-t border-slate-200 bg-slate-50">
      <div className="mx-auto grid w-full max-w-[1100px] gap-8 px-4 py-12 sm:px-6 sm:grid-cols-2 lg:grid-cols-4 [&>*]:min-w-0">
        <div>
          <LogoMark />
          <p className="mt-3 max-w-[220px] text-[13px] leading-relaxed text-slate-500">
            Open-source speaker and content management for conferences.
          </p>
        </div>

        <FooterColumn title="Product">
          <a href="#features">Features</a>
          <a href="#demo">Demo</a>
          <Link to="/docs/api">API docs</Link>
        </FooterColumn>

        <FooterColumn title="Open source">
          <a href={GITHUB_URL} target="_blank" rel="noreferrer">
            GitHub
          </a>
          <a href={`${GITHUB_URL}/blob/main/LICENSE`} target="_blank" rel="noreferrer">
            License
          </a>
          <a href={`${GITHUB_URL}#self-hosting`} target="_blank" rel="noreferrer">
            Self-hosting
          </a>
        </FooterColumn>

        {event ? (
          <FooterColumn title="Featured event">
            <Link to={`/e/${event.slug}`}>Event page</Link>
            <Link to={`/embed/v1/${event.slug}/agenda`}>Public agenda</Link>
            <Link to={`/embed/v1/${event.slug}/sessions`}>Public sessions</Link>
          </FooterColumn>
        ) : null}
      </div>
    </footer>
  );
}

function FooterColumn({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h3 className="text-[13px] font-semibold text-slate-900">{title}</h3>
      <nav className="mt-3 flex flex-col gap-2 text-[13px] text-slate-500 [&_a:hover]:text-slate-900">{children}</nav>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared section chrome
// ---------------------------------------------------------------------------

function Section({ id, tone = "white", children }: { id: string; tone?: "white" | "slate"; children: ReactNode }) {
  return (
    <section id={id} className={`border-b border-slate-200 ${tone === "slate" ? "bg-slate-50" : "bg-white"}`}>
      <div className="mx-auto w-full max-w-[1100px] px-4 py-16 sm:px-6">{children}</div>
    </section>
  );
}

function SectionHeading({ children }: { children: ReactNode }) {
  const ref = useReveal<HTMLHeadingElement>();
  return (
    <h2 ref={ref} className="reveal text-2xl font-semibold tracking-tight text-slate-900">
      {children}
    </h2>
  );
}

function RevealLi({ children, className = "" }: { children: ReactNode; className?: string }) {
  const ref = useReveal<HTMLLIElement>();
  return (
    <li ref={ref} className={`reveal ${className}`}>
      {children}
    </li>
  );
}

function RevealDiv({ children, className = "" }: { children: ReactNode; className?: string }) {
  const ref = useReveal<HTMLDivElement>();
  return (
    <div ref={ref} className={`reveal ${className}`}>
      {children}
    </div>
  );
}
