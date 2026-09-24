const BASE = import.meta.env.VITE_API_URL || "/api";

let _accessToken: string | null = null;
let _refreshPromise: Promise<string | null> | null = null;

export function setAccessToken(token: string | null) {
  _accessToken = token;
}

export function getAccessToken(): string | null {
  return _accessToken;
}

async function _tryRefresh(): Promise<string | null> {
  try {
    const res = await fetch(`${BASE}/auth/refresh`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
    });
    if (!res.ok) return null;
    const data = await res.json();
    _accessToken = data.access_token;
    return _accessToken;
  } catch {
    return null;
  }
}

export async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options?.headers as Record<string, string>),
  };
  if (_accessToken) {
    headers["Authorization"] = `Bearer ${_accessToken}`;
  }

  let res = await fetch(`${BASE}${path}`, {
    ...options,
    headers,
    credentials: "include",
  });

  // On 401, try silent refresh once
  if (res.status === 401 && _accessToken) {
    if (!_refreshPromise) {
      _refreshPromise = _tryRefresh();
    }
    const newToken = await _refreshPromise;
    _refreshPromise = null;

    if (newToken) {
      headers["Authorization"] = `Bearer ${newToken}`;
      res = await fetch(`${BASE}${path}`, {
        ...options,
        headers,
        credentials: "include",
      });
    }
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${text}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export async function downloadPdf(path: string, filename?: string): Promise<void> {
  const headers: Record<string, string> = {};
  if (_accessToken) {
    headers["Authorization"] = `Bearer ${_accessToken}`;
  }

  let res = await fetch(`${BASE}${path}`, { headers, credentials: "include" });

  if (res.status === 401 && _accessToken) {
    if (!_refreshPromise) _refreshPromise = _tryRefresh();
    const newToken = await _refreshPromise;
    _refreshPromise = null;
    if (newToken) {
      headers["Authorization"] = `Bearer ${newToken}`;
      res = await fetch(`${BASE}${path}`, { headers, credentials: "include" });
    }
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status}: ${text}`);
  }

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename || res.headers.get("content-disposition")?.match(/filename="?(.+?)"?$/)?.[1] || "rapport.pdf";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export async function downloadPdfPost(path: string, body: unknown, filename?: string): Promise<void> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (_accessToken) {
    headers["Authorization"] = `Bearer ${_accessToken}`;
  }

  let res = await fetch(`${BASE}${path}`, { method: "POST", headers, credentials: "include", body: JSON.stringify(body) });

  if (res.status === 401 && _accessToken) {
    if (!_refreshPromise) _refreshPromise = _tryRefresh();
    const newToken = await _refreshPromise;
    _refreshPromise = null;
    if (newToken) {
      headers["Authorization"] = `Bearer ${newToken}`;
      res = await fetch(`${BASE}${path}`, { method: "POST", headers, credentials: "include", body: JSON.stringify(body) });
    }
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status}: ${text}`);
  }

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename || res.headers.get("content-disposition")?.match(/filename="?(.+?)"?$/)?.[1] || "programme.pdf";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// --- Types ---

export interface Competition {
  id: number;
  name: string;
  url: string;
  date: string | null;
  date_end: string | null;
  season: string | null;
  discipline: string | null;
  city: string | null;
  country: string | null;
  rink: string | null;
  ligue: string | null;
  competition_type: string | null;
  metadata_confirmed: boolean;
  polling_enabled: boolean;
  polling_activated_at: string | null;
}

export const COMPETITION_TYPES: Record<string, string> = {
  cr: "Compétition Régionale",
  tf: "Tournoi Fédéral",
  tdf: "Tournoi de France",
  masters: "Masters",
  nationales_autres: "Nationales Autres",
  championnats_france: "Championnats de France",
  france_clubs: "France Clubs",
  grand_prix: "Grand Prix",
  championnats_europe: "Championnats d'Europe",
  championnats_monde: "Championnats du Monde",
  championnats_monde_junior: "Championnats du Monde Junior",
  jeux_olympiques: "Jeux Olympiques",
  autre: "Autre",
};

export const LIGUES: Record<string, string> = {
  ISU: "ISU",
  FFSG: "FFSG",
  Occitanie: "Occitanie",
  Aquitaine: "Aquitaine",
  "Ile-de-France": "Ile-de-France",
  AURA: "AURA",
  "Grand Est": "Grand Est",
  "Pays de Loire": "Pays de Loire",
  Bretagne: "Bretagne",
  "Bourgogne Franche-Comte": "Bourgogne Franche-Comte",
  "Centre Val de Loire": "Centre Val de Loire",
  "Hauts de France": "Hauts de France",
  Normandie: "Normandie",
  "Région Sud": "Région Sud",
  Autres: "Autres",
};

export interface CreateCompetitionPayload {
  name: string;
  url: string;
  date?: string;
  season?: string;
  discipline?: string;
}

export interface ScoreElement {
  number: number;
  name: string;                 // clean element code, markers stripped (e.g. "3Lz")
  markers: string[];            // ISU markers: "<", "<<", "q", "e", "!", "*", "x"
  base_value: number;           // base value (×1.10 already applied when "x" present)
  judge_goe: number[];          // per-judge GOE scores (−5 to +5), length 3–9
  goe: number;                  // panel GOE (trimmed mean)
  score: number;                // final element score (base_value + goe)
  info_flag: string | null;     // reserved
}

