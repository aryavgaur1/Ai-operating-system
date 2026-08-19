import { LandingPage } from '@/components/landing/LandingPage';
import { LandingHeroStatic } from '@/components/landing/LandingHeroStatic';

export default function Home() {
  return (
    <>
      <LandingHeroStatic />
      <LandingPage hideStaticHero />
    </>
  );
}
