import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AdminEnrollPage, AdminPage, AdminSignInPage } from './admin/AdminPages.jsx';
import { DiscoveryPage } from './admin/DiscoveryPage.jsx';
import { AppShell } from './chrome/AppShell.jsx';
import { BetaPage } from './pages/BetaPage.jsx';
import { ChangelogPage } from './pages/ChangelogPage.jsx';
import { CharacterPage } from './pages/CharacterPage.jsx';
import { GuildPage } from './pages/GuildPage.jsx';
import { GuildsPage } from './pages/GuildsPage.jsx';
import { HomePage } from './pages/HomePage.jsx';
import { LeaderboardsPage } from './pages/LeaderboardsPage.jsx';
import { NotFoundPage } from './pages/NotFoundPage.jsx';
import { PrivacyPage } from './pages/PrivacyPage.jsx';
import { ProfilePage } from './pages/ProfilePage.jsx';
import { SecondFactorPage, SignInPage } from './pages/SignInPages.jsx';
import { StatLeaderboardPage } from './pages/StatLeaderboardPage.jsx';
import { SessionProvider } from './session.jsx';
import { MergePage } from './settings/MergePage.jsx';
import { SettingsPage } from './settings/SettingsPage.jsx';

// Every 1.0 page has its route. Pages for features that aren't built say so ("Coming soon"), with no sample data.
// Signed in, the home route is the player's dashboard (HomePage → DashboardPage).
export function App() {
  return (
    <SessionProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<HomePage />} />
            {/* The signed-in dashboard IS the home page; /dashboard is a natural guess, so it goes there. */}
            <Route path="dashboard" element={<Navigate to="/" replace />} />
            <Route path="c/:slug" element={<CharacterPage />} />
            <Route path="leaderboards" element={<LeaderboardsPage />} />
            <Route path="leaderboards/:ruleset/:statistic" element={<StatLeaderboardPage />} />
            <Route path="guilds" element={<GuildsPage />} />
            <Route path="g/:slug" element={<GuildPage />} />
            <Route path="sign-in" element={<SignInPage />} />
            <Route path="sign-in/2fa" element={<SecondFactorPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="settings/merge" element={<MergePage />} />
            <Route path="changelog" element={<ChangelogPage />} />
            <Route path="beta" element={<BetaPage />} />
            <Route path="privacy" element={<PrivacyPage />} />
            <Route path="u/:username" element={<ProfilePage />} />
            <Route path="admin" element={<AdminPage />} />
            <Route path="admin/discovery" element={<DiscoveryPage />} />
            <Route path="admin/sign-in" element={<AdminSignInPage />} />
            <Route path="admin/enroll" element={<AdminEnrollPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </SessionProvider>
  );
}
