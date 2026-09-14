import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import yaml from "js-yaml";
import { api, type UserRecord, type ImportResult, type Skater } from "../api/client";
import { countryFlag } from "../utils/countryFlags";
import { useJobs, type Lot } from "../contexts/JobContext";
import AdminJobsTab from "../components/AdminJobsTab";
import MediansModal from "../components/MediansModal";

const REQUEST_STATUS_LABELS: Record<string, string> = {
  created: "Compte créé",
  already_linked: "Déjà rattaché",
  pending_admin: "En attente de validation",
  rejected: "Refusée",
  expired: "Expirée",
};

const inputCls =
  "w-full px-3 py-2 bg-surface-container-low rounded-xl text-on-surface text-sm focus:outline-none focus:ring-2 focus:ring-primary";

function parseUTC(iso: string): Date {
  // Backend returns naive ISO strings (no Z suffix) that are actually UTC
  return new Date(iso.endsWith("Z") ? iso : iso + "Z");
}

function formatRelativeTime(isoDate: string): string {
  const date = parseUTC(isoDate);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);
  const diffMonth = Math.floor(diffDay / 30);

  if (diffSec < 60) return "à l'instant";
  if (diffMin < 60) return `il y a ${diffMin} min`;
  if (diffHour < 24) return `il y a ${diffHour} h`;
  if (diffDay < 30) return `il y a ${diffDay} j`;
  return `il y a ${diffMonth} mois`;
}

function formatFullDate(isoDate: string): string {
  return parseUTC(isoDate).toLocaleString("fr-FR", {
    dateStyle: "long",
    timeStyle: "short",
  });
}

function SkaterPicker({
  selectedIds,
  onChange,
  club,
}: {
  selectedIds: number[];
  onChange: (ids: number[]) => void;
  club?: string;
}) {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const { data: results } = useQuery({
    queryKey: ["skaters", "search", debouncedSearch, club],
    queryFn: () => api.skaters.list({ search: debouncedSearch, club }),
    enabled: debouncedSearch.length >= 2,
  });

  const { data: allSkaters } = useQuery({
    queryKey: ["skaters", "all", club],
    queryFn: () => api.skaters.list({ club }),
  });

  const selectedSkaters = allSkaters?.filter((s) => selectedIds.includes(s.id)) ?? [];

  return (
    <div className="space-y-2">
      <label className="text-xs font-bold text-on-surface-variant uppercase tracking-wider">
        Patineurs associés
      </label>
      {selectedSkaters.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {selectedSkaters.map((s) => (
            <span
              key={s.id}
              className="inline-flex items-center gap-1 bg-primary/10 text-primary text-xs px-2 py-1 rounded-full"
            >
              {s.first_name} {s.last_name}
              <button
                type="button"
                onClick={() => onChange(selectedIds.filter((id) => id !== s.id))}
                className="hover:text-error"
              >
                <span className="material-symbols-outlined text-sm">close</span>
              </button>
            </span>
          ))}
        </div>
      )}
      <input
        placeholder="Rechercher un patineur..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className={inputCls}
      />
      {results && results.length > 0 && search.length >= 2 && (
        <div className="bg-surface-container rounded-lg shadow-md max-h-40 overflow-y-auto">
          {results
            .filter((s) => !selectedIds.includes(s.id))
            .map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => {
                  onChange([...selectedIds, s.id]);
                  setSearch("");
                }}
                className="w-full text-left px-3 py-2 text-sm hover:bg-surface-container-high transition-colors"
              >
                {s.first_name} {s.last_name}
                {s.club && (
                  <span className="text-on-surface-variant ml-2 text-xs">({s.club})</span>
                )}
              </button>
            ))}
        </div>
      )}
    </div>
  );
}

