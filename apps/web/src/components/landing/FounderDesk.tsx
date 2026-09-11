'use client';

import Image from 'next/image';
import { motion } from 'framer-motion';

type IconProps = { size?: number; className?: string };

function MailIcon({ size = 16, className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} fill="none" aria-hidden>
      <rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M3 7l9 7 9-7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function GithubIcon({ size = 16, className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} fill="currentColor" aria-hidden>
      <path d="M12 2C6.48 2 2 6.58 2 12.26c0 4.52 2.87 8.35 6.84 9.71.5.1.68-.22.68-.48 0-.24-.01-.87-.01-1.7-2.78.62-3.37-1.37-3.37-1.37-.45-1.18-1.11-1.5-1.11-1.5-.91-.64.07-.63.07-.63 1 .07 1.53 1.06 1.53 1.06.89 1.56 2.34 1.11 2.91.85.09-.66.35-1.11.63-1.37-2.22-.26-4.55-1.14-4.55-5.07 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.31.1-2.73 0 0 .84-.27 2.75 1.05A9.3 9.3 0 0 1 12 6.84c.85 0 1.71.12 2.51.35 1.9-1.32 2.74-1.05 2.74-1.05.55 1.42.2 2.47.1 2.73.64.72 1.03 1.63 1.03 2.75 0 3.94-2.34 4.8-4.57 5.06.36.32.68.94.68 1.9 0 1.37-.01 2.47-.01 2.81 0 .26.18.59.69.48A10.03 10.03 0 0 0 22 12.26C22 6.58 17.52 2 12 2z" />
    </svg>
  );
}

function LinkedInIcon({ size = 16, className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} fill="currentColor" aria-hidden>
      <path d="M4.98 3.5C4.98 4.88 3.88 6 2.5 6S0 4.88 0 3.5 1.12 1 2.5 1s2.48 1.12 2.48 2.5zM.5 8.5h4V23h-4V8.5zM8.5 8.5h3.8v2h.05c.53-1 1.84-2.05 3.79-2.05 4.05 0 4.8 2.67 4.8 6.14V23h-4v-6.6c0-1.57-.03-3.59-2.19-3.59-2.19 0-2.53 1.71-2.53 3.48V23h-4V8.5z" />
    </svg>
  );
}

function InstagramIcon({ size = 16, className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} fill="none" aria-hidden>
      <rect x="3" y="3" width="18" height="18" rx="5" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="17.5" cy="6.5" r="1" fill="currentColor" />
    </svg>
  );
}

function DiscordIcon({ size = 16, className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} fill="currentColor" aria-hidden>
      <path d="M20.32 4.37A19.8 19.8 0 0 0 15.65 3l-.23.42a18.2 18.2 0 0 1 4.2 1.55 16.7 16.7 0 0 0-6.7-1.2h-.02c-2.3 0-4.6.4-6.7 1.2A18 18 0 0 1 8.58 3.4L8.35 3a19.8 19.8 0 0 0-4.67 1.37C.96 9.04.3 13.57.66 18.05A19.9 19.9 0 0 0 6.5 20.3l.55-.86a12.9 12.9 0 0 1-1.68-.8l.4-.3c3.3 1.55 6.88 1.55 10.16 0l.4.3c-.54.32-1.1.58-1.68.8l.55.86a19.9 19.9 0 0 0 5.84-2.25c.45-5.1-.62-9.58-2.78-13.68zM8.7 15.3c-.95 0-1.73-.88-1.73-1.95S7.73 11.4 8.7 11.4s1.74.88 1.73 1.95-.78 1.95-1.73 1.95zm6.6 0c-.95 0-1.73-.88-1.73-1.95s.78-1.95 1.73-1.95 1.74.88 1.73 1.95-.78 1.95-1.73 1.95z" />
    </svg>
  );
}

