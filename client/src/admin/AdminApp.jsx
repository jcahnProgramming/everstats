import { Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom';
import '../theme/admin.css';
import './admin-app.css';
import { AdminShell } from './shell/AdminShell.jsx';
import { REDIRECTS } from './shell/nav.js';
import { DashboardPage } from './pages/DashboardPage.jsx';
import { AuditPage } from './pages/AuditPage.jsx';
import { FeedbackInboxPage, ReportsInboxPage } from './pages/InboxPages.jsx';
import { AccountDetailPage, AccountsDirectoryPage, CharactersDirectoryPage, GuildLinksPage, GuildsDirectoryPage, ReservedUsernamesPage } from './pages/DirectoryPages.jsx';
import { GuildBadgesTab, PlayerBadgesTab } from './pages/BadgesPages.jsx';
import { TiersPage } from './pages/TiersPage.jsx';
import { DiscoveryApprovalsPage, DiscoveryProbePage, DiscoveryRunsPage } from './pages/DiscoveryPages.jsx';
import { BackupsPage, CollectionsDataPage, CrawlerPage } from './pages/DataPages.jsx';
import { RetentionPage } from './pages/RetentionPage.jsx';
import { SettingsPage } from './pages/SettingsPage.jsx';
import { FeaturesPage } from './pages/FeaturesPage.jsx';
import { ReleasePage } from './pages/ReleasePage.jsx';
import { NotFoundPage } from '../pages/NotFoundPage.jsx';

/**
 * The admin area (0.10.3, design/v5-admin), loaded as its own chunk the first time an /admin address opens: public
 * visitors never download it, and its stylesheet (theme/admin.css) is never on a public page. /admin/sign-in and
 * /admin/enroll stay in the public frame (App.jsx): they are reached without an admin session.
 *
 * Every address is in shell/nav.js PAGES; old addresses (REDIRECTS) go to their new homes with their id and query.
 */
function Redirect({ to }) {
  const params = useParams();
  const { search, hash } = useLocation();
  const path = to.replace(/:([a-z]+)/g, (_, k) => encodeURIComponent(params[k] ?? ''));
  return <Navigate to={`${path}${search}${hash}`} replace />;
}

export default function AdminApp() {
  return (
    <Routes>
      <Route element={<AdminShell />}>
        <Route index element={<DashboardPage />} />
        <Route path="inbox/feedback" element={<FeedbackInboxPage />} />
        <Route path="inbox/feedback/:id" element={<FeedbackInboxPage />} />
        <Route path="inbox/reports" element={<ReportsInboxPage />} />
        <Route path="directory/accounts" element={<AccountsDirectoryPage />} />
        <Route path="directory/accounts/reserved" element={<ReservedUsernamesPage />} />
        <Route path="directory/accounts/:id" element={<AccountDetailPage />} />
        <Route path="directory/characters" element={<CharactersDirectoryPage />} />
        <Route path="directory/guilds" element={<GuildsDirectoryPage />} />
        <Route path="directory/guilds/links" element={<GuildLinksPage />} />
        <Route path="directory/guilds/:id/links" element={<GuildLinksPage />} />
        <Route path="badges/player" element={<PlayerBadgesTab />} />
        <Route path="badges/guild" element={<GuildBadgesTab />} />
        <Route path="tiers" element={<TiersPage />} />
        <Route path="discovery/approvals" element={<DiscoveryApprovalsPage />} />
        <Route path="discovery/runs" element={<DiscoveryRunsPage />} />
        <Route path="discovery/probe" element={<DiscoveryProbePage />} />
        <Route path="data/crawler" element={<CrawlerPage />} />
        <Route path="data/collections" element={<CollectionsDataPage />} />
        <Route path="data/backups" element={<BackupsPage />} />
        <Route path="retention" element={<RetentionPage />} />
        <Route path="features" element={<FeaturesPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="audit" element={<AuditPage />} />
        <Route path="release" element={<ReleasePage />} />
        {REDIRECTS.map((r) => <Route key={r.from} path={r.from.replace(/^\/admin\//, '')} element={<Redirect to={r.to} />} />)}
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
