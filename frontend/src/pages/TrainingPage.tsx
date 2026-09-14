import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api, Skater, WeeklyReview, TrainingChallenge } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import MoodAggregateWidget from "../components/MoodAggregateWidget";

function SkaterCard({ skater, lastReview }: { skater: Skater; lastReview?: WeeklyReview }) {
  const avgScore = lastReview
    ? ((lastReview.engagement + lastReview.progression + lastReview.attitude) / 3).toFixed(1)
    : null;

  return (
    <Link
      to={`/entrainement/patineurs/${skater.id}`}
      className="bg-surface-container-low rounded-2xl p-5 hover:bg-surface-container transition-colors"
    >
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-headline font-bold text-on-surface">
            {skater.first_name} {skater.last_name}
          </h3>
        </div>
        {avgScore && (
          <div className="text-right">
            <span className="font-mono text-lg font-bold text-primary">{avgScore}</span>
            <p className="text-[10px] text-on-surface-variant uppercase">Moy.</p>
          </div>
        )}
      </div>
      {lastReview && (
        <p className="text-xs text-on-surface-variant mt-2">
          Dernier retour : semaine du {new Date(lastReview.week_start).toLocaleDateString("fr-FR")}
        </p>
      )}
    </Link>
  );
}

export default function TrainingPage() {
  const { user } = useAuth();

  // Week bounds for mood aggregate
  const now = new Date();
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const prevMonday = new Date(monday);
  prevMonday.setDate(monday.getDate() - 7);
  const prevSunday = new Date(monday);
  prevSunday.setDate(monday.getDate() - 1);

  const { data: skaters, isLoading: skatersLoading } = useQuery({
    queryKey: ["skaters", "training_tracked"],
    queryFn: () => api.skaters.list({ training_tracked: true }),
  });

  const { data: reviews } = useQuery({
    queryKey: ["training", "reviews", "latest"],
    queryFn: () => api.training.reviews.list(),
  });

  const { data: activeChallenges } = useQuery({
    queryKey: ["training", "challenges", "active"],
    queryFn: () => api.training.challenges.list({ active: true }),
  });

  if (skatersLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <span className="material-symbols-outlined animate-spin text-primary text-3xl">
          progress_activity
        </span>
      </div>
    );
  }

  // Build map of latest review per skater
  const latestReview: Record<number, WeeklyReview> = {};
  if (reviews) {
    for (const r of reviews) {
      if (!latestReview[r.skater_id] || r.week_start > latestReview[r.skater_id].week_start) {
        latestReview[r.skater_id] = r;
      }
    }
  }

  // Build skater name map for challenges
  const skaterMap: Record<number, Skater> = {};
  if (skaters) {
    for (const s of skaters) skaterMap[s.id] = s;
  }

  // Sort active challenges by target_date ascending (soonest first)
  const sortedChallenges = [...(activeChallenges ?? [])].sort(
    (a, b) => a.target_date.localeCompare(b.target_date)
  );

  return (
    <div data-tour="entrainement-contenu" className="space-y-6">
      {(user?.role === "admin" || user?.role === "coach") && (
        <MoodAggregateWidget
          currentWeekStart={monday.toISOString().slice(0, 10)}
          currentWeekEnd={sunday.toISOString().slice(0, 10)}
          previousWeekStart={prevMonday.toISOString().slice(0, 10)}
          previousWeekEnd={prevSunday.toISOString().slice(0, 10)}
        />
      )}
      <div>
        <p className="text-on-surface-variant text-sm mb-3">
          {skaters?.length ?? 0} patineur{(skaters?.length ?? 0) > 1 ? "s" : ""}
        </p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 max-h-[60vh] overflow-y-auto pr-1">
          {skaters?.map((s) => (
            <SkaterCard key={s.id} skater={s} lastReview={latestReview[s.id]} />
          ))}
        </div>
      </div>

      {sortedChallenges.length > 0 && (
        <section>
          <h2 className="font-headline font-bold text-on-surface text-lg mb-3">
            Défis en cours
          </h2>
          <div className="space-y-2">
            {sortedChallenges.map((c) => {
              const skater = skaterMap[c.skater_id];
              const targetDate = new Date(c.target_date).toLocaleDateString("fr-FR", {
                day: "numeric",
                month: "long",
              });
              return (
                <Link
                  key={c.id}
                  to={`/entrainement/patineurs/${c.skater_id}`}
                  className="flex items-center gap-4 bg-surface-container-low rounded-2xl p-4 hover:bg-surface-container transition-colors"
                >
                  <span className="material-symbols-outlined text-primary">flag</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-on-surface font-medium truncate">{c.objective}</p>
                    <p className="text-xs text-on-surface-variant">
                      {skater ? `${skater.first_name} ${skater.last_name}` : "—"} · Échéance : {targetDate}
                    </p>
                  </div>
                  <div className="flex gap-0.5 shrink-0">
                    {Array.from({ length: 5 }, (_, i) => (
                      <div
                        key={i}
                        className={`w-2 h-2 rounded-full ${
                          i < c.score ? "bg-primary" : "bg-surface-container"
                        }`}
                      />
                    ))}
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