const LINKS = [
  {
    label: 'Email',
    href: 'mailto:aryavgaur1@gmail.com',
    detail: 'aryavgaur1@gmail.com',
    icon: MailIcon,
  },
  {
    label: 'GitHub',
    href: 'https://github.com/aryavgaur1',
    detail: 'github.com/aryavgaur1',
    icon: GithubIcon,
  },
  {
    label: 'LinkedIn',
    href: 'https://www.linkedin.com/in/aryav-gaur-330a19412',
    detail: 'Aryav Gaur',
    icon: LinkedInIcon,
  },
  {
    label: 'Instagram',
    href: 'https://www.instagram.com/a4aryavav',
    detail: '@a4aryavav',
    icon: InstagramIcon,
  },
  {
    label: 'Discord',
    href: 'https://discord.com/users/aryavgaur',
    detail: 'aryavgaur',
    icon: DiscordIcon,
  },
] as const;

export function FounderDesk() {
  return (
    <section id="founder" className="mx-auto max-w-7xl px-4 pb-8 pt-8 sm:px-6 sm:pb-12">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        className="relative overflow-hidden rounded-[32px] border border-white/10 bg-[rgba(8,10,16,0.75)] shadow-[0_30px_80px_rgba(0,0,0,0.35)] backdrop-blur-xl"
      >
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_20%_0%,rgba(91,157,255,0.18),transparent_50%),radial-gradient(ellipse_at_90%_80%,rgba(45,212,191,0.08),transparent_45%)]" />
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/30 to-transparent" />

        <div className="relative grid items-center gap-10 p-6 sm:p-10 lg:grid-cols-[0.9fr_1.1fr] lg:gap-14 lg:p-12">
          <div className="mx-auto w-full max-w-sm">
            <div className="relative aspect-[4/5] overflow-hidden rounded-[28px] border border-white/15 shadow-[0_20px_60px_rgba(0,0,0,0.45)]">
              <Image
                src="/aryav-gaur.png"
                alt="Aryav Gaur — Founder & CEO, Nexora"
                fill
                className="object-cover object-top"
                sizes="(max-width: 768px) 90vw, 380px"
              />
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/50 to-transparent" />
            </div>
            <div className="mt-4 text-center lg:text-left">
              <div className="font-display text-xl font-semibold text-white">Aryav Gaur</div>
              <div className="mt-1 text-sm text-accent">Founder & CEO · Nexora</div>
            </div>
          </div>

          <div>
            <div className="text-[11px] uppercase tracking-[0.28em] text-accent2">Founder&apos;s desk</div>
            <h2 className="font-display mt-3 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
              Building the OS I wished existed.
            </h2>
            <div className="mt-5 space-y-4 text-sm leading-7 text-neutral-300 sm:text-base sm:leading-8">
              <p>
                I&apos;m <span className="text-white">Aryav Gaur</span> — a young founder currently pursuing my
                undergraduate degree, and the Founder & CEO of Nexora. I didn&apos;t start this to ship another chatbot.
                I started it because modern teams already drown in tools, threads, and half-finished automation — while
                real work still waits on humans to copy context from Slack into Notion, from tickets into docs, from
                intent into action.
              </p>
              <p>
                Nexora is my answer to that gap: an <span className="text-white">AI Operating System</span> that
                understands intent, remembers workspace context, plans multi-step work, and executes against live systems
                — with approvals when stakes are high. Built for operators who ship, not for demos that pretend.
              </p>
              <p className="text-neutral-400">
                If you&apos;re building a startup, an agency, or an enterprise ops stack and this resonates — I&apos;d love
                to talk.
              </p>
            </div>

            <div className="mt-8 flex flex-wrap gap-2">
              {LINKS.map((link) => {
                const Icon = link.icon;
                return (
                  <a
                    key={link.label}
                    href={link.href}
                    target={link.href.startsWith('mailto:') ? undefined : '_blank'}
                    rel={link.href.startsWith('mailto:') ? undefined : 'noreferrer'}
                    className="group inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/[0.03] px-3.5 py-2 text-xs text-neutral-300 transition hover:border-accent/40 hover:bg-accent/10 hover:text-white"
                  >
                    <Icon size={14} className="text-accent" />
                    <span className="font-medium">{link.label}</span>
                    <span className="hidden text-neutral-500 sm:inline">· {link.detail}</span>
                  </a>
                );
              })}
            </div>
          </div>
        </div>
      </motion.div>
    </section>
  );
}