export default function SettingsPage() {
  const qc = useQueryClient();
  const { data: config, dataUpdatedAt } = useQuery({
    queryKey: ["config"],
    queryFn: api.config.get,
    staleTime: Infinity,
  });
  const logoSrc = config?.logo_url ? `${config.logo_url}?v=${dataUpdatedAt}` : "";

  const toggleTrainingModule = useMutation({
    mutationFn: (enabled: boolean) => api.config.update({ training_enabled: enabled }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["config"] });
    },
  });
  const { data: users = [] } = useQuery({
    queryKey: ["users"],
    queryFn: api.users.list,
  });
  const { data: domains = [] } = useQuery({
    queryKey: ["domains"],
    queryFn: api.domains.list,
  });

  // --- Job context for bulk import ---
  const { lots, setLots, bulkJobs, lotJobIds, trackBulkJobs, clearBulk } = useJobs();

  // --- Club settings ---
  const [clubName, setClubName] = useState("");
  const [clubShort, setClubShort] = useState("");
  const [clubSaved, setClubSaved] = useState(false);

  useEffect(() => {
    if (config) {
      setClubName(config.club_name || "");
      setClubShort(config.club_short || "");
    }
  }, [config]);

  const updateConfig = useMutation({
    mutationFn: () =>
      api.config.update({ club_name: clubName, club_short: clubShort }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["config"] });
      setClubSaved(true);
      setTimeout(() => setClubSaved(false), 2000);
    },
  });

  // --- Logo upload ---
  const fileRef = useRef<HTMLInputElement>(null);
  const uploadLogo = useMutation({
    mutationFn: (file: File) => api.config.uploadLogo(file),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["config"] });
    },
  });

  // --- Users ---
  const [showAddUser, setShowAddUser] = useState(false);
  const [newUser, setNewUser] = useState({
    email: "",
    display_name: "",
    role: "reader",
    password: "",
    must_change_password: false,
    skater_ids: [] as number[],
  });
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [editData, setEditData] = useState<{ role: UserRecord["role"]; skater_ids: number[]; display_name: string }>({ role: "reader", skater_ids: [], display_name: "" });

  const createUser = useMutation({
    mutationFn: () => api.users.create(newUser),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["users"] });
      setShowAddUser(false);
      setNewUser({ email: "", display_name: "", role: "reader", password: "", must_change_password: false, skater_ids: [] });
    },
  });

  const toggleActive = useMutation({
    mutationFn: (user: UserRecord) =>
      api.users.update(user.id, { is_active: !user.is_active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["users"] }),
  });

  const updateUser = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<UserRecord> }) =>
      api.users.update(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["users"] });
      setEditingUserId(null);
    },
  });

  const deleteUser = useMutation({
    mutationFn: (id: string) => api.users.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["users"] });
      setConfirmingDeleteId(null);
    },
  });

  // --- Domains ---
  const [newDomain, setNewDomain] = useState("");

  const addDomain = useMutation({
    mutationFn: () => api.domains.create(newDomain),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["domains"] });
      setNewDomain("");
    },
  });

  const removeDomain = useMutation({
    mutationFn: (id: string) => api.domains.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["domains"] }),
  });

  // --- Bulk import ---
  const yamlRef = useRef<HTMLInputElement>(null);

  const handleYamlUpload = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const parsed = yaml.load(e.target?.result as string) as Record<string, unknown>[];
        const newLots: Lot[] = parsed.map((item: Record<string, unknown>) => ({
          name: (item.name as string) || "Sans nom",
          urls: (item.urls as string[]) || [],
          season: item.season as string | undefined,
          discipline: item.discipline as string | undefined,
        }));
        clearBulk();
        setLots(newLots);
      } catch {
        alert("Fichier YAML invalide");
      }
    };
    reader.readAsText(file);
  };

  const bulkImportMutation = useMutation({
    mutationFn: (params: { lot: Lot; enrich: boolean }) =>
      api.competitions.bulkImport({
        lot_name: params.lot.name,
        urls: params.lot.urls,
        enrich: params.enrich,
        season: params.lot.season,
        discipline: params.lot.discipline,
      }),
    onSuccess: (result, variables) => {
      trackBulkJobs(variables.lot.name, result.job_ids);
    },
  });

  // Helper: submit all lots
  const importAllLots = (enrich: boolean) => {
    for (const lot of lots) {
      bulkImportMutation.mutate({ lot, enrich });
    }
  };

  // --- Tabs ---
  const [activeTab, setActiveTab] = useState<"general" | "users" | "training" | "jobs">("general");

  // --- Default team medians ---
  const [showMediansModal, setShowMediansModal] = useState(false);
  const { data: defaultMediansData } = useQuery({
    queryKey: ["default-team-medians"],
    queryFn: () => api.config.defaultTeamMedians.get(),
  });
  const saveDefaultMedians = useMutation({
    mutationFn: (medians: Record<string, Record<string, number>>) =>
      api.config.defaultTeamMedians.update(medians),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["default-team-medians"] });
      setShowMediansModal(false);
    },
  });

  useEffect(() => {
    if (activeTab === "training" && !config?.training_enabled) {
      setActiveTab("general");
    }
  }, [config?.training_enabled, activeTab]);

  // --- Training onboarding ---
  const { data: trackedSkaters, isLoading: loadingTracked } = useQuery({
    queryKey: ["skaters", "training_tracked"],
    queryFn: () => api.skaters.list({ training_tracked: true }),
  });
  const [addSkaterMode, setAddSkaterMode] = useState<null | "choose" | "create" | "existing">(null);
  const [newSkater, setNewSkater] = useState({ first_name: "", last_name: "", nationality: "", club: config?.club_short ?? "" });
  const [clearingTrainingId, setClearingTrainingId] = useState<number | null>(null);
  const [onboardSearch, setOnboardSearch] = useState("");
  const [debouncedOnboardSearch, setDebouncedOnboardSearch] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedOnboardSearch(onboardSearch), 300);
    return () => clearTimeout(timer);
  }, [onboardSearch]);

  const { data: onboardResults } = useQuery({
    queryKey: ["skaters", "onboard-search", debouncedOnboardSearch],
    queryFn: () => api.skaters.list({ search: debouncedOnboardSearch }),
    enabled: debouncedOnboardSearch.length >= 2,
  });

  const onboardSkaterMutation = useMutation({
    mutationFn: (id: number) => api.skaters.update(id, { training_tracked: true }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["skaters"] });
      setOnboardSearch("");
      setAddSkaterMode(null);
    },
  });

  const createSkaterMutation = useMutation({
    mutationFn: () => api.skaters.create({
      first_name: newSkater.first_name.trim(),
      last_name: newSkater.last_name.trim(),
      nationality: newSkater.nationality.trim() || undefined,
      club: newSkater.club.trim() || undefined,
    }),
    onSuccess: () => {
      setNewSkater({ first_name: "", last_name: "", nationality: "", club: config?.club_short ?? "" });
      setAddSkaterMode(null);
      qc.invalidateQueries({ queryKey: ["skaters"] });
    },
  });

  const removeTrackingMutation = useMutation({
    mutationFn: (id: number) => api.skaters.update(id, { training_tracked: false }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["skaters"] }),
  });

  const clearTrainingDataMutation = useMutation({
    mutationFn: (id: number) => api.skaters.clearTrainingData(id),
    onSuccess: () => {
      setClearingTrainingId(null);
      qc.invalidateQueries({ queryKey: ["training"] });
    },
  });

  // --- Database reset ---
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [resetConfirmText, setResetConfirmText] = useState("");
  const resetMutation = useMutation({
    mutationFn: () => api.admin.resetDatabase(),
    onSuccess: () => {
      setShowResetConfirm(false);
      setResetConfirmText("");
      qc.invalidateQueries();
    },
  });

  const recalcClubsMutation = useMutation({
    mutationFn: () => api.admin.recalculateClubs(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["skaters"] }),
  });

  // --- Skater merge ---
  const [mergeSearch, setMergeSearch] = useState("");
  const [debouncedMergeSearch, setDebouncedMergeSearch] = useState("");
  const [mergeSelected, setMergeSelected] = useState<Skater[]>([]);
  const [mergeTargetId, setMergeTargetId] = useState<number | null>(null);
  const [showMergeConfirm, setShowMergeConfirm] = useState(false);
  const [mergeSuccess, setMergeSuccess] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedMergeSearch(mergeSearch), 300);
    return () => clearTimeout(timer);
  }, [mergeSearch]);

  const { data: mergeResults } = useQuery({
    queryKey: ["skaters", "merge-search", debouncedMergeSearch],
    queryFn: () => api.skaters.list({ search: debouncedMergeSearch }),
    enabled: debouncedMergeSearch.length >= 2,
  });

  // --- SMTP settings ---
  const { data: smtpData } = useQuery({
    queryKey: ["smtp-settings"],
    queryFn: api.config.smtp.get,
    enabled: !!config,
  });
  const [smtpHost, setSmtpHost] = useState("");
  const [smtpPort, setSmtpPort] = useState("587");
  const [smtpUser, setSmtpUser] = useState("");
  const [smtpPassword, setSmtpPassword] = useState("");
  const [smtpFrom, setSmtpFrom] = useState("");
  const [smtpFromName, setSmtpFromName] = useState("");
  const [supportEmail, setSupportEmail] = useState("");
  const [smtpLoaded, setSmtpLoaded] = useState(false);

  useEffect(() => {
    if (smtpData && !smtpLoaded) {
      setSmtpHost(smtpData.smtp_host);
      setSmtpPort(String(smtpData.smtp_port));
      setSmtpUser(smtpData.smtp_user);
      setSmtpFrom(smtpData.smtp_from);
      setSmtpFromName(smtpData.smtp_from_name);
      setSupportEmail(smtpData.support_email ?? "");
      setSmtpLoaded(true);
    }
  }, [smtpData, smtpLoaded]);

  const smtpMutation = useMutation({
    mutationFn: () =>
      api.config.smtp.update({
        smtp_host: smtpHost,
        smtp_port: parseInt(smtpPort) || 587,
        smtp_user: smtpUser,
        ...(smtpPassword ? { smtp_password: smtpPassword } : {}),
        smtp_from: smtpFrom,
        smtp_from_name: smtpFromName,
        support_email: supportEmail,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["smtp-settings"] });
      qc.invalidateQueries({ queryKey: ["config"] });
      setSmtpPassword("");
    },
  });

  // --- Demandes de compte (French Ranking) ---
  const [frUrl, setFrUrl] = useState("");
  const [frEnabled, setFrEnabled] = useState(false);
  const [frClubNames, setFrClubNames] = useState("");
  const [frLoaded, setFrLoaded] = useState(false);

  useEffect(() => {
    if (config && !frLoaded) {
      setFrUrl(config.french_ranking_url ?? "");
      setFrEnabled(!!config.account_requests_enabled);
      setFrClubNames((config.french_ranking_club_names ?? []).join("\n"));
      setFrLoaded(true);
    }
  }, [config, frLoaded]);

  const frMutation = useMutation({
    mutationFn: () =>
      api.config.update({
        french_ranking_url: frUrl,
        account_requests_enabled: frEnabled,
        french_ranking_club_names: frClubNames
          .split("\n")
          .map((n) => n.trim())
          .filter(Boolean),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["config"] });
      qc.invalidateQueries({ queryKey: ["account-requests-enabled"] });
    },
  });

  const { data: accountRequests = [] } = useQuery({
    queryKey: ["account-requests"],
    queryFn: api.admin.accountRequests.list,
    enabled: !!config,
  });

  const { data: skatersForApproval = [] } = useQuery({
    queryKey: ["skaters-for-approval"],
    queryFn: () => api.skaters.list(),
    enabled: !!config,
  });

  const [approveSelection, setApproveSelection] = useState<Record<number, string>>({});

  const approveRequest = useMutation({
    mutationFn: ({ id, skaterId }: { id: number; skaterId: number }) =>
      api.admin.accountRequests.approve(id, [skaterId]),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["account-requests"] });
      qc.invalidateQueries({ queryKey: ["users"] });
    },
  });

  const [smtpTestResult, setSmtpTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const smtpTestMutation = useMutation({
    mutationFn: () => api.config.smtp.test(),
    onSuccess: (data) => setSmtpTestResult(data),
    onError: (err) => setSmtpTestResult({ success: false, message: String(err) }),
  });

  const mergeMutation = useMutation({
    mutationFn: () => {
      const sourceIds = mergeSelected
        .filter((s) => s.id !== mergeTargetId)
        .map((s) => s.id);
      return api.skaters.merge(mergeTargetId!, sourceIds);
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["skaters"] });
      setMergeSelected([]);
      setMergeTargetId(null);
      setShowMergeConfirm(false);
      setMergeSuccess(`${data.merged} patineur(s) fusionné(s)`);
      setTimeout(() => setMergeSuccess(""), 3000);
    },
  });

  return (
    <div className="space-y-6">
      {/* Tab bar */}
      <div className="flex gap-0 mb-2">
        <button
          onClick={() => { setActiveTab("general"); window.scrollTo(0, 0); }}
          className={`px-5 py-2 text-sm font-semibold transition-colors border-b-2 ${
            activeTab === "general"
              ? "text-primary border-primary"
              : "text-on-surface-variant border-transparent hover:text-on-surface"
          }`}
        >
          Général
        </button>
        <button
          onClick={() => { setActiveTab("users"); window.scrollTo(0, 0); }}
          className={`px-5 py-2 text-sm font-semibold transition-colors border-b-2 ${
            activeTab === "users"
              ? "text-primary border-primary"
              : "text-on-surface-variant border-transparent hover:text-on-surface"
          }`}
        >
          Utilisateurs
        </button>
        {config?.training_enabled && (
          <button
            onClick={() => { setActiveTab("training"); window.scrollTo(0, 0); }}
            className={`px-5 py-2 text-sm font-semibold transition-colors border-b-2 ${
              activeTab === "training"
                ? "text-primary border-primary"
                : "text-on-surface-variant border-transparent hover:text-on-surface"
            }`}
          >
            Entraînement
          </button>
        )}
        <button
          onClick={() => { setActiveTab("jobs"); window.scrollTo(0, 0); }}
          className={`px-5 py-2 text-sm font-semibold transition-colors border-b-2 ${
            activeTab === "jobs"
              ? "text-primary border-primary"
              : "text-on-surface-variant border-transparent hover:text-on-surface"
          }`}
        >
          Tâches
        </button>
      </div>

      {activeTab === "general" && (
      <div className="space-y-8">
      {/* Club settings */}
      <section className="bg-surface-container-lowest rounded-2xl p-6 shadow-arctic">
        <h2 className="font-headline font-bold text-on-surface text-lg mb-4">
          Paramètres du club
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-lg">
          <div>
            <label className="block text-xs font-label font-medium text-on-surface-variant mb-1">
              Nom du club
            </label>
            <input
              value={clubName}
              onChange={(e) => setClubName(e.target.value)}
              className={inputCls}
            />
          </div>
          <div>
            <label className="block text-xs font-label font-medium text-on-surface-variant mb-1">
              Abréviation
            </label>
            <input
              value={clubShort}
              onChange={(e) => setClubShort(e.target.value)}
              className={inputCls}
            />
          </div>
        </div>
        <button
          onClick={() => updateConfig.mutate()}
          className="mt-4 px-4 py-2 bg-primary text-on-primary rounded-xl text-sm font-bold hover:bg-primary/90 transition-colors"
        >
          {clubSaved ? "Enregistré ✓" : "Enregistrer"}
        </button>

        {/* Logo upload */}
        <div className="mt-6 pt-5 border-t border-outline-variant/30">
          <label className="block text-xs font-label font-medium text-on-surface-variant mb-2">
            Logo du club
          </label>
          <div className="flex items-center gap-4">
            {logoSrc ? (
              <img
                src={logoSrc}
                alt="Logo"
                className="w-12 h-12 object-contain rounded-lg bg-surface-container-low p-1"
              />
            ) : (
              <div className="w-12 h-12 rounded-lg bg-surface-container-low flex items-center justify-center">
                <span className="material-symbols-outlined text-on-surface-variant">image</span>
              </div>
            )}
            <div>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) uploadLogo.mutate(file);
                }}
              />
              <button
                onClick={() => fileRef.current?.click()}
                disabled={uploadLogo.isPending}
                className="px-3 py-1.5 bg-surface-container text-on-surface-variant rounded-xl text-xs font-bold hover:bg-surface-container-high transition-colors disabled:opacity-50"
              >
                {uploadLogo.isPending ? "Envoi..." : "Changer le logo"}
              </button>
              {uploadLogo.isError && (
                <p className="text-error text-xs mt-1">{String(uploadLogo.error)}</p>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Module entraînement toggle */}
      <section className="bg-surface-container-lowest rounded-2xl p-6 shadow-arctic">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-headline font-bold text-on-surface text-base">
              Module entraînement
            </h2>
            <p className="text-sm text-on-surface-variant mt-1">
              Active le suivi d'entraînement des patineurs (retours hebdomadaires, défis, incidents)
            </p>
          </div>
          <button
            onClick={() => toggleTrainingModule.mutate(!config?.training_enabled)}
            disabled={toggleTrainingModule.isPending}
            className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors ${
              config?.training_enabled ? "bg-primary" : "bg-on-surface/20"
            }`}
          >
            <span
              className={`inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${
                config?.training_enabled ? "translate-x-6" : "translate-x-1"
              }`}
            />
          </button>
        </div>
      </section>

      {/* Domains */}
      <section className="bg-surface-container-lowest rounded-2xl p-6 shadow-arctic">
        <h2 className="font-headline font-bold text-on-surface text-lg mb-4">
          Domaines autorisés
        </h2>
        <p className="text-on-surface-variant text-xs mb-3">
          Les utilisateurs avec un email correspondant à ces domaines peuvent se
          connecter via Google et seront automatiquement créés en tant que
          lecteurs.
        </p>
        <div className="space-y-2 mb-4">
          {domains.map((d) => (
            <div
              key={d.id}
              className="flex items-center justify-between p-2 bg-surface-container-low rounded-xl"
            >
              <span className="text-on-surface text-sm font-mono">
                @{d.domain}
              </span>
              <button
                onClick={() => removeDomain.mutate(d.id)}
                className="text-error text-xs hover:bg-error-container rounded-lg px-2 py-1"
              >
                <span className="material-symbols-outlined text-sm">
                  delete
                </span>
              </button>
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            placeholder="exemple.fr"
            value={newDomain}
            onChange={(e) => setNewDomain(e.target.value)}
            className={inputCls + " max-w-xs"}
          />
          <button
            onClick={() => addDomain.mutate()}
            className="px-4 py-2 bg-primary text-on-primary rounded-xl text-sm font-bold"
          >
            Ajouter
          </button>
        </div>
      </section>

      {/* Bulk import */}
      <section className="bg-surface-container-lowest rounded-2xl p-6 shadow-arctic">
        <h2 className="font-headline font-bold text-on-surface text-lg mb-4">
          Import par lots
        </h2>
        <p className="text-on-surface-variant text-xs mb-3">
          Chargez un fichier YAML contenant des lots de compétitions à importer.
          Format attendu :
        </p>
        <pre className="text-xs text-on-surface-variant bg-surface-container-low rounded-xl p-3 mb-4 font-mono overflow-x-auto">
{`- name: "CSNPA Automne 2025"
  season: "2025-2026"
  urls:
    - https://example.com/comp1/index.htm
    - https://example.com/comp2/index.htm

- name: "Coupes régionales 2026"
  urls:
    - https://example.com/comp3/index.htm`}
        </pre>

        <div className="mb-4">
          <input
            ref={yamlRef}
            type="file"
            accept=".yaml,.yml"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleYamlUpload(file);
            }}
          />
          <button
            onClick={() => yamlRef.current?.click()}
            className="px-4 py-2 bg-primary text-on-primary rounded-xl text-sm font-bold hover:bg-primary/90 transition-colors flex items-center gap-2"
          >
            <span className="material-symbols-outlined text-sm">upload_file</span>
            Charger un fichier YAML
          </button>
        </div>

        {lots.length > 0 && (
          <div className="space-y-3">
            {/* Global actions */}
            <div className="flex gap-2 mb-2">
              <button
                onClick={() => importAllLots(false)}
                disabled={bulkImportMutation.isPending}
                className="px-4 py-2 bg-primary text-on-primary rounded-xl text-sm font-bold hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                <span className="material-symbols-outlined text-sm">download</span>
                Tout importer
              </button>
              <button
                onClick={() => importAllLots(true)}
                disabled={bulkImportMutation.isPending}
                className="px-4 py-2 bg-surface-container text-on-surface-variant rounded-xl text-sm font-bold hover:bg-surface-container-high transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                <span className="material-symbols-outlined text-sm">description</span>
                Tout importer + PDF
              </button>
            </div>

            {lots.map((lot) => {
              const jobIds = lotJobIds[lot.name] || [];
              const jobs = jobIds.map((jid) => bulkJobs[jid]).filter(Boolean);
              const hasActiveJobs = jobs.some((j) => j.status === "queued" || j.status === "running");
              const completedJobs = jobs.filter((j) => j.status === "completed" || j.status === "failed");
              const failedJobs = jobs.filter((j) => j.status === "failed");
              const partialJobs = jobs.filter((j) => {
                if (j.status !== "completed" || !j.result) return false;
                const r = j.result as ImportResult;
                return r.errors && r.errors.length > 0;
              });

              return (
                <div
                  key={lot.name}
                  className="p-4 bg-surface-container-low rounded-xl"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                    <div>
                      <span className="font-bold text-on-surface text-sm">
                        {lot.name}
                      </span>
                      <span className="text-on-surface-variant text-xs ml-2">
                        {lot.urls.length} compétition{lot.urls.length > 1 ? "s" : ""}
                        {lot.season && ` · ${lot.season}`}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={() => bulkImportMutation.mutate({ lot, enrich: false })}
                        disabled={hasActiveJobs}
                        className="px-3 py-1.5 bg-primary text-on-primary rounded-xl text-xs font-bold hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center gap-1"
                      >
                        <span className="material-symbols-outlined text-sm">download</span>
                        {hasActiveJobs ? "En cours..." : "Importer"}
                      </button>
                      <button
                        onClick={() => bulkImportMutation.mutate({ lot, enrich: true })}
                        disabled={hasActiveJobs}
                        className="px-3 py-1.5 bg-surface-container text-on-surface-variant rounded-xl text-xs font-bold hover:bg-surface-container-high transition-colors disabled:opacity-50 flex items-center gap-1"
                      >
                        <span className="material-symbols-outlined text-sm">description</span>
                        {hasActiveJobs ? "En cours..." : "Importer + PDF"}
                      </button>
                    </div>
                  </div>

                  {/* Progress / Result */}
                  {jobs.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-outline-variant/30">
                      <div className="flex items-center gap-2">
                        <span
                          className={`inline-block w-2 h-2 rounded-full ${
                            hasActiveJobs
                              ? "bg-on-surface-variant animate-pulse"
                              : failedJobs.length > 0
                                ? "bg-error"
                                : "bg-primary"
                          }`}
                        />
                        <span className="text-xs font-medium text-on-surface">
                          {hasActiveJobs
                            ? `${completedJobs.length}/${jobs.length} tâches terminées`
                            : failedJobs.length > 0
                              ? `${completedJobs.length - failedJobs.length}/${jobs.length} réussies · ${failedJobs.length} échec(s)${partialJobs.length > 0 ? ` · ${partialJobs.length} avec avertissements` : ""}`
                              : partialJobs.length > 0
                                ? `${completedJobs.length}/${jobs.length} réussies · ${partialJobs.length} avec avertissements`
                                : `${completedJobs.length}/${jobs.length} tâches terminées`}
                        </span>
                      </div>

                      {/* Error details for failed jobs */}
                      {failedJobs.length > 0 && !hasActiveJobs && (
                        <div className="mt-2 space-y-1">
                          {failedJobs.map((j) => (
                            <div
                              key={j.id}
                              className="bg-error-container/20 rounded-lg p-3"
                            >
                              <p className="text-xs font-medium text-on-surface mb-1">
                                {lot.urls[jobIds.indexOf(j.id)] || `Tâche ${j.id.slice(0, 8)}`}
                              </p>
                              <pre className="text-xs text-error/80 font-mono whitespace-pre-wrap break-all">
                                {j.error || "Erreur inconnue"}
                              </pre>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Partial errors from completed jobs */}
                      {partialJobs.length > 0 && !hasActiveJobs && (
                        <div className="mt-2 space-y-1">
                          {partialJobs.map((j) => {
                            const r = j.result as ImportResult;
                            return (
                              <div
                                key={j.id}
                                className="bg-surface-container rounded-lg p-3"
                              >
                                <p className="text-xs font-medium text-on-surface mb-1">
                                  {lot.urls[jobIds.indexOf(j.id)] || `Tâche ${j.id.slice(0, 8)}`}
                                  <span className="text-on-surface-variant ml-1">
                                    — {r.errors.length} erreur(s) partielle(s)
                                  </span>
                                </p>
                                {r.errors.map((e, i) => (
                                  <p key={i} className="text-xs text-error/80 ml-2">
                                    <span className="font-medium text-on-surface">{e.skater}</span>{" "}
                                    {e.error}
                                  </p>
                                ))}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Skater merge */}
      <section className="bg-surface-container-lowest rounded-2xl p-6 shadow-arctic">
        <h2 className="font-headline font-bold text-on-surface text-lg mb-2">
          Fusionner des patineurs
        </h2>
        <p className="text-on-surface-variant text-xs mb-4">
          Regroupez les scores de patineurs en doublon (nom différent, même personne).
        </p>

        {mergeSuccess && (
          <div className="mb-4 px-4 py-2 bg-primary/10 text-primary text-sm rounded-xl font-medium">
            {mergeSuccess}
          </div>
        )}

        {/* Search */}
        <div className="relative max-w-sm">
          <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant text-[18px] pointer-events-none">
            search
          </span>
          <input
            placeholder="Rechercher un patineur…"
            value={mergeSearch}
            onChange={(e) => setMergeSearch(e.target.value)}
            className="w-full bg-surface-container-high rounded-full py-2 pl-10 pr-4 text-sm font-body text-on-surface focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>

        {/* Search results */}
        {mergeResults && mergeSearch.length >= 2 && (
          <div className="mt-2 bg-surface-container rounded-lg shadow-md max-h-40 overflow-y-auto max-w-sm">
            {mergeResults
              .filter((s) => !mergeSelected.some((sel) => sel.id === s.id))
              .map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => {
                    const updated = [...mergeSelected, s];
                    setMergeSelected(updated);
                    if (!mergeTargetId) setMergeTargetId(s.id);
                    setMergeSearch("");
                  }}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-surface-container-high transition-colors"
                >
                  {s.first_name} {s.last_name}
                  {s.club && (
                    <span className="text-on-surface-variant ml-2 text-xs">({s.club})</span>
                  )}
                </button>
              ))}
            {mergeResults.filter((s) => !mergeSelected.some((sel) => sel.id === s.id)).length === 0 && (
              <p className="px-3 py-2 text-xs text-on-surface-variant">Aucun résultat</p>
            )}
          </div>
        )}

        {/* Selected skaters */}
        {mergeSelected.length > 0 && (
          <div className="mt-4 space-y-2">
            <label className="text-xs font-bold text-on-surface-variant uppercase tracking-wider">
              Patineurs sélectionnés — choisissez le patineur principal
            </label>
            {mergeSelected.map((s) => (
              <div
                key={s.id}
                className="flex items-center gap-3 p-2 bg-surface-container-low rounded-xl"
              >
                <input
                  type="radio"
                  name="merge-target"
                  checked={mergeTargetId === s.id}
                  onChange={() => setMergeTargetId(s.id)}
                  className="accent-primary"
                />
                <span className="text-sm text-on-surface font-medium">
                  {s.first_name} {s.last_name}
                </span>
                {s.club && (
                  <span className="text-xs text-on-surface-variant">({s.club})</span>
                )}
                <button
                  type="button"
                  onClick={() => {
                    const updated = mergeSelected.filter((sel) => sel.id !== s.id);
                    setMergeSelected(updated);
                    if (mergeTargetId === s.id) {
                      setMergeTargetId(updated[0]?.id ?? null);
                    }
                  }}
                  className="ml-auto text-on-surface-variant hover:text-error"
                >
                  <span className="material-symbols-outlined text-sm">close</span>
                </button>
              </div>
            ))}

            {mergeSelected.length >= 2 && (
              <div className="mt-3">
                {showMergeConfirm ? (
                  <div className="p-3 bg-surface-container rounded-xl space-y-3">
                    <p className="text-sm text-on-surface">
                      Fusionner {mergeSelected.length} patineurs en{" "}
                      <strong>
                        {mergeSelected.find((s) => s.id === mergeTargetId)?.first_name}{" "}
                        {mergeSelected.find((s) => s.id === mergeTargetId)?.last_name}
                      </strong>{" "}
                      ? Les scores seront regroupés.
                    </p>
                    <div className="flex gap-2">
                      <button
                        onClick={() => mergeMutation.mutate()}
                        disabled={mergeMutation.isPending}
                        className="px-4 py-2 bg-primary text-on-primary rounded-xl text-sm font-bold hover:bg-primary/90 transition-colors disabled:opacity-50"
                      >
                        {mergeMutation.isPending ? "Fusion..." : "Confirmer"}
                      </button>
                      <button
                        onClick={() => setShowMergeConfirm(false)}
                        className="px-4 py-2 text-on-surface-variant text-sm"
                      >
                        Annuler
                      </button>
                    </div>
                    {mergeMutation.isError && (
                      <p className="text-error text-xs">{String(mergeMutation.error)}</p>
                    )}
                  </div>
                ) : (
                  <button
                    onClick={() => setShowMergeConfirm(true)}
                    className="px-4 py-2 bg-primary text-on-primary rounded-xl text-sm font-bold hover:bg-primary/90 transition-colors flex items-center gap-2"
                  >
                    <span className="material-symbols-outlined text-sm">merge</span>
                    Fusionner
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </section>

      {/* SMTP settings */}
      <section className="bg-surface-container-lowest rounded-2xl p-6 shadow-arctic">
        <h2 className="font-headline font-bold text-on-surface text-lg mb-1">
          Notifications email (SMTP)
        </h2>
        <p className="text-on-surface-variant text-xs mb-4">
          Configurez le serveur SMTP pour envoyer des notifications par email aux patineurs.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-lg">
          <div className="sm:col-span-2">
            <label className="block text-xs font-label font-medium text-on-surface-variant mb-1">
              Serveur SMTP
            </label>
            <input
              value={smtpHost}
              onChange={(e) => setSmtpHost(e.target.value)}
              placeholder="smtp-relay.gmail.com"
              className={inputCls}
            />
          </div>
          <div>
            <label className="block text-xs font-label font-medium text-on-surface-variant mb-1">
              Port
            </label>
            <input
              value={smtpPort}
              onChange={(e) => setSmtpPort(e.target.value)}
              placeholder="587"
              className={inputCls}
            />
          </div>
          <div>
            <label className="block text-xs font-label font-medium text-on-surface-variant mb-1">
              Adresse d'expédition
            </label>
            <input
              value={smtpFrom}
              onChange={(e) => setSmtpFrom(e.target.value)}
              placeholder="noreply@monclub.fr"
              className={inputCls}
            />
          </div>
          <div>
            <label className="block text-xs font-label font-medium text-on-surface-variant mb-1">
              Nom d'expéditeur
            </label>
            <input
              value={smtpFromName}
              onChange={(e) => setSmtpFromName(e.target.value)}
              placeholder="Mon Club Patinage"
              className={inputCls}
            />
          </div>
          <div>
            <label className="block text-xs font-label font-medium text-on-surface-variant mb-1">
              Adresse de support
            </label>
            <input
              value={supportEmail}
              onChange={(e) => setSupportEmail(e.target.value)}
              placeholder="support@exemple.fr"
              className={inputCls}
            />
            <p className="text-[11px] text-on-surface-variant mt-1">
              Affichée aux utilisateurs sous forme de lien discret (connexion et
              menu latéral). L'adresse est encodée avant envoi au navigateur
              pour éviter sa collecte par les robots. Laissez vide pour masquer
              le lien.
            </p>
          </div>
          <div>
            <label className="block text-xs font-label font-medium text-on-surface-variant mb-1">
              Utilisateur SMTP
            </label>
            <input
              value={smtpUser}
              onChange={(e) => setSmtpUser(e.target.value)}
              placeholder="user@monclub.fr"
              className={inputCls}
            />
          </div>
          <div>
            <label className="block text-xs font-label font-medium text-on-surface-variant mb-1">
              Mot de passe SMTP
            </label>
            <input
              type="password"
              value={smtpPassword}
              onChange={(e) => setSmtpPassword(e.target.value)}
              placeholder={smtpData?.configured ? "••••••••" : ""}
              className={inputCls}
            />
          </div>
        </div>
        <div className="flex items-center gap-3 mt-5">
          <button
            onClick={() => smtpMutation.mutate()}
            disabled={smtpMutation.isPending}
            className="px-4 py-2 bg-primary text-on-primary rounded-xl text-sm font-bold disabled:opacity-50 hover:bg-primary/90 transition-colors"
          >
            {smtpMutation.isPending ? "..." : "Enregistrer"}
          </button>
          <button
            onClick={() => {
              setSmtpTestResult(null);
              smtpTestMutation.mutate();
            }}
            disabled={smtpTestMutation.isPending || !smtpData?.configured}
            className="px-4 py-2 bg-surface-container text-on-surface rounded-xl text-sm font-bold disabled:opacity-50 hover:bg-surface-container-high transition-colors flex items-center gap-1.5"
          >
            <span className="material-symbols-outlined text-sm">send</span>
            {smtpTestMutation.isPending ? "Envoi..." : "Tester"}
          </button>
        </div>
        {smtpMutation.isSuccess && (
          <p className="text-xs text-primary font-semibold mt-2">Paramètres SMTP enregistrés</p>
        )}
        {smtpMutation.isError && (
          <p className="text-xs text-error mt-2">{String(smtpMutation.error)}</p>
        )}
        {smtpTestResult && (
          <p className={`text-xs mt-2 font-semibold ${smtpTestResult.success ? "text-primary" : "text-error"}`}>
            {smtpTestResult.message}
          </p>
        )}
      </section>

      {/* Demandes de création de compte */}
      <section className="bg-surface-container-lowest rounded-2xl p-6 shadow-arctic">
        <h2 className="font-headline font-bold text-on-surface text-lg mb-1">
          Demandes de création de compte
        </h2>
        <p className="text-on-surface-variant text-xs mb-4">
          Les parents et patineurs peuvent demander un compte en fournissant un numéro de licence,
          vérifié contre le classement national.
        </p>

        <div className="max-w-lg space-y-4">
          <label className="flex items-center gap-2 text-sm text-on-surface">
            <input
              type="checkbox"
              checked={frEnabled}
              onChange={(e) => setFrEnabled(e.target.checked)}
              className="rounded"
            />
            Activer le formulaire public de demande de compte
          </label>

          <div>
            <label className="block text-xs font-label font-medium text-on-surface-variant mb-1">
              URL du classement national (Google Sheets)
            </label>
            <input
              value={frUrl}
              onChange={(e) => setFrUrl(e.target.value)}
              placeholder="https://docs.google.com/spreadsheets/d/..."
              className={inputCls}
            />
          </div>

          <div>
            <label className="block text-xs font-label font-medium text-on-surface-variant mb-1">
              Graphies du club dans le classement (une par ligne)
            </label>
            <textarea
              value={frClubNames}
              onChange={(e) => setFrClubNames(e.target.value)}
              rows={3}
              placeholder={"TOULOUSE CLUB PATINAGE\nCLUB PATINAGE TOULOUSAIN"}
              className={inputCls}
            />
          </div>

          <button
            onClick={() => frMutation.mutate()}
            disabled={frMutation.isPending}
            className="px-4 py-2 bg-primary text-on-primary rounded-xl text-xs font-bold hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {frMutation.isPending ? "Enregistrement..." : "Enregistrer"}
          </button>
          {frMutation.isSuccess && (
            <p className="text-xs text-primary font-semibold">Réglages enregistrés</p>
          )}
          {frMutation.isError && (
            <p className="text-xs text-error">{String(frMutation.error)}</p>
          )}
        </div>

        <h3 className="font-headline font-bold text-on-surface text-sm mt-6 mb-2">
          Demandes reçues
        </h3>
        {accountRequests.length === 0 ? (
          <p className="text-on-surface-variant text-xs">Aucune demande pour le moment.</p>
        ) : (
          <div className="space-y-2">
            {accountRequests.map((req) => (
              <div key={req.id} className="bg-surface-container rounded-xl p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm text-on-surface font-medium">
                      {req.display_name}{" "}
                      <span className="text-on-surface-variant font-normal">({req.email})</span>
                    </p>
                    <p className="text-xs text-on-surface-variant">
                      Licences : <span className="font-mono">{req.licence_numbers.join(", ")}</span>
                    </p>
                    {req.user_id && req.status === "pending_admin" && (
                      <p className="text-xs text-on-surface-variant mt-0.5">
                        Rattachement à un compte existant
                      </p>
                    )}
                  </div>
                  <span className="text-xs font-semibold text-on-surface-variant">
                    {REQUEST_STATUS_LABELS[req.status] ?? req.status}
                  </span>
                </div>

                {req.reject_reason && (
                  <p className="text-xs text-error mt-1">{req.reject_reason}</p>
                )}

                {req.status === "pending_admin" && (
                  <div className="flex flex-wrap items-center gap-2 mt-2">
                    <select
                      value={approveSelection[req.id] ?? ""}
                      onChange={(e) =>
                        setApproveSelection((prev) => ({ ...prev, [req.id]: e.target.value }))
                      }
                      className={inputCls}
                    >
                      <option value="">Choisir un patineur…</option>
                      {skatersForApproval.map((skater) => (
                        <option key={skater.id} value={skater.id}>
                          {skater.first_name} {skater.last_name}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={() =>
                        approveRequest.mutate({
                          id: req.id,
                          skaterId: Number(approveSelection[req.id]),
                        })
                      }
                      disabled={!approveSelection[req.id] || approveRequest.isPending}
                      className="px-3 py-1.5 bg-primary text-on-primary rounded-xl text-xs font-bold hover:bg-primary/90 transition-colors disabled:opacity-50"
                    >
                      Approuver
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Default team medians */}
      <section className="bg-surface-container-lowest rounded-2xl p-6 shadow-arctic">
        <div className="flex justify-between items-center mb-2">
          <h2 className="font-headline font-bold text-on-surface text-lg">
            Médianes France Clubs
          </h2>
          <button
            onClick={() => setShowMediansModal(true)}
            className="px-3 py-1.5 bg-primary text-on-primary rounded-xl text-xs font-bold hover:bg-primary/90 transition-colors flex items-center gap-1"
          >
            <span className="material-symbols-outlined text-sm">edit</span>
            Modifier
          </button>
        </div>
        <p className="text-sm text-on-surface-variant mb-4">
          Valeurs de référence par défaut pour le calcul des scores équipe.
          Chaque compétition peut avoir ses propres médianes.
        </p>
        {defaultMediansData && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-on-surface-variant uppercase tracking-wider">
                <tr>
                  <th className="py-2 pr-4">Catégorie</th>
                  <th className="py-2 px-2 text-right">D1</th>
                  <th className="py-2 px-2 text-right">D2</th>
                  <th className="py-2 px-2 text-right">D3</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(defaultMediansData.medians)
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([cat, divs]) => (
                    <tr key={cat} className="border-t border-gray-100">
                      <td className="py-1.5 pr-4 font-medium">{cat}</td>
                      <td className="py-1.5 px-2 text-right font-mono">{divs.D1?.toFixed(2) ?? "—"}</td>
                      <td className="py-1.5 px-2 text-right font-mono">{divs.D2?.toFixed(2) ?? "—"}</td>
                      <td className="py-1.5 px-2 text-right font-mono">{divs.D3?.toFixed(2) ?? "—"}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {showMediansModal && defaultMediansData && (
        <MediansModal
          medians={defaultMediansData.medians}
          onSave={(m) => saveDefaultMedians.mutate(m)}
          onClose={() => setShowMediansModal(false)}
          saving={saveDefaultMedians.isPending}
          title="Médianes par défaut (saison)"
        />
      )}

      {/* Maintenance */}
      <section className="rounded-2xl p-6 shadow-arctic bg-surface-container-lowest">
        <h2 className="font-headline font-bold text-on-surface text-lg mb-2">
          Maintenance
        </h2>
        <div className="flex items-center gap-4">
          <div className="flex-1">
            <p className="text-sm text-on-surface font-medium">Recalculer les clubs</p>
            <p className="text-xs text-on-surface-variant">
              Met à jour le club de chaque patineur avec celui de sa compétition la plus récente.
            </p>
          </div>
          <button
            onClick={() => recalcClubsMutation.mutate()}
            disabled={recalcClubsMutation.isPending}
            className="px-4 py-2 bg-primary text-on-primary rounded-xl text-sm font-bold hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center gap-2 shrink-0"
          >
            <span className="material-symbols-outlined text-sm">sync</span>
            {recalcClubsMutation.isPending ? "En cours..." : "Recalculer"}
          </button>
        </div>
        {recalcClubsMutation.isSuccess && (
          <p className="text-xs text-primary mt-2">
            {recalcClubsMutation.data.skaters_updated} patineur{recalcClubsMutation.data.skaters_updated > 1 ? "s" : ""} mis à jour.
          </p>
        )}
        {recalcClubsMutation.isError && (
          <p className="text-xs text-error mt-2">{String(recalcClubsMutation.error)}</p>
        )}
      </section>

      {/* Danger zone */}
      <section className="rounded-2xl p-6 shadow-arctic border-2 border-error/30 bg-error-container/10">
        <h2 className="font-headline font-bold text-error text-lg mb-2">
          Zone de danger
        </h2>
        <p className="text-on-surface-variant text-xs mb-4">
          Ces actions sont irréversibles. Toutes les données seront supprimées.
        </p>
        <button
          onClick={() => setShowResetConfirm(true)}
          className="px-4 py-2 bg-error text-on-error rounded-xl text-sm font-bold hover:bg-error/90 transition-colors flex items-center gap-2"
        >
          <span className="material-symbols-outlined text-sm">delete_forever</span>
          Réinitialiser la base de données
        </button>

        {/* Reset confirmation dialog */}
        {showResetConfirm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-scrim/60">
            <div className="bg-surface-container-lowest rounded-2xl shadow-xl p-6 max-w-md w-full mx-4 border-2 border-error/30">
              <div className="flex items-center gap-3 mb-4">
                <span className="material-symbols-outlined text-error text-3xl">warning</span>
                <h3 className="font-headline font-bold text-error text-lg">
                  Confirmer la réinitialisation
                </h3>
              </div>
              <p className="text-on-surface text-sm mb-2">
                Cette action va <strong>supprimer définitivement</strong> toutes
                les compétitions, scores, patineurs et résultats de la base de données.
              </p>
              <p className="text-on-surface-variant text-xs mb-4">
                Les paramètres du club et les utilisateurs seront recréés depuis
                les variables d'environnement.
              </p>
              <label className="block text-xs font-medium text-on-surface-variant mb-1">
                Tapez <span className="font-mono font-bold text-error">SUPPRIMER</span> pour confirmer
              </label>
              <input
                value={resetConfirmText}
                onChange={(e) => setResetConfirmText(e.target.value)}
                className="w-full px-3 py-2 bg-surface-container-low rounded-xl text-on-surface text-sm focus:outline-none focus:ring-2 focus:ring-error mb-4 font-mono"
                placeholder="SUPPRIMER"
                autoFocus
              />
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => {
                    setShowResetConfirm(false);
                    setResetConfirmText("");
                  }}
                  className="px-4 py-2 text-on-surface-variant text-sm rounded-xl hover:bg-surface-container transition-colors"
                >
                  Annuler
                </button>
                <button
                  onClick={() => resetMutation.mutate()}
                  disabled={resetConfirmText !== "SUPPRIMER" || resetMutation.isPending}
                  className="px-4 py-2 bg-error text-on-error rounded-xl text-sm font-bold disabled:opacity-30 hover:bg-error/90 transition-colors flex items-center gap-2"
                >
                  <span className="material-symbols-outlined text-sm">delete_forever</span>
                  {resetMutation.isPending ? "Suppression..." : "Réinitialiser"}
                </button>
              </div>
              {resetMutation.isError && (
                <p className="text-error text-xs mt-3">{String(resetMutation.error)}</p>
              )}
            </div>
          </div>
        )}
      </section>

      </div>
      )}

      {activeTab === "users" && (
      <div className="space-y-8">
        {/* Users table */}
        <section className="bg-surface-container-lowest rounded-2xl p-6 shadow-arctic">
          <div className="flex justify-between items-center mb-4">
            <h2 className="font-headline font-bold text-on-surface text-lg">
              Utilisateurs
            </h2>
            <button
              onClick={() => setShowAddUser(true)}
              className="px-3 py-1.5 bg-primary text-on-primary rounded-xl text-xs font-bold hover:bg-primary/90 transition-colors flex items-center gap-1"
            >
              <span className="material-symbols-outlined text-sm">add</span>
              Ajouter
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs font-bold text-on-surface-variant uppercase tracking-wider">
                  <th className="pb-3 pr-4">Nom</th>
                  <th className="pb-3 pr-4">Email</th>
                  <th className="pb-3 pr-4">Rôle</th>
                  <th className="pb-3 pr-4">Statut</th>
                  <th className="pb-3 pr-4">Dernière connexion</th>
                  <th className="pb-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant/20">
                {users.map((u) => {
                  const isEditing = editingUserId === u.id;
                  return (
                    <tr key={u.id} className="group">
                      <td className="py-3 pr-4">
                        <span className="font-medium text-on-surface">{u.display_name}</span>
                      </td>
                      <td className="py-3 pr-4 text-on-surface-variant">{u.email}</td>
                      <td className="py-3 pr-4">
                        {isEditing ? (
                          <select
                            value={editData.role}
                            onChange={(e) => setEditData((d) => ({ ...d, role: e.target.value as UserRecord["role"], skater_ids: e.target.value !== "skater" ? [] : d.skater_ids }))}
                            className="px-2 py-1 bg-surface-container-low rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                          >
                            <option value="reader">Lecteur</option>
                            <option value="admin">Administrateur</option>
                            <option value="coach">Coach</option>
                            <option value="skater">Patineur</option>
                          </select>
                        ) : (
                          <span
                            className={`text-xs px-2 py-0.5 rounded-full ${
                              u.role === "admin"
                                ? "bg-primary-container text-on-primary-container"
                                : u.role === "coach"
                                  ? "bg-green-100 text-green-700"
                                  : u.role === "skater"
                                    ? "bg-blue-100 text-blue-700"
                                    : "bg-surface-container text-on-surface-variant"
                            }`}
                          >
                            {u.role === "admin" ? "Admin" : u.role === "coach" ? "Coach" : u.role === "skater" ? "Patineur" : "Lecteur"}
                          </span>
                        )}
                      </td>
                      <td className="py-3 pr-4">
                        <button
                          onClick={() => toggleActive.mutate(u)}
                          className={`text-xs px-2 py-1 rounded-lg transition-colors ${
                            u.is_active
                              ? "text-primary hover:bg-primary/10"
                              : "text-error hover:bg-error/10"
                          }`}
                        >
                          {u.is_active ? "Actif" : "Désactivé"}
                        </button>
                      </td>
                      <td className="py-3 pr-4 text-on-surface-variant text-xs">
                        {u.last_login_at ? (
                          <span title={formatFullDate(u.last_login_at)}>
                            {formatRelativeTime(u.last_login_at)}
                          </span>
                        ) : (
                          <span className="text-on-surface-variant/50">Jamais</span>
                        )}
                      </td>
                      <td className="py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {isEditing ? (
                            <>
                              <button
                                onClick={() =>
                                  updateUser.mutate({
                                    id: u.id,
                                    data: {
                                      display_name: editData.display_name,
                                      role: editData.role,
                                      skater_ids: editData.role === "skater" ? editData.skater_ids : [],
                                    },
                                  })
                                }
                                disabled={updateUser.isPending}
                                className="text-xs px-2 py-1 rounded-lg bg-primary text-on-primary font-bold hover:bg-primary/90 disabled:opacity-50"
                              >
                                {updateUser.isPending ? "..." : "Enregistrer"}
                              </button>
                              <button
                                onClick={() => setEditingUserId(null)}
                                className="text-xs px-2 py-1 rounded-lg text-on-surface-variant hover:bg-surface-container"
                              >
                                Annuler
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                onClick={() => {
                                  setEditingUserId(u.id);
                                  setEditData({ role: u.role, skater_ids: u.skater_ids || [], display_name: u.display_name });
                                }}
                                className="text-on-surface-variant hover:bg-surface-container rounded-lg px-2 py-1"
                                title="Modifier"
                              >
                                <span className="material-symbols-outlined text-sm">edit</span>
                              </button>
                              {confirmingDeleteId === u.id ? (
                                <span className="flex items-center gap-1">
                                  <button
                                    onClick={() => deleteUser.mutate(u.id)}
                                    className="text-xs px-2 py-1 rounded-lg bg-error text-on-error font-bold"
                                  >
                                    Confirmer
                                  </button>
                                  <button
                                    onClick={() => setConfirmingDeleteId(null)}
                                    className="text-xs px-2 py-1 rounded-lg text-on-surface-variant hover:bg-surface-container"
                                  >
                                    Annuler
                                  </button>
                                </span>
                              ) : (
                                <button
                                  onClick={() => setConfirmingDeleteId(u.id)}
                                  className="text-error hover:bg-error-container rounded-lg px-2 py-1"
                                >
                                  <span className="material-symbols-outlined text-sm">delete</span>
                                </button>
                              )}
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Inline edit details (skater picker, display name) - shown below table */}
          {editingUserId && (
            <div className="mt-4 p-4 bg-surface-container-low rounded-xl space-y-3">
              <h3 className="text-xs font-bold text-on-surface-variant uppercase tracking-wider">
                Modifier — {users.find((u) => u.id === editingUserId)?.display_name}
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-lg">
                <div>
                  <label className="text-xs font-bold text-on-surface-variant uppercase tracking-wider">
                    Nom affiché
                  </label>
                  <input
                    value={editData.display_name}
                    onChange={(e) => setEditData((d) => ({ ...d, display_name: e.target.value }))}
                    className={inputCls}
                  />
                </div>
              </div>
              {editData.role === "skater" && (
                <SkaterPicker
                  selectedIds={editData.skater_ids}
                  onChange={(ids) => setEditData((d) => ({ ...d, skater_ids: ids }))}
                  club={config?.club_short}
                />
              )}
            </div>
          )}

          {/* Add user form */}
          {showAddUser && (
            <div className="mt-4 p-4 bg-surface-container rounded-xl space-y-3">
              <h3 className="text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-2">
                Nouvel utilisateur
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-lg">
                <input
                  placeholder="Email"
                  value={newUser.email}
                  onChange={(e) =>
                    setNewUser((u) => ({ ...u, email: e.target.value }))
                  }
                  className={inputCls}
                />
                <input
                  placeholder="Nom affiché"
                  value={newUser.display_name}
                  onChange={(e) =>
                    setNewUser((u) => ({ ...u, display_name: e.target.value }))
                  }
                  className={inputCls}
                />
              </div>
              <div className="max-w-xs">
                <select
                  value={newUser.role}
                  onChange={(e) =>
                    setNewUser((u) => ({ ...u, role: e.target.value }))
                  }
                  className={inputCls}
                >
                  <option value="reader">Lecteur</option>
                  <option value="admin">Administrateur</option>
                  <option value="coach">Coach</option>
                  <option value="skater">Patineur</option>
                </select>
              </div>
              {newUser.role === "skater" && (
                <SkaterPicker
                  selectedIds={newUser.skater_ids}
                  onChange={(ids) => setNewUser((u) => ({ ...u, skater_ids: ids }))}
                  club={config?.club_short}
                />
              )}
              <div className="max-w-xs">
                <input
                  type="password"
                  placeholder="Mot de passe (optionnel pour OAuth)"
                  value={newUser.password}
                  onChange={(e) =>
                    setNewUser((u) => ({ ...u, password: e.target.value }))
                  }
                  className={inputCls}
                />
              </div>
              {newUser.password && (
                <label className="flex items-center gap-2 text-xs text-on-surface-variant">
                  <input
                    type="checkbox"
                    checked={newUser.must_change_password}
                    onChange={(e) =>
                      setNewUser((u) => ({ ...u, must_change_password: e.target.checked }))
                    }
                    className="rounded"
                  />
                  Forcer le changement au prochain login
                </label>
              )}
              <div className="flex gap-2">
                <button
                  onClick={() => createUser.mutate()}
                  className="px-4 py-2 bg-primary text-on-primary rounded-xl text-sm font-bold"
                >
                  Créer
                </button>
                <button
                  onClick={() => setShowAddUser(false)}
                  className="px-4 py-2 text-on-surface-variant text-sm"
                >
                  Annuler
                </button>
              </div>
            </div>
          )}
        </section>
      </div>
      )}

      {activeTab === "jobs" && <AdminJobsTab />}

      {activeTab === "training" && (
      <div className="space-y-8">
        <section className="bg-surface-container-lowest rounded-2xl p-6 shadow-arctic">
          <div className="flex justify-between items-center mb-4">
            <h2 className="font-headline font-bold text-on-surface text-lg">
              Patineurs suivis en entraînement
            </h2>
            <button
              onClick={() => setAddSkaterMode(addSkaterMode ? null : "choose")}
              className="px-3 py-1.5 bg-primary text-on-primary rounded-xl text-xs font-bold hover:bg-primary/90 transition-colors flex items-center gap-1"
            >
              <span className="material-symbols-outlined text-sm">add</span>
              Ajouter
            </button>
          </div>

          {loadingTracked ? (
            <div className="flex items-center justify-center py-10">
              <span className="material-symbols-outlined animate-spin text-primary text-2xl">progress_activity</span>
            </div>
          ) : !trackedSkaters?.length ? (
            <p className="text-on-surface-variant text-sm text-center py-10">
              Aucun patineur suivi. Ajoutez des patineurs depuis leur fiche ou créez-en un nouveau.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs font-bold text-on-surface-variant uppercase tracking-wider">
                    <th className="pb-3 pr-4">Nom</th>
                    <th className="pb-3 pr-4">Club</th>
                    <th className="pb-3 pr-4">Type</th>
                    <th className="pb-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline-variant/20">
                  {trackedSkaters.map((s) => (
                    <tr key={s.id}>
                      <td className="py-3 pr-4">
                        <span className="font-medium text-on-surface">
                          {s.first_name} {s.last_name}
                        </span>
                        {s.nationality && (
                          <span className="ml-2" title={s.nationality}>
                            {countryFlag(s.nationality) ?? s.nationality}
                          </span>
                        )}
                      </td>
                      <td className="py-3 pr-4 text-on-surface-variant">{s.club ?? "—"}</td>
                      <td className="py-3 pr-4">
                        {s.manual_create ? (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">Manuel</span>
                        ) : (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-surface-container text-on-surface-variant">Importé</span>
                        )}
                      </td>
                      <td className="py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {clearingTrainingId === s.id ? (
                            <span className="flex items-center gap-1">
                              <button
                                onClick={() => clearTrainingDataMutation.mutate(s.id)}
                                disabled={clearTrainingDataMutation.isPending}
                                className="text-xs px-2 py-1 rounded-lg bg-error text-on-error font-bold disabled:opacity-50"
                              >
                                Confirmer
                              </button>
                              <button
                                onClick={() => setClearingTrainingId(null)}
                                className="text-xs px-2 py-1 rounded-lg text-on-surface-variant hover:bg-surface-container"
                              >
                                Annuler
                              </button>
                            </span>
                          ) : (
                            <button
                              onClick={() => setClearingTrainingId(s.id)}
                              className="text-error hover:bg-error-container rounded-lg px-2 py-1"
                              title="Supprimer les données d'entraînement"
                            >
                              <span className="material-symbols-outlined text-sm">delete_sweep</span>
                            </button>
                          )}
                          <button
                            onClick={() => removeTrackingMutation.mutate(s.id)}
                            disabled={removeTrackingMutation.isPending}
                            className="text-on-surface-variant hover:bg-surface-container rounded-lg px-2 py-1 disabled:opacity-50"
                            title="Retirer du suivi"
                          >
                            <span className="material-symbols-outlined text-sm">person_remove</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Add skater: choice panel */}
          {addSkaterMode === "choose" && (
            <div className="mt-4 p-4 bg-surface-container rounded-xl">
              <p className="text-sm text-on-surface mb-3">Ajouter un patineur au suivi d'entraînement :</p>
              <div className="flex gap-2">
                <button
                  onClick={() => setAddSkaterMode("existing")}
                  className="flex-1 px-4 py-3 bg-surface-container-low rounded-xl text-sm font-bold text-on-surface hover:bg-surface-container-high transition-colors flex items-center justify-center gap-2"
                >
                  <span className="material-symbols-outlined text-sm">person_search</span>
                  Patineur existant
                </button>
                <button
                  onClick={() => setAddSkaterMode("create")}
                  className="flex-1 px-4 py-3 bg-surface-container-low rounded-xl text-sm font-bold text-on-surface hover:bg-surface-container-high transition-colors flex items-center justify-center gap-2"
                >
                  <span className="material-symbols-outlined text-sm">person_add</span>
                  Nouveau patineur
                </button>
              </div>
              <button
                onClick={() => setAddSkaterMode(null)}
                className="mt-2 text-xs text-on-surface-variant hover:text-on-surface"
              >
                Annuler
              </button>
            </div>
          )}

          {/* Add skater: onboard existing */}
          {addSkaterMode === "existing" && (
            <div className="mt-4 p-4 bg-surface-container rounded-xl space-y-3">
              <h3 className="text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-2">
                Rechercher un patineur existant
              </h3>
              <input
                placeholder="Rechercher par nom…"
                value={onboardSearch}
                onChange={(e) => setOnboardSearch(e.target.value)}
                className={inputCls + " max-w-sm"}
                autoFocus
              />
              {onboardResults && onboardSearch.length >= 2 && (
                <div className="bg-surface-container-low rounded-lg shadow-md max-h-48 overflow-y-auto max-w-sm">
                  {onboardResults
                    .filter((s) => !s.training_tracked)
                    .map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => onboardSkaterMutation.mutate(s.id)}
                        disabled={onboardSkaterMutation.isPending}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-surface-container-high transition-colors flex items-center justify-between disabled:opacity-50"
                      >
                        <span>
                          {s.first_name} {s.last_name}
                          {s.club && (
                            <span className="text-on-surface-variant ml-2 text-xs">({s.club})</span>
                          )}
                        </span>
                        <span className="material-symbols-outlined text-sm text-primary">add</span>
                      </button>
                    ))}
                  {onboardResults.filter((s) => !s.training_tracked).length === 0 && (
                    <p className="px-3 py-2 text-xs text-on-surface-variant">Aucun patineur non suivi trouvé</p>
                  )}
                </div>
              )}
              <button
                onClick={() => { setAddSkaterMode("choose"); setOnboardSearch(""); }}
                className="text-xs text-on-surface-variant hover:text-on-surface"
              >
                ← Retour
              </button>
            </div>
          )}

          {/* Add skater: create new manual skater */}
          {addSkaterMode === "create" && (
            <div className="mt-4 p-4 bg-surface-container rounded-xl space-y-3">
              <h3 className="text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-2">
                Nouveau patineur
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-lg">
                <input
                  placeholder="Prénom"
                  value={newSkater.first_name}
                  onChange={(e) => setNewSkater((s) => ({ ...s, first_name: e.target.value }))}
                  className={inputCls}
                />
                <input
                  placeholder="Nom *"
                  value={newSkater.last_name}
                  onChange={(e) => setNewSkater((s) => ({ ...s, last_name: e.target.value }))}
                  className={inputCls}
                />
                <input
                  placeholder="Nation (ex: FRA)"
                  value={newSkater.nationality}
                  onChange={(e) => setNewSkater((s) => ({ ...s, nationality: e.target.value }))}
                  className={inputCls}
                  maxLength={3}
                />
                <input
                  placeholder="Club"
                  value={newSkater.club}
                  onChange={(e) => setNewSkater((s) => ({ ...s, club: e.target.value }))}
                  className={inputCls}
                />
              </div>
              {createSkaterMutation.isError && (
                <p className="text-error text-xs">{String(createSkaterMutation.error)}</p>
              )}
              <div className="flex gap-2">
                <button
                  onClick={() => createSkaterMutation.mutate()}
                  disabled={!newSkater.last_name.trim() || createSkaterMutation.isPending}
                  className="px-4 py-2 bg-primary text-on-primary rounded-xl text-sm font-bold hover:bg-primary/90 disabled:opacity-50"
                >
                  {createSkaterMutation.isPending ? "Création..." : "Créer"}
                </button>
                <button
                  onClick={() => { setAddSkaterMode("choose"); setNewSkater({ first_name: "", last_name: "", nationality: "", club: config?.club_short ?? "" }); }}
                  className="text-xs text-on-surface-variant hover:text-on-surface"
                >
                  ← Retour
                </button>
              </div>
            </div>
          )}
        </section>
      </div>
      )}
    </div>
  );
}