export interface Score {
  id: number;
  competition_id: number;
  competition_name: string | null;
  competition_date: string | null;
  skater_id: number;
  skater_first_name: string | null;
  skater_last_name: string | null;
  skater_nationality: string | null;
  skater_club: string | null;
  segment: string;
  category: string | null;
  starting_number: number | null;
  rank: number | null;
  total_score: number | null;
  technical_score: number | null;
  component_score: number | null;
  deductions: number | null;
  components: Record<string, number | { score: number; factor: number; judges: number[] }> | null;
  elements: ScoreElement[] | null;
  skating_level: string | null;
  age_group: string | null;
  gender: string | null;
  pdf_url: string | null;
}

/** Extract the numeric score from a components entry (handles both old float and new enriched format). */
export function componentScore(val: number | { score: number; factor: number; judges: number[] } | undefined): number {
  if (val == null) return 0;
  if (typeof val === "number") return val;
  return val.score;
}

export interface CategoryResult {
  id: number;
  competition_id: number;
  competition_name: string | null;
  competition_date: string | null;
  skater_id: number;
  skater_first_name: string | null;
  skater_last_name: string | null;
  skater_nationality: string | null;
  skater_club: string | null;
  category: string;
  overall_rank: number | null;
  combined_total: number | null;
  segment_count: number;
  sp_rank: number | null;
  fs_rank: number | null;
  skating_level: string | null;
  age_group: string | null;
  gender: string | null;
}

export interface Skater {
  id: number;
  first_name: string;
  last_name: string;
  nationality: string | null;
  club: string | null;
  birth_year: number | null;
  training_tracked: boolean;
  manual_create: boolean;
}

export interface ImportResult {
  competition_id: number;
  status: "success" | "partial" | "error";
  events_found: number;
  scores_imported: number;
  scores_skipped: number;
  category_results_imported: number;
  category_results_skipped: number;
  errors: { skater: string; error: string }[];
}

export interface EnrichResult {
  competition_id: number;
  pdfs_downloaded: number;
  scores_enriched: number;
  unmatched: string[];
  errors: { file: string; error: string }[];
}

export interface NeverImported {
  status: "never_imported";
}

export type ImportStatus = ImportResult | NeverImported;

export interface DashboardMedal {
  skater_name: string;
  rank: number;
  competition_name: string;
  category: string | null;
  combined_total: number | null;
  segment_count: number;
}

export interface DashboardTopScore {
  skater_id: number;
  skater_name: string;
  tss: number;
  competition_name: string;
  competition_date: string | null;
  category: string | null;
}

export interface DashboardMostImproved {
  skater_name: string;
  skater_id: number;
  tss_gain: number;
  first_tss: number;
  last_tss: number;
}

export interface DashboardRecentCompetition {
  id: number;
  name: string;
  date: string | null;
  season: string | null;
  discipline: string | null;
}

export interface Dashboard {
  club_name: string;
  season: string;
  active_skaters: number;
  competitions_tracked: number;
  total_programs: number;
  medals: DashboardMedal[];
  top_scores: DashboardTopScore[];
  most_improved: DashboardMostImproved[];
  recent_competitions: DashboardRecentCompetition[];
}

export interface Element {
  score_id: number;
  competition_id: number;
  competition_name: string | null;
  competition_date: string | null;
  segment: string;
  category: string | null;
  element_name: string;
  base_value: number | null;
  goe: number | null;
  judges: number[] | null;
  total: number | null;
  markers: string[];
}

export interface ClubConfig {
  club_name: string;
  club_short: string;
  logo_url: string;
}

// --- Auth Types ---

export interface AuthUser {
  id: string;
  email: string;
  display_name: string;
  role: "admin" | "reader" | "skater" | "coach";
  must_change_password: boolean;
  has_password: boolean;
  tutorial_seen: boolean;
}

export interface LoginResponse {
  access_token: string;
  user: AuthUser;
}

export interface OAuthRequestInfo {
  request_id: string;
  client_name: string;
  redirect_host: string;
  is_loopback: boolean;
  role: string;
  can_import: boolean;
}

export interface OAuthGrant {
  family_id: string;
  client_name: string;
  user_id: string;
  user_display_name: string;
  granted_at: number;
  last_used_at: number | null;
}

export interface UserRecord {
  id: string;
  email: string;
  display_name: string;
  role: "admin" | "reader" | "skater" | "coach";
  is_active: boolean;
  google_oauth_enabled: boolean;
  skater_ids: number[];
  last_login_at: string | null;
}

export interface MySkater {
  id: number;
  first_name: string;
  last_name: string;
  club: string;
}

export type AttachSkaterStatus =
  | "created"
  | "already_linked"
  | "pending_admin"
  | "rejected";

export interface AttachSkaterResponse {
  status: AttachSkaterStatus;
  detail: string;
  skater: { id: number; first_name: string; last_name: string } | null;
}

export interface AllowedDomainRecord {
  id: string;
  domain: string;
  created_at: string;
}

export interface ConfigResponse {
  setup_required: boolean;
  club_name?: string;
  club_short?: string;
  logo_url?: string;
  current_season?: string;
  google_client_id?: string;
  training_enabled?: boolean;
  french_ranking_url?: string;
  account_requests_enabled?: boolean;
  french_ranking_club_names?: string[];
  /** Adresse de support encodée (ROT13 + `(at)`), décodée au clic seulement.
   *  Voir `components/SupportLink.tsx`. Absente de la réponse du PATCH admin,
   *  qui renvoie `support_email` en clair pour réafficher le formulaire. */
  support_email_encoded?: string;
  support_email?: string;
}

