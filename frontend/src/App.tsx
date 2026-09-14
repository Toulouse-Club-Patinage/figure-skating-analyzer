import { useState, useEffect } from "react";
import { Routes, Route, NavLink, Link, useLocation, Navigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "./api/client";
import { useAuth } from "./auth/AuthContext";
import { ProtectedRoute } from "./auth/ProtectedRoute";
import { JobProvider } from "./contexts/JobContext";
import ForcePasswordModal from "./components/ForcePasswordModal";
import NotificationBell from "./components/NotificationBell";
import { HelpProvider } from "./help/HelpContext";
import HelpMenu from "./help/HelpMenu";
import DocPanel from "./help/DocPanel";
import TourOverlay from "./help/TourOverlay";
import TourBanner from "./help/TourBanner";
import TourReminder from "./help/TourReminder";
import TourInviteModal from "./help/TourInviteModal";
import StartTourButton from "./help/StartTourButton";
import HomePage from "./pages/HomePage";
import CompetitionPage from "./pages/CompetitionPage";
import CompetitionsPage from "./pages/CompetitionsPage";
import SkaterBrowserPage from "./pages/SkaterBrowserPage";
import SkaterAnalyticsPage from "./pages/SkaterAnalyticsPage";
import StatsPage from "./pages/StatsPage";
import ClubCompetitionPage from "./pages/ClubCompetitionPage";
import LoginPage from "./pages/LoginPage";
import RequestAccountPage from "./pages/RequestAccountPage";
import SetupPage from "./pages/SetupPage";
import SettingsPage from "./pages/SettingsPage";
import ProfilePage from "./pages/ProfilePage";
import MySkatersPage from "./pages/MySkatersPage";
import TrainingPage from "./pages/TrainingPage";
import SkaterTrainingPage from "./pages/SkaterTrainingPage";
import ProgramBuilderPage from "./pages/ProgramBuilderPage";

const navLinksBase = [
  { to: "/", label: "TABLEAU DE BORD", icon: "dashboard", end: true },
  { to: "/patineurs", label: "PATINEURS", icon: "people", end: false },
  { to: "/competitions", label: "COMPÉTITIONS", icon: "emoji_events", end: false },
  { to: "/club", label: "CLUB", icon: "bar_chart", end: false },
];

const trainingNavLink = { to: "/entrainement", label: "ENTRAÎNEMENT", icon: "fitness_center", end: false };

function getPageTitle(pathname: string): string {
  if (pathname === "/") return "Tableau de bord";
  if (pathname === "/competitions") return "Compétitions";
  if (pathname.startsWith("/competitions/")) return "Détail compétition";
  if (pathname === "/patineurs") return "Patineurs";
  if (pathname.startsWith("/patineurs/")) return "Analyse patineur";
  if (pathname.startsWith("/club")) return "Club";
  if (pathname === "/stats") return "Club";
  if (pathname === "/settings") return "Administration";
  if (pathname === "/mes-patineurs") return "Mes patineurs";
  if (pathname === "/profil") return "Mon compte";
  if (pathname === "/entrainement") return "Suivi entraînement";
  if (pathname.startsWith("/entrainement/")) return "Suivi entraînement";
  if (pathname === "/programme") return "Programme";
  return "";
}

function SkaterNav({ closeSidebar, collapsed }: { closeSidebar: () => void; collapsed: boolean }) {
  const { data: skaters } = useQuery({
    queryKey: ["me", "skaters"],
    queryFn: api.me.skaters,
  });

  // Avec un seul patineur, la nav mène droit à sa page : « Mes patineurs »
  // devient alors inatteignable, et avec elle le rattachement d'un patineur
  // supplémentaire. D'où le second lien ci-dessous dans ce cas précis.
  const single = skaters && skaters.length === 1;
  const label = single ? "MON PATINEUR" : "MES PATINEURS";
  const to = single ? `/patineurs/${skaters[0].id}/analyse` : "/mes-patineurs";

  const linkCls = ({ isActive }: { isActive: boolean }) =>
    isActive
      ? `bg-white text-primary shadow-sm rounded-xl mx-2 my-0.5 py-3 font-bold flex items-center gap-3 ${collapsed ? "justify-center px-0" : "px-4"}`
      : `text-on-surface-variant hover:bg-surface-container rounded-xl mx-2 my-0.5 py-3 flex items-center gap-3 transition-colors ${collapsed ? "justify-center px-0" : "px-4"}`;

  return (
    <nav data-tour="sidebar-nav" className="flex-1 py-2">
      <NavLink
        to={to}
        onClick={closeSidebar}
        title={collapsed ? label : undefined}
        className={linkCls}
      >
        <span className="material-symbols-outlined text-xl">ice_skating</span>
        {!collapsed && <span className="text-[11px] font-bold uppercase tracking-wider">{label}</span>}
      </NavLink>
      {single && (
        <NavLink
          to="/mes-patineurs?ajouter=1"
          onClick={closeSidebar}
          title={collapsed ? "AJOUTER UN PATINEUR" : undefined}
          className={linkCls}
        >
          <span className="material-symbols-outlined text-xl">person_add</span>
          {!collapsed && (
            <span className="text-[11px] font-bold uppercase tracking-wider">
              AJOUTER UN PATINEUR
            </span>
          )}
        </NavLink>
      )}
    </nav>
  );
}

function SkaterRedirect() {
  const { data: skaters, isLoading } = useQuery({
    queryKey: ["me", "skaters"],
    queryFn: api.me.skaters,
  });

  if (isLoading) return null;

  const target = skaters && skaters.length === 1
    ? `/patineurs/${skaters[0].id}/analyse`
    : "/mes-patineurs";

  return <Navigate to={target} replace />;
}

/** `/mes-patineurs` avec un seul patineur : la liste n'apporte rien et on
 * renvoie sur sa page d'analyse — SAUF si l'on vient demander l'ajout d'un
 * patineur, seul chemin vers ce formulaire dans ce cas. */
function MySkatersRoute() {
  const [searchParams] = useSearchParams();
  const { data: skaters, isLoading } = useQuery({
    queryKey: ["me", "skaters"],
    queryFn: api.me.skaters,
  });

  if (isLoading) return null;

  if (searchParams.get("ajouter") !== "1" && skaters && skaters.length === 1) {
    return <Navigate to={`/patineurs/${skaters[0].id}/analyse`} replace />;
  }

  return <MySkatersPage />;
}

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

function AuthenticatedLayout() {
  const location = useLocation();
  const pageTitle = getPageTitle(location.pathname);
  const { user, logout } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => localStorage.getItem("sidebar_collapsed") === "true"
  );
  const [passwordModalDismissed, setPasswordModalDismissed] = useState(
    () => sessionStorage.getItem("password_change_dismissed") === "true"
  );

  const showPasswordModal =
    user?.must_change_password === true && !passwordModalDismissed;

  function dismissPasswordModal() {
    sessionStorage.setItem("password_change_dismissed", "true");
    setPasswordModalDismissed(true);
  }

  const { data: config, dataUpdatedAt } = useQuery({
    queryKey: ["config"],
    queryFn: api.config.get,
    staleTime: Infinity,
  });
  const logoSrc = config?.logo_url ? `${config.logo_url}?v=${dataUpdatedAt}` : "";

  function closeSidebar() {
    setSidebarOpen(false);
  }

  function toggleCollapsed() {
    setSidebarCollapsed((prev) => {
      localStorage.setItem("sidebar_collapsed", String(!prev));
      return !prev;
    });
  }

  const collapsed = sidebarCollapsed;

  return (
    <JobProvider>
    <HelpProvider passwordModalOpen={showPasswordModal}>
    <div className="flex min-h-screen">
      {/* Mobile overlay backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-scrim/50 z-30 lg:hidden"
          onClick={closeSidebar}
        />
      )}

      {/* Sidebar */}
      <aside className={`${collapsed ? "lg:w-16" : "lg:w-64"} w-64 fixed left-0 top-0 h-screen bg-surface-container-low flex flex-col z-40 transition-all duration-300 overflow-hidden ${sidebarOpen ? "translate-x-0" : "-translate-x-full"} lg:translate-x-0`}>
        {/* Club header */}
        <div className={`py-5 flex items-center gap-3 ${collapsed ? "px-3 justify-center" : "px-6"}`}>
          {logoSrc ? (
            <img src={logoSrc} alt="" className="w-10 h-10 object-contain shrink-0" />
          ) : (
            <span className="material-symbols-outlined text-primary text-2xl shrink-0">sports_score</span>
          )}
          {!collapsed && (
            <div className="min-w-0">
              <span className="font-headline font-bold text-on-surface text-xs leading-tight block">
                {config?.club_name ?? "SkateLab"}
              </span>
              <p className="text-[10px] uppercase tracking-widest text-on-surface-variant mt-0.5">
                Patinage artistique
              </p>
            </div>
          )}
        </div>

        {/* Nav links */}
        {user?.role === "skater" ? (
          <SkaterNav closeSidebar={closeSidebar} collapsed={collapsed} />
        ) : user?.role === "coach" ? (
          <nav data-tour="sidebar-nav" className="flex-1 py-2">
            {[
              { to: "/", label: "TABLEAU DE BORD", icon: "dashboard", end: true },
              ...(config?.training_enabled ? [{ to: "/entrainement", label: "ENTRAÎNEMENT", icon: "fitness_center", end: true }] : []),
              { to: "/patineurs", label: "PATINEURS", icon: "people", end: false },
              { to: "/competitions", label: "COMPÉTITIONS", icon: "emoji_events", end: false },
              { to: "/club", label: "CLUB", icon: "bar_chart", end: false },
              { to: "/programme", label: "PROGRAMME", icon: "sports_score", end: true },
            ].map(({ to, label, icon, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                onClick={closeSidebar}
                title={collapsed ? label : undefined}
                className={({ isActive }) =>
                  isActive
                    ? `bg-white text-primary shadow-sm rounded-xl mx-2 my-0.5 py-3 font-bold flex items-center gap-3 ${collapsed ? "justify-center px-0" : "px-4"}`
                    : `text-on-surface-variant hover:bg-surface-container rounded-xl mx-2 my-0.5 py-3 flex items-center gap-3 transition-colors ${collapsed ? "justify-center px-0" : "px-4"}`
                }
              >
                <span className="material-symbols-outlined text-xl">{icon}</span>
                {!collapsed && <span className="text-[11px] font-bold uppercase tracking-wider">{label}</span>}
              </NavLink>
            ))}
          </nav>
        ) : (
          <nav data-tour="sidebar-nav" className="flex-1 py-2">
            {[...navLinksBase, ...(user?.role !== "reader" ? [{ to: "/programme", label: "PROGRAMME", icon: "sports_score", end: true }] : []), ...(config?.training_enabled && user?.role !== "reader" ? [trainingNavLink] : [])].map(({ to, label, icon, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                onClick={closeSidebar}
                title={collapsed ? label : undefined}
                className={({ isActive }) =>
                  isActive
                    ? `bg-white text-primary shadow-sm rounded-xl mx-2 my-0.5 py-3 font-bold flex items-center gap-3 ${collapsed ? "justify-center px-0" : "px-4"}`
                    : `text-on-surface-variant hover:bg-surface-container rounded-xl mx-2 my-0.5 py-3 flex items-center gap-3 transition-colors ${collapsed ? "justify-center px-0" : "px-4"}`
                }
              >
                <span className="material-symbols-outlined text-xl">{icon}</span>
                {!collapsed && <span className="text-[11px] font-bold uppercase tracking-wider">{label}</span>}
              </NavLink>
            ))}
          </nav>
        )}

        {/* Bottom section: settings + user */}
        <div className="mt-auto border-t border-outline-variant/30 px-2 py-3 space-y-1">
          {user?.role === "admin" && (
            <NavLink
              to="/settings"
              onClick={closeSidebar}
              title={collapsed ? "ADMINISTRATION" : undefined}
              className={({ isActive }) =>
                isActive
                  ? `bg-white text-primary shadow-sm rounded-xl py-2.5 font-bold flex items-center gap-3 ${collapsed ? "justify-center px-0" : "px-4"}`
                  : `text-on-surface-variant hover:bg-surface-container rounded-xl py-2.5 flex items-center gap-3 transition-colors ${collapsed ? "justify-center px-0" : "px-4"}`
              }
            >
              <span className="material-symbols-outlined text-xl">settings</span>
              {!collapsed && <span className="text-[11px] font-bold uppercase tracking-wider">ADMINISTRATION</span>}
            </NavLink>
          )}
          {collapsed ? (
            <div data-tour="user-account" className="flex flex-col items-center gap-1 py-2">
              <Link
                to="/profil"
                onClick={closeSidebar}
                className="text-on-surface-variant hover:text-on-surface transition-colors"
                title={user?.display_name || user?.email}
              >
                <span className="material-symbols-outlined text-xl">account_circle</span>
              </Link>
              <button
                onClick={logout}
                className="text-on-surface-variant hover:text-error transition-colors"
                title="Déconnexion"
              >
                <span className="material-symbols-outlined text-lg">logout</span>
              </button>
            </div>
          ) : (
            <div data-tour="user-account" className="flex items-center gap-2 px-4 py-2">
              <span className="material-symbols-outlined text-on-surface-variant text-xl">account_circle</span>
              <Link
                to="/profil"
                onClick={closeSidebar}
                className="text-xs text-on-surface-variant hover:text-on-surface truncate flex-1 transition-colors"
              >
                {user?.display_name || user?.email}
              </Link>
              {user?.must_change_password && (
                <span className="w-2 h-2 rounded-full bg-orange-500 shrink-0" title="Changement de mot de passe requis" />
              )}
              <button
                onClick={logout}
                className="text-on-surface-variant hover:text-error transition-colors shrink-0"
                title="Déconnexion"
              >
                <span className="material-symbols-outlined text-lg">logout</span>
              </button>
            </div>
          )}
          {/* Collapse toggle (desktop only) */}
          <button
            onClick={toggleCollapsed}
            className="hidden lg:flex items-center justify-center w-full py-1.5 text-on-surface-variant hover:text-on-surface transition-colors"
            title={collapsed ? "Déplier le menu" : "Replier le menu"}
          >
            <span className="material-symbols-outlined text-lg">
              {collapsed ? "chevron_right" : "chevron_left"}
            </span>
          </button>
        </div>
      </aside>

      {/* Main content */}
      <div className={`${collapsed ? "lg:ml-16" : "lg:ml-64"} min-h-screen bg-surface flex-1 min-w-0 transition-[margin] duration-300`}>
        {/* Top bar */}
        <header className="sticky top-0 bg-surface/70 backdrop-blur-xl z-30 shadow-sm flex items-center gap-3 px-4 lg:px-8 py-4">
          <button
            className="lg:hidden text-on-surface-variant hover:text-on-surface transition-colors shrink-0"
            onClick={() => setSidebarOpen(true)}
            aria-label="Ouvrir le menu"
          >
            <span className="material-symbols-outlined text-2xl">menu</span>
          </button>
          <h1 className="font-headline font-bold text-on-surface text-xl truncate flex-1">{pageTitle}</h1>
          <StartTourButton />
          <HelpMenu />
          <div data-tour="notifications">
            <NotificationBell />
          </div>
        </header>
        <TourBanner />

        <ScrollToTop />
        {/* Page content */}
        <main className="p-4 lg:p-8 max-w-7xl mx-auto">
          <Routes>
            {user?.role === "skater" ? (
              <>
                <Route path="/patineurs/:id/analyse" element={<SkaterAnalyticsPage />} />
                <Route path="/mes-patineurs" element={<MySkatersRoute />} />
                <Route path="/profil" element={<ProfilePage />} />
                <Route path="*" element={<SkaterRedirect />} />
              </>
            ) : user?.role === "coach" ? (
              <>
                <Route path="/" element={<HomePage />} />
                {config?.training_enabled && (
                  <>
                    <Route path="/entrainement" element={<TrainingPage />} />
                    <Route path="/entrainement/patineurs/:id" element={<SkaterTrainingPage />} />
                  </>
                )}
                <Route path="/patineurs" element={<SkaterBrowserPage />} />
                <Route path="/patineurs/:id/analyse" element={<SkaterAnalyticsPage />} />
                <Route path="/competitions" element={<CompetitionsPage />} />
                <Route path="/competitions/:id" element={<CompetitionPage />} />
                <Route path="/club/saison" element={<StatsPage />} />
                <Route path="/club/competition" element={<ClubCompetitionPage />} />
                <Route path="/club" element={<Navigate to="/club/saison" replace />} />
                <Route path="/programme" element={<ProgramBuilderPage />} />
                <Route path="/profil" element={<ProfilePage />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </>
            ) : (
              <>
                <Route path="/" element={<HomePage />} />
                <Route path="/competitions/:id" element={<CompetitionPage />} />
                <Route path="/competitions" element={<CompetitionsPage />} />
                <Route path="/patineurs" element={<SkaterBrowserPage />} />
                <Route path="/patineurs/:id/analyse" element={<SkaterAnalyticsPage />} />
                <Route path="/club/saison" element={<StatsPage />} />
                <Route path="/club/competition" element={<ClubCompetitionPage />} />
                <Route path="/club" element={<Navigate to="/club/saison" replace />} />
                <Route path="/stats" element={<Navigate to="/club/saison" replace />} />
                <Route path="/programme" element={<ProgramBuilderPage />} />
                {config?.training_enabled && user?.role !== "reader" && (
                  <>
                    <Route path="/entrainement" element={<TrainingPage />} />
                    <Route path="/entrainement/patineurs/:id" element={<SkaterTrainingPage />} />
                  </>
                )}
                <Route
                  path="/settings"
                  element={
                    <ProtectedRoute requiredRole="admin">
                      <SettingsPage />
                    </ProtectedRoute>
                  }
                />
                <Route path="/profil" element={<ProfilePage />} />
              </>
            )}
          </Routes>
        </main>
      </div>
    </div>
      {showPasswordModal && (
        <ForcePasswordModal onClose={dismissPasswordModal} />
      )}
      <DocPanel />
      <TourOverlay />
      <TourReminder />
      <TourInviteModal />
    </HelpProvider>
    </JobProvider>
  );
}

export default function App() {
  const { data: config, isLoading } = useQuery({
    queryKey: ["config"],
    queryFn: api.config.get,
    staleTime: Infinity,
  });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center">
        <span className="material-symbols-outlined animate-spin text-primary text-3xl">
          progress_activity
        </span>
      </div>
    );
  }

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/request-account" element={<RequestAccountPage />} />
      <Route
        path="/setup"
        element={
          config?.setup_required ? <SetupPage /> : <Navigate to="/" replace />
        }
      />
      <Route
        path="/*"
        element={
          config?.setup_required ? (
            <Navigate to="/setup" replace />
          ) : (
            <ProtectedRoute>
              <AuthenticatedLayout />
            </ProtectedRoute>
          )
        }
      />
    </Routes>
  );
}
