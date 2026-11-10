import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AdminEnrollPage, AdminSignInPage } from './admin/AdminSignIn.jsx';
import { BadgePage } from './pages/BadgePage.jsx';
import { BannedPage } from './moderation/Moderation.jsx';
import { GuildBadgePage, GuildBadgesIndexPage } from './guildBadges/GuildBadgePages.jsx';
import { ManageBadgesPage } from './guildBadges/ManageBadgesPage.jsx';
import { FeedbackPage, YourFeedbackPage } from './feedback/FeedbackPages.jsx';
import { AppShell } from './chrome/AppShell.jsx';
import { BetaPage } from './pages/BetaPage.jsx';
import { ChangelogPage } from './pages/ChangelogPage.jsx';
import { CharacterPage } from './pages/CharacterPage.jsx';
import { GuildBoardPage, GuildMemberBoardPage } from './pages/GuildBoardPages.jsx';
import { GuildPage } from './pages/GuildPage.jsx';
import { GuildsPage } from './pages/GuildsPage.jsx';
import { HomePage } from './pages/HomePage.jsx';
import { LeaderboardsPage } from './pages/LeaderboardsPage.jsx';
import { NotFoundPage } from './pages/NotFoundPage.jsx';
import { PrivacyPage } from './pages/PrivacyPage.jsx';
import { ProfilePage } from './pages/ProfilePage.jsx';
import { SearchPage } from './pages/SearchPage.jsx';
import { SecondFactorPage, SignInPage } from './pages/SignInPages.jsx';
import { StatLeaderboardPage } from './pages/StatLeaderboardPage.jsx';
import { GoldBoardPage } from './pages/GoldBoardPage.jsx';
import { HowTiersPage, TierBoardPage } from './pages/TiersPages.jsx';
import { SessionProvider } from './session.jsx';
import { MergePage } from './settings/MergePage.jsx';
import { SettingsPage } from './settings/SettingsPage.jsx';
import { CardMakerPage } from './share/CardMaker.jsx';

// 0.10.3: the admin (design/v5-admin) is its own chunk with its own frame, loaded only when an /admin address opens.
const AdminApp = lazy(() => import('./admin/AdminApp.jsx'));

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
            {/* 0.9.0: the Collections tab and its screens (design/v4-collections). */}
            <Route path="c/:slug/collections" element={<CharacterPage tab="collections" />} />
            <Route path="c/:slug/collections/:screen" element={<CharacterPage tab="collections" />} />
            {/* 0.8.0: the card maker, at the designed routes (design/v3-share-cards). */}
            <Route path="c/:slug/share" element={<CardMakerPage type="character" />} />
            <Route path="c/:slug/tier/share" element={<CardMakerPage type="tier" />} />
            <Route path="c/:slug/collections/share" element={<CardMakerPage type="collections" />} />
            <Route path="g/:slug/share" element={<CardMakerPage type="guild" />} />
            <Route path="leaderboards/:ruleset/:statistic/share" element={<CardMakerPage type="board" />} />
            <Route path="leaderboards/guilds/:ruleset/:statistic/share" element={<CardMakerPage type="board" />} />
            <Route path="leaderboards" element={<LeaderboardsPage />} />
            <Route path="leaderboards/gold/:ruleset/:field" element={<GoldBoardPage />} />
            <Route path="leaderboards/:ruleset/:statistic" element={<StatLeaderboardPage />} />
            <Route path="leaderboards/guilds/:ruleset/:statistic" element={<GuildBoardPage />} />
            <Route path="tiers" element={<TierBoardPage />} />
            <Route path="tiers/how" element={<HowTiersPage />} />
            <Route path="guilds" element={<GuildsPage />} />
            <Route path="g/:slug" element={<GuildPage />} />
            <Route path="g/:slug/boards/:statistic" element={<GuildMemberBoardPage />} />
            <Route path="g/:slug/manage/badges" element={<ManageBadgesPage />} />
            <Route path="guild-badges" element={<GuildBadgesIndexPage />} />
            <Route path="guild-badges/:id" element={<GuildBadgePage />} />
            <Route path="feedback" element={<FeedbackPage />} />
            <Route path="settings/feedback" element={<YourFeedbackPage />} />
            <Route path="search" element={<SearchPage />} />
            <Route path="sign-in" element={<SignInPage />} />
            <Route path="sign-in/2fa" element={<SecondFactorPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="settings/merge" element={<MergePage />} />
            <Route path="changelog" element={<ChangelogPage />} />
            <Route path="beta" element={<BetaPage />} />
            <Route path="privacy" element={<PrivacyPage />} />
            <Route path="u/:username" element={<ProfilePage />} />
            <Route path="badges/:id" element={<BadgePage />} />
            <Route path="banned" element={<BannedPage />} />
            <Route path="admin/sign-in" element={<AdminSignInPage />} />
            <Route path="admin/enroll" element={<AdminEnrollPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Route>
          <Route path="admin/*" element={<Suspense fallback={<div className="es adm-loading" role="status">Opening the admin…</div>}><AdminApp /></Suspense>} />
        </Routes>
      </BrowserRouter>
    </SessionProvider>
  );
}
