import {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
  useCallback,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, type JobInfo, type ImportResult, type EnrichResult } from "../api/client";

// --- Bulk import types ---
export interface Lot {
  name: string;
  urls: string[];
  season?: string;
  discipline?: string;
}

export interface FailedJobError {
  type: "import" | "reimport" | "enrich" | "poll";
  error: string;
  timestamp: string;
}

interface JobContextValue {
  // Per-competition jobs (CompetitionsPage)
  activeJobs: Record<string, JobInfo>;
  trackJob: (job: JobInfo) => void;
  importResults: Record<number, ImportResult>;
  enrichResults: Record<number, EnrichResult>;
  failedErrors: Record<number, FailedJobError>;
  dismissedResults: Set<number>;
  dismissedEnrich: Set<number>;
  dismissImportResult: (compId: number) => void;
  dismissEnrichResult: (compId: number) => void;
  dismissFailedError: (compId: number) => void;

  // Bulk import (SettingsPage)
  lots: Lot[];
  setLots: (lots: Lot[]) => void;
  bulkJobs: Record<string, JobInfo>;
  lotJobIds: Record<string, string[]>;
  trackBulkJobs: (lotName: string, jobIds: string[]) => void;
  clearBulk: () => void;
}

const JobContext = createContext<JobContextValue | null>(null);

export function useJobs(): JobContextValue {
  const ctx = useContext(JobContext);
  if (!ctx) throw new Error("useJobs must be used within JobProvider");
  return ctx;
}

