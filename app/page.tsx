'use client';

import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { ArrowUpRight, BookOpen, Briefcase, Calendar, Flame, GraduationCap, MessageSquare, Users } from 'lucide-react';
import { ThemeToggle } from '@/components/theme-toggle';
import { ForgeWorkbench } from '@/components/landing/ForgeWorkbench';
import { SparkEntry } from '@/components/spark-entry';
import styles from './home.module.css';

const areas = [
  { title: 'Community', description: 'Fragen stellen. Erfahrungen teilen.', href: '/community', icon: MessageSquare },
  { title: 'Kurse', description: 'Schritt für Schritt Neues lernen.', href: '/courses', icon: GraduationCap },
  { title: 'Wissensdatenbank', description: 'Anleitungen und Antworten finden.', href: '/knowledgebase', icon: BookOpen },
  { title: 'Projekte', description: 'Arbeiten zeigen. Feedback bekommen.', href: '/showcases', icon: Briefcase },
  { title: 'Mitglieder', description: 'Menschen mit deinen Interessen treffen.', href: '/members', icon: Users },
  { title: 'Events', description: 'Termine entdecken und teilnehmen.', href: '/events', icon: Calendar },
];

export default function Home() {
  const { data: session } = useSession();

  return (
    <div className={styles.page}>
      <a href="#page-content" className="skip-link">Zum Inhalt springen</a>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <Link href="/" className={styles.brand} aria-label="ForgeCommunity Startseite">
            <span className={styles.brandMark}><Flame size={22} aria-hidden="true" /></span>
            <span>Forge<span className={styles.brandCommunity}>Community</span></span>
          </Link>
          <nav aria-label="Startseite" className={styles.headerNav}>
            <a href="#bereiche">Bereiche</a>
            <Link href="/about">Über uns</Link>
          </nav>
          <div className={styles.headerActions}>
            <ThemeToggle />
            <Link className={styles.signIn} href={session ? '/community' : '/login'}>{session ? 'Community' : 'Anmelden'}</Link>
          </div>
        </div>
      </header>

      <main id="page-content" tabIndex={-1}>
        <section className={styles.hero} aria-labelledby="home-title">
          <div className={styles.heroCopy}>
            <h1 id="home-title" className={styles.title}>Lernen.<br />Machen.<br />Weitergeben.</h1>
            <p className={styles.intro}>Entdecke Kurse, teile dein Wissen und bring dein nächstes Projekt weiter.</p>
            <div className={styles.heroActions}>
              <Link className={styles.primaryAction} href={session ? '/community' : '/register'}>
                {session ? 'Zur Community' : 'Konto erstellen'}
              </Link>
              <a href="#bereiche" className={styles.explore}>Bereiche ansehen</a>
            </div>
            <SparkEntry className="mt-5" />
          </div>
          <ForgeWorkbench />
        </section>

        <section id="bereiche" className={styles.areas} aria-labelledby="areas-title">
          <div className={styles.sectionIntro}>
            <h2 id="areas-title">Was bringt dich weiter?</h2>
            <p>Dein nächster Schritt hat hier Platz.</p>
          </div>
          <nav aria-label="Bereiche" className={styles.areaGrid}>
            {areas.map(area => (
              <Link key={area.href} href={session ? area.href : `/login?callbackUrl=${encodeURIComponent(area.href)}`} className={styles.areaLink}>
                <area.icon className={styles.areaIcon} size={24} aria-hidden="true" />
                <span className={styles.areaCopy}>
                  <span className={styles.areaTitle}>{area.title}</span>
                  <span className={styles.areaDescription}>{area.description}</span>
                </span>
                <ArrowUpRight className={styles.areaArrow} size={20} aria-hidden="true" />
              </Link>
            ))}
          </nav>
        </section>
      </main>

      <footer className={styles.footer}>
        <div className={styles.footerInner}>
          <span>ForgeCommunity</span>
          <Link href="/about">Über uns</Link>
        </div>
      </footer>
    </div>
  );
}
