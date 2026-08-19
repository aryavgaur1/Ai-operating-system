/**
 * Server-rendered hero copy for OAuth / Search Console crawlers that do not
 * execute client JavaScript. Visible to users and Google branding verification.
 */
export function LandingHeroStatic() {
  return (
    <section
      className="mx-auto max-w-7xl px-4 pb-2 pt-28 text-white sm:px-6 sm:pt-32"
      aria-label="Nexora OS overview"
    >
      <p className="text-[11px] uppercase tracking-[0.22em] text-neutral-400">Nexora OS</p>
      <h1 className="font-display mt-3 text-4xl font-semibold tracking-tight sm:text-5xl">
        Nexora OS — AI Operating System
      </h1>
      <p className="mt-4 max-w-2xl text-base leading-8 text-neutral-300 sm:text-lg">
        <strong>Nexora OS</strong> is a productivity application for modern teams. It connects
        Gmail, Slack, Notion, and Jira so users can search email, read and send messages, summarize
        conversations, and run approved actions across their connected tools from one secure
        workspace.
      </p>
      <p className="mt-3 max-w-2xl text-sm leading-7 text-neutral-400">
        Purpose: help teams use AI to work across email and collaboration tools with human approval
        before any message is sent or record is changed.
      </p>
    </section>
  );
}