export function JobProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();

  // --- Per-competition job tracking ---
  const [activeJobs, setActiveJobs] = useState<Record<string, JobInfo>>({});
  const [importResults, setImportResults] = useState<Record<number, ImportResult>>({});
  const [enrichResults, setEnrichResults] = useState<Record<number, EnrichResult>>({});
  const [failedErrors, setFailedErrors] = useState<Record<number, FailedJobError>>({});
  const [dismissedResults, setDismissedResults] = useState<Set<number>>(new Set());
  const [dismissedEnrich, setDismissedEnrich] = useState<Set<number>>(new Set());

  // --- Bulk import tracking ---
  const [lots, setLots] = useState<Lot[]>([]);
  const [bulkJobs, setBulkJobs] = useState<Record<string, JobInfo>>({});
  const [lotJobIds, setLotJobIds] = useState<Record<string, string[]>>({});

  // --- Recover jobs from server on mount ---
  const recoveredRef = useRef(false);
  useEffect(() => {
    if (recoveredRef.current) return;
    recoveredRef.current = true;

    api.jobs.list().then((serverJobs) => {
      const active: Record<string, JobInfo> = {};
      for (const job of serverJobs) {
        if (job.status === "queued" || job.status === "running") {
          active[job.id] = job;
        }
      }
      if (Object.keys(active).length > 0) {
        setActiveJobs((prev) => ({ ...active, ...prev }));
      }
    }).catch(() => {
      // Silently fail — jobs will just not be recovered
    });
  }, []);

  const trackJob = useCallback((job: JobInfo) => {
    setActiveJobs((prev) => ({ ...prev, [job.id]: job }));
  }, []);

  const trackBulkJobs = useCallback((lotName: string, jobIds: string[]) => {
    setLotJobIds((prev) => ({ ...prev, [lotName]: jobIds }));
    const newJobs: Record<string, JobInfo> = {};
    for (const jid of jobIds) {
      newJobs[jid] = {
        id: jid,
        type: "import",
        trigger: "bulk",
        competition_id: 0,
        competition_name: null,
        status: "queued",
        result: null,
        error: null,
        created_at: "",
        started_at: null,
        completed_at: null,
      };
    }
    setBulkJobs((prev) => ({ ...prev, ...newJobs }));
  }, []);

  const clearBulk = useCallback(() => {
    setLots([]);
    setBulkJobs({});
    setLotJobIds({});
  }, []);

  const dismissImportResult = useCallback((compId: number) => {
    setDismissedResults((prev) => new Set(prev).add(compId));
  }, []);

  const dismissEnrichResult = useCallback((compId: number) => {
    setDismissedEnrich((prev) => new Set(prev).add(compId));
  }, []);

  const dismissFailedError = useCallback((compId: number) => {
    setFailedErrors((prev) => {
      const next = { ...prev };
      delete next[compId];
      return next;
    });
  }, []);

  // --- Unified polling for both activeJobs and bulkJobs ---
  const activeJobsRef = useRef(activeJobs);
  activeJobsRef.current = activeJobs;
  const bulkJobsRef = useRef(bulkJobs);
  bulkJobsRef.current = bulkJobs;

  const pollJobs = useCallback(async () => {
    // Poll per-competition jobs
    const current = activeJobsRef.current;
    const activeIds = Object.entries(current)
      .filter(([, j]) => j.status === "queued" || j.status === "running")
      .map(([id]) => id);

    for (const jobId of activeIds) {
      try {
        const job = await api.jobs.get(jobId);
        if (job.status !== current[jobId]?.status) {
          setActiveJobs((prev) => ({ ...prev, [jobId]: job }));
          if (job.status === "completed" || job.status === "failed") {
            qc.invalidateQueries({ queryKey: ["competitions"] });
            qc.invalidateQueries({ queryKey: ["scores"] });
            if (job.status === "failed" && job.error) {
              setFailedErrors((prev) => ({
                ...prev,
                [job.competition_id]: {
                  type: job.type,
                  error: job.error!,
                  timestamp: new Date().toISOString(),
                },
              }));
            }
            if (job.status === "completed" && job.result) {
              if (job.type === "enrich") {
                setEnrichResults((prev) => ({
                  ...prev,
                  [job.competition_id]: job.result as EnrichResult,
                }));
                setDismissedEnrich((prev) => {
                  const next = new Set(prev);
                  next.delete(job.competition_id);
                  return next;
                });
              } else {
                setImportResults((prev) => ({
                  ...prev,
                  [job.competition_id]: job.result as ImportResult,
                }));
                setDismissedResults((prev) => {
                  const next = new Set(prev);
                  next.delete(job.competition_id);
                  return next;
                });
              }
            }
          }
        }
      } catch {
        setActiveJobs((prev) => ({
          ...prev,
          [jobId]: { ...current[jobId], status: "failed", error: "Lost contact with job" },
        }));
      }
    }

    // Poll bulk jobs
    const bulk = bulkJobsRef.current;
    const bulkActiveIds = Object.entries(bulk)
      .filter(([, j]) => j.status === "queued" || j.status === "running")
      .map(([id]) => id);

    for (const jobId of bulkActiveIds) {
      try {
        const job = await api.jobs.get(jobId);
        if (job.status !== bulk[jobId]?.status) {
          setBulkJobs((prev) => ({ ...prev, [jobId]: job }));
          if (job.status === "completed" || job.status === "failed") {
            qc.invalidateQueries({ queryKey: ["competitions"] });
            qc.invalidateQueries({ queryKey: ["scores"] });
          }
        }
      } catch {
        setBulkJobs((prev) => ({
          ...prev,
          [jobId]: { ...bulk[jobId], status: "failed", error: "Perdu le contact" },
        }));
      }
    }
  }, [qc]);

  // Polling interval
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const hasActive =
      Object.values(activeJobs).some((j) => j.status === "queued" || j.status === "running") ||
      Object.values(bulkJobs).some((j) => j.status === "queued" || j.status === "running");

    if (!hasActive) {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      return;
    }

    if (!pollRef.current) {
      pollRef.current = setInterval(pollJobs, 2000);
    }

    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [activeJobs, bulkJobs, pollJobs]);

  return (
    <JobContext.Provider
      value={{
        activeJobs,
        trackJob,
        importResults,
        enrichResults,
        failedErrors,
        dismissedResults,
        dismissedEnrich,
        dismissImportResult,
        dismissEnrichResult,
        dismissFailedError,
        lots,
        setLots,
        bulkJobs,
        lotJobIds,
        trackBulkJobs,
        clearBulk,
      }}
    >
      {children}
    </JobContext.Provider>
  );
}
