import type { Metadata } from 'next';
import './globals.css';
import styles from './layout.module.css';
import { FiCommand } from 'react-icons/fi';

export const metadata: Metadata = {
  title: 'CareerX Lead Discovery',
  description: 'AI-powered lead discovery platform for CareerXcelerator',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <header className="app-header">
          <div className="container flex justify-between items-center">
            <div className="logo">
              <img src="/logo.png" alt="CareerXcelerator Logo" width={32} height={32} className="mr-2" />
              CareerXcelerator <span className={`${styles.textSecondary} ${styles.textSm} ${styles.fontNormal}`}>Lead Discovery</span>
            </div>
            <div className={styles.userProfile}>
              <div className={styles.avatar}>CX</div>
            </div>
          </div>
        </header>

        <main className={styles.mainContent}>
          {children}
        </main>
      </body>
    </html>
  );
}
