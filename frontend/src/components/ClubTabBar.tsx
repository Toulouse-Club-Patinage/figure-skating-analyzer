import { Link, useLocation } from "react-router-dom";

const tabs = [
  { to: "/club/saison", label: "Saison" },
  { to: "/club/competition", label: "Compétition" },
];

export default function ClubTabBar() {
  const { pathname } = useLocation();
  return (
    <div data-tour="club-onglets" className="flex gap-0 mb-6">
      {tabs.map((tab) => {
        const active = pathname.startsWith(tab.to);
        return (
          <Link
            key={tab.to}
            to={tab.to}
            className={`px-5 py-2 text-sm font-semibold transition-colors border-b-2 ${
              active
                ? "text-primary border-primary"
                : "text-on-surface-variant border-transparent hover:text-on-surface"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
