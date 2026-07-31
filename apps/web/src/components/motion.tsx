'use client';

import { motion, type HTMLMotionProps, type Variants } from 'framer-motion';
import { cn } from '@/lib/utils';

export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 18, filter: 'blur(6px)' },
  show: { opacity: 1, y: 0, filter: 'blur(0px)', transition: { duration: 0.55, ease: [0.16, 1, 0.3, 1] } },
};

export const stagger: Variants = {
  hidden: {},
  show: {
    transition: { staggerChildren: 0.08, delayChildren: 0.04 },
  },
};

export function Reveal({ className, children, ...props }: HTMLMotionProps<'div'>) {
  return (
    <motion.div
      variants={fadeUp}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, margin: '-60px' }}
      className={className}
      {...props}
    >
      {children}
    </motion.div>
  );
}

export function StaggerGroup({ className, children, ...props }: HTMLMotionProps<'div'>) {
  return (
    <motion.div
      variants={stagger}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, margin: '-60px' }}
      className={className}
      {...props}
    >
      {children}
    </motion.div>
  );
}

interface GlassCardProps extends HTMLMotionProps<'div'> {
  variant?: 'default' | 'strong' | 'glow';
  hoverLift?: boolean;
}

export function GlassCard({ className, variant = 'default', hoverLift = true, children, ...props }: GlassCardProps) {
  const base =
    variant === 'strong' ? 'glass-strong' : variant === 'glow' ? 'glow-panel' : 'glass';
  return (
    <motion.div
      variants={fadeUp}
      whileHover={hoverLift ? { y: -4, transition: { duration: 0.25, ease: 'easeOut' } } : undefined}
      className={cn(base, 'rounded-[28px]', className)}
      {...props}
    >
      {children}
    </motion.div>
  );
}