export interface SmtpSettings {
  smtp_host: string;
  smtp_port: number;
  smtp_user: string;
  smtp_from: string;
  smtp_from_name: string;
  configured: boolean;
  /** Adresse de contact affichée aux utilisateurs (endpoint admin : en clair). */
  support_email?: string;
}

export interface SmtpTestResult {
  success: boolean;
  message: string;
}

export interface BulkImportResult {
  job_ids: string[];
  total: number;
}

export interface JobInfo {
  id: string;
  type: "import" | "reimport" | "enrich";
  trigger: "manual" | "auto" | "bulk";
  competition_id: number;
  competition_name: string | null;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  result: ImportResult | EnrichResult | null;
  error: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

export interface ProgressionRankingEntry {
  skater_id: number;
  skater_name: string;
  skating_level: string | null;
  age_group: string | null;
  gender: string | null;
  first_tss: number;
  last_tss: number;
  tss_gain: number;
  competitions_count: number;
  sparkline: { date: string | null; value: number }[];
}

export interface BenchmarkData {
  skating_level: string;
  age_group: string;
  gender: string;
  data_points: number;
  min: number | null;
  max: number | null;
  median: number | null;
  p25: number | null;
  p75: number | null;
}

// --- Training Tracking Types ---

export interface WeeklyReview {
  id: number;
  skater_id: number;
  coach_id: string;
  coach_name: string | null;
  week_start: string;
  engagement: number;
  progression: number;
  attitude: number;
  strengths: string;
  improvements: string;
  visible_to_skater: boolean;
  created_at: string | null;
  updated_at: string | null;
}

export interface CreateReviewPayload {
  skater_id: number;
  week_start: string;
  engagement: number;
  progression: number;
  attitude: number;
  strengths: string;
  improvements: string;
  visible_to_skater: boolean;
}

export interface UpdateReviewPayload {
  engagement?: number;
  progression?: number;
  attitude?: number;
  strengths?: string;
  improvements?: string;
  visible_to_skater?: boolean;
}

export interface TrainingIncident {
  id: number;
  skater_id: number;
  coach_id: string;
  coach_name: string | null;
  date: string;
  incident_type: "injury" | "behavior" | "other";
  description: string;
  visible_to_skater: boolean;
  created_at: string | null;
  updated_at: string | null;
}

export interface CreateIncidentPayload {
  skater_id: number;
  date: string;
  incident_type: "injury" | "behavior" | "other";
  description: string;
  visible_to_skater: boolean;
}

export interface UpdateIncidentPayload {
  date?: string;
  incident_type?: "injury" | "behavior" | "other";
  description?: string;
  visible_to_skater?: boolean;
}

export interface TrainingChallenge {
  id: number;
  skater_id: number;
  coach_id: string;
  objective: string;
  target_date: string;
  score: number;
  created_at: string | null;
  updated_at: string | null;
}

export interface CreateChallengePayload {
  skater_id: number;
  objective: string;
  target_date: string;
}

export interface UpdateChallengePayload {
  objective?: string;
  target_date?: string;
  score?: number;
}

export interface SkaterProgram {
  id: number;
  skater_id: number;
  segment: "SP" | "FS";
  elements: string[];
  created_at: string | null;
  updated_at: string | null;
}

export interface UpsertProgramPayload {
  skater_id: number;
  segment: "SP" | "FS";
  elements: string[];
}

export interface TrainingMood {
  id: number;
  skater_id: number;
  date: string;
  rating: number;
  created_at: string | null;
}

export interface CreateMoodPayload {
  skater_id: number;
  date: string;
  rating: number;
}

export interface MoodWeeklySummary {
  average: number | null;
  count: number;
  distribution: number[];
}

export interface ElementRating {
  name: string;
  rating: number;
}

export interface SelfEvaluation {
  id: number;
  skater_id: number;
  mood_id: number | null;
  date: string;
  notes: string | null;
  element_ratings: ElementRating[] | null;
  shared: boolean;
  created_at: string | null;
  updated_at: string | null;
}

export interface CreateSelfEvaluationPayload {
  skater_id: number;
  date: string;
  notes?: string;
  element_ratings?: ElementRating[];
  shared?: boolean;
}

export interface UpdateSelfEvaluationPayload {
  notes?: string;
  element_ratings?: ElementRating[];
  shared?: boolean;
}

export type TimelineEntry =
  | (WeeklyReview & { type: "review"; sort_date: string })
  | (TrainingIncident & { type: "incident"; sort_date: string })
  | (SelfEvaluation & { type: "self_evaluation"; sort_date: string });

export interface AppNotification {
  id: number;
  type: "review" | "incident" | "competition";
  title: string;
  message: string;
  link: string;
  is_read: boolean;
  created_at: string | null;
}

export interface JumpMastery {
  jump_type: string;
  attempts: number;
  positive_goe_pct: number;
  negative_goe_pct: number;
  neutral_goe_pct: number;
  avg_goe: number;
}

export interface LevelMastery {
  element_type: string;
  attempts: number;
  level_distribution: Record<string, number>;
  avg_goe: number;
}

export interface ElementMasteryData {
  jumps: JumpMastery[];
  spins: LevelMastery[];
  steps: LevelMastery[];
}

// --- Competition Club Analysis ---

export interface ClubChallengeEntry {
  club: string;
  total_points: number;
  podium_points: number;
  rank: number;
  is_my_club: boolean;
}

export interface CategoryBreakdownClub {
  club: string;
  points: number;
  podium_points: number;
}

export interface CategoryBreakdownSkater {
  skater_name: string;
  rank: number;
  base_points: number;
  podium_points: number;
  total_points: number;
}

export interface CategoryBreakdown {
  category: string;
  clubs: CategoryBreakdownClub[];
  club_skaters: CategoryBreakdownSkater[];
}

export interface MedalEntry {
  skater_id: number;
  skater_name: string;
  category: string;
  rank: 1 | 2 | 3;
  combined_total: number;
}

export interface CategoryCoverageEntry {
  category: string;
  club_skaters: number;
  total_skaters: number;
}

export interface ClubSkaterResult {
  skater_id: number;
  skater_name: string;
  category: string;
  overall_rank: number | null;
  total_skaters: number;
  combined_total: number | null;
  is_pb: boolean;
  medal: 1 | 2 | 3 | null;
}

export interface CompetitionClubAnalysis {
  competition: { id: number; name: string; date: string; season: string };
  club_name: string;
  kpis: {
    skaters_entered: number;
    total_medals: number;
    personal_bests: number;
    categories_entered: number;
    categories_total: number;
  };
  club_challenge: {
    ranking: ClubChallengeEntry[];
    category_breakdown: CategoryBreakdown[];
  };
  medals: MedalEntry[];
  categories: CategoryCoverageEntry[];
  results: ClubSkaterResult[];
}

// --- Team Scoring Types ---

export interface TeamSkaterEntry {
  score_id: number;
  skater_id: number;
  skater_name: string;
  club: string;
  category: string | null;
  division: string | null;
  median_key: string | null;
  median_value: number | null;
  total_score: number | null;
  points: number | null;
  is_remplacant: boolean;
  is_titular: boolean;
  rank: number | null;
  starting_number: number | null;
}

export interface TeamClubResult {
  rank: number;
  club: string;
  total_points: number;
  skater_count: number;
  skaters: TeamSkaterEntry[];
}

export interface TeamCategoryResult {
  category: string;
  division: string | null;
  median_key: string | null;
  median_value: number | null;
  skaters: TeamSkaterEntry[];
}

export interface TeamDivisionClub {
  rank: number;
  club: string;
  total_points: number;
  skater_count: number;
  skaters: TeamSkaterEntry[];
}

export interface TeamChallengeEntry {
  rank: number;
  club: string;
  challenge_points: number;
  division_ranks: Record<string, number>;
  division_points: Record<string, number>;
}

export interface TeamViolation {
  club: string;
  division: string;
  category: string | null;
  rule: string;
  message: string;
}

export interface TeamScoresResponse {
  clubs: TeamClubResult[];
  division_rankings: Record<string, TeamDivisionClub[]>;
  challenge: TeamChallengeEntry[];
  categories: TeamCategoryResult[];
  violations: TeamViolation[];
  unmapped: string[];
  medians: Record<string, Record<string, number>>;
  medians_source: "competition" | "default";
  last_import_at: string | null;
}

export interface TeamMediansResponse {
  medians: Record<string, Record<string, number>>;
  source: "competition" | "default";
}

// ── Program Builder types ───────────────────────────────────────────────

export interface SovElement {
  category: "single" | "pair";
  type: "jump" | "spin" | "step" | "choreo" | "lift" | "throw" | "twist" | "death_spiral" | "pair_spin" | "pivot";
  base_value: number;
  goe: number[]; // 10 values: [-5, -4, -3, -2, -1, +1, +2, +3, +4, +5]
}

export interface SovData {
  season: string;
  elements: Record<string, SovElement>;
}

export interface ProgramBonusRules {
  double_axel?: number;
  triple?: number;
  second_different_triple?: number;
  jump_variety?: number;
  death_spiral_level2?: number;
}

export interface ProgramRuleSegment {
  label?: string;
  duration?: string;
  total_elements?: number;
  max_jump_elements?: number;
  max_spins?: number;
  max_steps?: number;
  max_choreo?: number;
  max_jump_level?: number | null;
  max_spin_level?: number | null;
  max_step_level?: number | null;
  triples_allowed?: boolean;
  quads_allowed?: boolean;
  quints_allowed?: boolean;
  requires_choreo_spin?: boolean;
  euler_allowed?: boolean;
  bonus?: ProgramBonusRules;
  combo_allowed?: boolean;
  max_combos?: number;
  max_combo_jumps?: number;
  max_sequences?: number;
  max_combo_with_3_jumps?: number;
  allowed_jumps?: string[];
  allowed_spin_types?: string[];
  axel_required?: boolean;
  bonus_second_half?: boolean;
  component_factor?: number;
  component_factor_m?: number;
  component_factor_f?: number;
  has_duo_element?: boolean;
  notes?: string;
}

export interface ProgramRuleCategory {
  label: string;
  segments: Record<string, ProgramRuleSegment>;
}

export interface ProgramRulesData {
  season: string;
  categories: Record<string, ProgramRuleCategory>;
}

export interface AccountRequestLicence {
  licence_number: string;
  birth_date: string;
}

export interface AccountRequestPayload {
  email: string;
  display_name: string;
  licences: AccountRequestLicence[];
}

export interface AccountRequestSummary {
  id: number;
  email: string;
  display_name: string;
  licence_numbers: string[];
  status: string;
  reject_reason: string | null;
  created_at: string | null;
  resolved_at: string | null;
  user_id: string | null;
}

// --- API Functions ---

export const api = {
  config: {
    get: () => request<ConfigResponse>("/config/"),
    accountRequestsEnabled: () =>
      request<{ enabled: boolean }>("/config/account-requests-enabled"),
    update: (data: { club_name?: string; club_short?: string; current_season?: string; training_enabled?: boolean; french_ranking_url?: string; account_requests_enabled?: boolean; french_ranking_club_names?: string[]; support_email?: string }) =>
      request<ConfigResponse>("/config/", {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
    smtp: {
      get: () => request<SmtpSettings>("/config/smtp"),
      update: (data: { smtp_host?: string; smtp_port?: number; smtp_user?: string; smtp_password?: string; smtp_from?: string; smtp_from_name?: string; support_email?: string }) =>
        request<SmtpSettings>("/config/smtp", { method: "PATCH", body: JSON.stringify(data) }),
      test: (to?: string) =>
        request<SmtpTestResult>("/config/smtp-test", { method: "POST", body: JSON.stringify({ to }) }),
    },
    defaultTeamMedians: {
      get: () => request<{ medians: Record<string, Record<string, number>> }>("/competitions/default-team-medians"),
      update: (medians: Record<string, Record<string, number>>) =>
        request<{ medians: Record<string, Record<string, number>> }>("/competitions/default-team-medians", {
          method: "PUT",
          body: JSON.stringify({ medians }),
        }),
    },
    uploadLogo: async (file: File): Promise<{ logo_url: string }> => {
      const form = new FormData();
      form.append("data", file);
      const headers: Record<string, string> = {};
      if (_accessToken) headers["Authorization"] = `Bearer ${_accessToken}`;
      const res = await fetch(`${BASE}/config/logo`, {
        method: "POST",
        headers,
        body: form,
        credentials: "include",
      });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return res.json();
    },
  },

  auth: {
    login: (email: string, password: string) =>
      request<LoginResponse>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      }),
    loginWithGoogle: (credential: string) =>
      request<LoginResponse>("/auth/google", {
        method: "POST",
        body: JSON.stringify({ credential }),
      }),
    refresh: () =>
      request<LoginResponse>("/auth/refresh", { method: "POST" }),
    logout: () => request<void>("/auth/logout", { method: "POST" }),
    requestAccount: (payload: AccountRequestPayload) =>
      request<{ detail: string }>("/auth/request-account", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    setup: (data: {
      email: string;
      password: string;
      display_name: string;
      club_name: string;
      club_short: string;
    }) =>
      request<LoginResponse>("/auth/setup", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    changePassword: (currentPassword: string, newPassword: string) =>
      request<LoginResponse>("/auth/change-password", {
        method: "POST",
        body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
      }),
  },

  me: {
    skaters: (): Promise<MySkater[]> => request<MySkater[]>("/me/skaters"),
    attachSkater: (payload: { licence_number: string; birth_date: string }) =>
      request<AttachSkaterResponse>("/me/skaters/attach", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    notifications: {
      list: (unread?: boolean) => {
        const qs = unread !== undefined ? `?unread=${unread}` : "";
        return request<AppNotification[]>(`/me/notifications/${qs}`);
      },
      count: () => request<{ count: number }>("/me/notifications/count"),
      markRead: (id: number) =>
        request<AppNotification>(`/me/notifications/${id}/read`, { method: "PATCH" }),
      markAllRead: () =>
        request<{ marked: number }>("/me/notifications/read-all", { method: "POST" }),
    },
    updatePreferences: (data: {
      email_notifications?: boolean;
      tutorial_seen?: boolean;
    }) =>
      request<{ email_notifications: boolean; tutorial_seen: boolean }>(
        "/me/preferences",
        {
          method: "PATCH",
          body: JSON.stringify(data),
        }
      ),
  },

  oauth: {
    getRequest: (id: string) => request<OAuthRequestInfo>(`/oauth/requests/${encodeURIComponent(id)}`),
    decide: (id: string, approve: boolean) =>
      request<{ redirect_url: string }>("/oauth/consent", {
        method: "POST",
        body: JSON.stringify({ request_id: id, approve }),
      }),
    grants: (all = false) => request<OAuthGrant[]>(`/oauth/grants${all ? "?all=true" : ""}`),
    revoke: (familyId: string) =>
      request<void>(`/oauth/grants/${encodeURIComponent(familyId)}`, { method: "DELETE" }),
  },

  users: {
    list: () => request<UserRecord[]>("/users/"),
    create: (data: {
      email: string;
      display_name: string;
      role: string;
      password?: string;
    }) =>
      request<UserRecord>("/users/", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    update: (id: string, data: Partial<UserRecord>) =>
      request<UserRecord>(`/users/${id}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
    delete: (id: string) =>
      request<void>(`/users/${id}`, { method: "DELETE" }),
    resetPassword: (id: string, sendEmail: boolean) =>
      request<{ temp_password: string; email_sent: boolean }>(
        `/users/${id}/reset-password`,
        { method: "POST", body: JSON.stringify({ send_email: sendEmail }) }
      ),
  },

  domains: {
    list: () => request<AllowedDomainRecord[]>("/domains/"),
    create: (domain: string) =>
      request<AllowedDomainRecord>("/domains/", {
        method: "POST",
        body: JSON.stringify({ domain }),
      }),
    delete: (id: string) =>
      request<void>(`/domains/${id}`, { method: "DELETE" }),
  },

  competitions: {
    list: (params?: { club?: string; season?: string; my_club?: boolean }) => {
      const qs = new URLSearchParams();
      if (params?.club) qs.set("club", params.club);
      if (params?.season) qs.set("season", params.season);
      if (params?.my_club) qs.set("my_club", "true");
      const query = qs.toString() ? `?${qs}` : "";
      return request<Competition[]>(`/competitions/${query}`);
    },
    seasons: () => request<string[]>("/competitions/seasons"),
    get: (id: number) => request<Competition>(`/competitions/${id}`),
    create: (data: CreateCompetitionPayload) =>
      request<Competition>("/competitions/", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    delete: (id: number) =>
      request<void>(`/competitions/${id}`, { method: "DELETE" }),
    import: (id: number) =>
      request<JobInfo>(`/competitions/${id}/import`, { method: "POST" }),
    reimport: (id: number) =>
      request<JobInfo>(`/competitions/${id}/import?force=true`, { method: "POST" }),
    enrich: (id: number) =>
      request<JobInfo>(`/competitions/${id}/enrich`, { method: "POST" }),
    importStatus: (id: number) =>
      request<ImportStatus>(`/competitions/${id}/import-status`),
    bulkImport: (data: { lot_name: string; urls: string[]; enrich: boolean; season?: string; discipline?: string }) =>
      request<BulkImportResult>("/competitions/bulk-import", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    update: (id: number, data: Partial<Pick<Competition, "city" | "country" | "competition_type" | "season" | "ligue">>) =>
      request<Competition>(`/competitions/${id}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
    confirmMetadata: (id: number) =>
      request<Competition>(`/competitions/${id}/confirm-metadata`, { method: "POST" }),
    bulkAction: (data: { competition_ids: number[]; action: "reimport" | "enrich" | "reimport+enrich" }) =>
      request<BulkImportResult>("/competitions/bulk-action", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    backfillMetadata: () =>
      request<{ status: string; competitions_updated: number }>("/competitions/backfill-metadata", { method: "POST" }),
    togglePolling: (id: number, enabled: boolean) =>
      request<Competition>(`/competitions/${id}/polling`, {
        method: "POST",
        body: JSON.stringify({ enabled }),
      }),
    teamScores: (id: number) =>
      request<TeamScoresResponse>(`/competitions/${id}/team-scores`),
    teamMedians: (id: number) =>
      request<TeamMediansResponse>(`/competitions/${id}/team-medians`),
    updateTeamMedians: (id: number, medians: Record<string, Record<string, number>>) =>
      request<TeamMediansResponse>(`/competitions/${id}/team-medians`, {
        method: "PUT",
        body: JSON.stringify({ medians }),
      }),
    updateTitular: (competitionId: number, scoreId: number, is_titular: boolean) =>
      request<{ score_id: number; is_titular: boolean }>(`/competitions/${competitionId}/team-titular/${scoreId}`, {
        method: "PUT",
        body: JSON.stringify({ is_titular }),
      }),
    resetTitular: (competitionId: number) =>
      request<{ reset: boolean; count: number }>(`/competitions/${competitionId}/team-titular-reset`, {
        method: "PUT",
      }),
  },

  jobs: {
    list: () => request<JobInfo[]>("/jobs/"),
    get: (id: string) => request<JobInfo>(`/jobs/${id}`),
    cancel: (id: string) => request<JobInfo>(`/jobs/${id}/cancel`, { method: "POST" }),
  },

  admin: {
    resetDatabase: () =>
      request<{ status: string; message: string }>("/admin/reset-database", { method: "POST" }),
    recalculateClubs: () =>
      request<{ status: string; skaters_updated: number }>("/admin/recalculate-clubs", { method: "POST" }),
    accountRequests: {
      list: () => request<AccountRequestSummary[]>("/admin/account-requests"),
      approve: (requestId: number, skaterIds: number[]) =>
        request<{ detail: string; user_id: string }>(`/admin/account-requests/${requestId}/approve`, {
          method: "POST",
          body: JSON.stringify({ skater_ids: skaterIds }),
        }),
    },
  },

  skaters: {
    list: (params?: { club?: string; search?: string; training_tracked?: boolean }) => {
      const qs = new URLSearchParams();
      if (params?.club) qs.set("club", params.club);
      if (params?.search) qs.set("search", params.search);
      if (params?.training_tracked !== undefined) qs.set("training_tracked", String(params.training_tracked));
      const query = qs.toString() ? `?${qs}` : "";
      return request<Skater[]>(`/skaters/${query}`);
    },
    get: (id: number) => request<Skater>(`/skaters/${id}`),
    create: (data: { first_name: string; last_name: string; nationality?: string; club?: string }) =>
      request<Skater>("/skaters/", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    update: (id: number, data: Partial<Pick<Skater, "first_name" | "last_name" | "nationality" | "club" | "training_tracked">>) =>
      request<Skater>(`/skaters/${id}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
    clearTrainingData: (id: number) =>
      request<{ deleted: number }>(`/skaters/${id}/training-data`, { method: "DELETE" }),
    seasons: (id: number) => request<string[]>(`/skaters/${id}/seasons`),
    scores: (id: number, season?: string) => {
      const qs = new URLSearchParams();
      if (season) qs.set("season", season);
      const query = qs.toString() ? `?${qs}` : "";
      return request<Score[]>(`/skaters/${id}/scores${query}`);
    },
    categoryResults: (id: number, season?: string) => {
      const qs = new URLSearchParams();
      if (season) qs.set("season", season);
      const query = qs.toString() ? `?${qs}` : "";
      return request<CategoryResult[]>(`/skaters/${id}/category-results${query}`);
    },
    elements: (id: number, opts?: { elementType?: string; season?: string }) => {
      const qs = new URLSearchParams();
      if (opts?.elementType) qs.set("element_type", opts.elementType);
      if (opts?.season) qs.set("season", opts.season);
      const query = qs.toString() ? `?${qs}` : "";
      return request<Element[]>(`/skaters/${id}/elements${query}`);
    },
    elementNames: (id: number) =>
      request<string[]>(`/skaters/${id}/element-names`),
    merge: (targetId: number, sourceIds: number[]) =>
      request<{ merged: number; aliases_created: number }>("/skaters/merge", {
        method: "POST",
        body: JSON.stringify({ target_id: targetId, source_ids: sourceIds }),
      }),
  },

  scores: {
    list: (params?: {
      competition_id?: number;
      skater_id?: number;
      segment?: string;
    }) => {
      const qs = new URLSearchParams();
      if (params?.competition_id !== undefined)
        qs.set("competition_id", String(params.competition_id));
      if (params?.skater_id !== undefined)
        qs.set("skater_id", String(params.skater_id));
      if (params?.segment) qs.set("segment", params.segment);
      const query = qs.toString() ? `?${qs}` : "";
      return request<Score[]>(`/scores/${query}`);
    },
    elements: (id: number) => request<Element[]>(`/scores/${id}/elements`),
    categoryResults: (params?: {
      competition_id?: number;
      skater_id?: number;
    }) => {
      const qs = new URLSearchParams();
      if (params?.competition_id !== undefined)
        qs.set("competition_id", String(params.competition_id));
      if (params?.skater_id !== undefined)
        qs.set("skater_id", String(params.skater_id));
      const query = qs.toString() ? `?${qs}` : "";
      return request<CategoryResult[]>(`/scores/category-results${query}`);
    },
  },

  dashboard: {
    get: (season?: string) => {
      const qs = season ? `?season=${encodeURIComponent(season)}` : "";
      return request<Dashboard>(`/dashboard/${qs}`);
    },
  },

  stats: {
    progressionRanking: (params?: {
      season?: string;
      club?: string;
      skating_level?: string;
      age_group?: string;
      gender?: string;
    }) => {
      const qs = new URLSearchParams();
      if (params?.season) qs.set("season", params.season);
      if (params?.club) qs.set("club", params.club);
      if (params?.skating_level) qs.set("skating_level", params.skating_level);
      if (params?.age_group) qs.set("age_group", params.age_group);
      if (params?.gender) qs.set("gender", params.gender);
      const query = qs.toString() ? `?${qs}` : "";
      return request<ProgressionRankingEntry[]>(`/stats/progression-ranking${query}`);
    },
    benchmarks: (params: {
      skating_level: string;
      age_group: string;
      gender: string;
      season?: string;
    }) => {
      const qs = new URLSearchParams({
        skating_level: params.skating_level,
        age_group: params.age_group,
        gender: params.gender,
      });
      if (params.season) qs.set("season", params.season);
      return request<BenchmarkData>(`/stats/benchmarks?${qs}`);
    },
    elementMastery: (params?: {
      season?: string;
      club?: string;
      skating_level?: string;
      age_group?: string;
      gender?: string;
    }) => {
      const qs = new URLSearchParams();
      if (params?.season) qs.set("season", params.season);
      if (params?.club) qs.set("club", params.club);
      if (params?.skating_level) qs.set("skating_level", params.skating_level);
      if (params?.age_group) qs.set("age_group", params.age_group);
      if (params?.gender) qs.set("gender", params.gender);
      const query = qs.toString() ? `?${qs}` : "";
      return request<ElementMasteryData>(`/stats/element-mastery${query}`);
    },
    competitionClubAnalysis: (params: { competition_id: number; club?: string }) => {
      const qs = new URLSearchParams();
      qs.set("competition_id", String(params.competition_id));
      if (params.club) qs.set("club", params.club);
      const query = qs.toString() ? `?${qs}` : "";
      return request<CompetitionClubAnalysis>(`/stats/competition-club-analysis${query}`);
    },
  },

  training: {
    reviews: {
      list: (params?: { skater_id?: number; from?: string; to?: string }) => {
        const qs = new URLSearchParams();
        if (params?.skater_id !== undefined) qs.set("skater_id", String(params.skater_id));
        if (params?.from) qs.set("from_date", params.from);
        if (params?.to) qs.set("to_date", params.to);
        const query = qs.toString() ? `?${qs}` : "";
        return request<WeeklyReview[]>(`/training/reviews${query}`);
      },
      get: (id: number) => request<WeeklyReview>(`/training/reviews/${id}`),
      create: (data: CreateReviewPayload) =>
        request<WeeklyReview>("/training/reviews", {
          method: "POST",
          body: JSON.stringify(data),
        }),
      update: (id: number, data: UpdateReviewPayload) =>
        request<WeeklyReview>(`/training/reviews/${id}`, {
          method: "PUT",
          body: JSON.stringify(data),
        }),
      delete: (id: number) =>
        request<void>(`/training/reviews/${id}`, { method: "DELETE" }),
    },
    incidents: {
      list: (params?: { skater_id?: number; from?: string; to?: string }) => {
        const qs = new URLSearchParams();
        if (params?.skater_id !== undefined) qs.set("skater_id", String(params.skater_id));
        if (params?.from) qs.set("from_date", params.from);
        if (params?.to) qs.set("to_date", params.to);
        const query = qs.toString() ? `?${qs}` : "";
        return request<TrainingIncident[]>(`/training/incidents${query}`);
      },
      get: (id: number) => request<TrainingIncident>(`/training/incidents/${id}`),
      create: (data: CreateIncidentPayload) =>
        request<TrainingIncident>("/training/incidents", {
          method: "POST",
          body: JSON.stringify(data),
        }),
      update: (id: number, data: UpdateIncidentPayload) =>
        request<TrainingIncident>(`/training/incidents/${id}`, {
          method: "PUT",
          body: JSON.stringify(data),
        }),
      delete: (id: number) =>
        request<void>(`/training/incidents/${id}`, { method: "DELETE" }),
    },
    challenges: {
      list: (params?: { skater_id?: number; active?: boolean; from?: string; to?: string }) => {
        const qs = new URLSearchParams();
        if (params?.skater_id !== undefined) qs.set("skater_id", String(params.skater_id));
        if (params?.active !== undefined) qs.set("active", String(params.active));
        if (params?.from) qs.set("from_date", params.from);
        if (params?.to) qs.set("to_date", params.to);
        const query = qs.toString() ? `?${qs}` : "";
        return request<TrainingChallenge[]>(`/training/challenges${query}`);
      },
      create: (data: CreateChallengePayload) =>
        request<TrainingChallenge>("/training/challenges", {
          method: "POST",
          body: JSON.stringify(data),
        }),
      update: (id: number, data: UpdateChallengePayload) =>
        request<TrainingChallenge>(`/training/challenges/${id}`, {
          method: "PUT",
          body: JSON.stringify(data),
        }),
      delete: (id: number) =>
        request<void>(`/training/challenges/${id}`, { method: "DELETE" }),
    },
    programs: {
      list: (skater_id: number) =>
        request<SkaterProgram[]>(`/training/programs?skater_id=${skater_id}`),
      upsert: (data: UpsertProgramPayload) =>
        request<SkaterProgram>("/training/programs", {
          method: "PUT",
          body: JSON.stringify(data),
        }),
      delete: (id: number) =>
        request<void>(`/training/programs/${id}`, { method: "DELETE" }),
    },
    moods: {
      list: (params: { skater_id: number; from?: string; to?: string }) => {
        const qs = new URLSearchParams({ skater_id: String(params.skater_id) });
        if (params.from) qs.set("from_date", params.from);
        if (params.to) qs.set("to_date", params.to);
        return request<TrainingMood[]>(`/training/moods?${qs}`);
      },
      create: (data: CreateMoodPayload) =>
        request<TrainingMood>("/training/moods", {
          method: "POST",
          body: JSON.stringify(data),
        }),
      update: (id: number, data: { rating: number }) =>
        request<TrainingMood>(`/training/moods/${id}`, {
          method: "PUT",
          body: JSON.stringify(data),
        }),
      weeklySummary: (params?: { from?: string; to?: string }) => {
        const qs = new URLSearchParams();
        if (params?.from) qs.set("from_date", params.from);
        if (params?.to) qs.set("to_date", params.to);
        const query = qs.toString() ? `?${qs}` : "";
        return request<MoodWeeklySummary>(`/training/moods/weekly-summary${query}`);
      },
    },
    selfEvaluations: {
      list: (params: { skater_id: number; from?: string; to?: string }) => {
        const qs = new URLSearchParams({ skater_id: String(params.skater_id) });
        if (params.from) qs.set("from_date", params.from);
        if (params.to) qs.set("to_date", params.to);
        return request<SelfEvaluation[]>(`/training/self-evaluations?${qs}`);
      },
      create: (data: CreateSelfEvaluationPayload) =>
        request<SelfEvaluation>("/training/self-evaluations", {
          method: "POST",
          body: JSON.stringify(data),
        }),
      update: (id: number, data: UpdateSelfEvaluationPayload) =>
        request<SelfEvaluation>(`/training/self-evaluations/${id}`, {
          method: "PUT",
          body: JSON.stringify(data),
        }),
      delete: (id: number) =>
        request<void>(`/training/self-evaluations/${id}`, { method: "DELETE" }),
    },
    timeline: (params: { skater_id: number; from?: string; to?: string }) => {
      const qs = new URLSearchParams({ skater_id: String(params.skater_id) });
      if (params.from) qs.set("from_date", params.from);
      if (params.to) qs.set("to_date", params.to);
      return request<TimelineEntry[]>(`/training/timeline?${qs}`);
    },
  },

  programBuilder: {
    sov: () => request<SovData>("/program-builder/sov"),
    rules: () => request<ProgramRulesData>("/program-builder/rules"),
  },
};
