import { useState } from "react";
import { useSovData } from "../hooks/useSovData";
import { useProgramRules } from "../hooks/useProgramRules";
import { useProgramBuilder } from "../hooks/useProgramBuilder";
import { matchCategories, getBestMatch } from "../utils/category-matcher";
import { request, downloadPdfPost } from "../api/client";
import ElementPicker from "../components/program-builder/ElementPicker";
import ProgramTable from "../components/program-builder/ProgramTable";
import CompetitionLoader from "../components/program-builder/CompetitionLoader";
import CategoryPanel from "../components/program-builder/CategoryPanel";

export default function ProgramBuilderPage() {
  const { data: sov, isLoading: sovLoading } = useSovData();
  const { data: rules, isLoading: rulesLoading } = useProgramRules();
  const [exporting, setExporting] = useState(false);
  const [emailStatus, setEmailStatus] = useState<{ ok: boolean; message: string } | null>(null);

  const {
    elements,
    addElement,
    updateMarkers,
    updateComboJumpMarkers,
    addComboJump,
    replaceElement,
    deleteElement,
    reorderElements,
    loadFromScore,
    clearProgram,
  } = useProgramBuilder(sov);

  if (sovLoading || rulesLoading) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <span className="material-symbols-outlined animate-spin text-primary text-3xl">
          progress_activity
        </span>
      </div>
    );
  }

  if (!sov) {
    return (
      <div className="text-center text-on-surface-variant py-12">
        Erreur de chargement des données SOV.
      </div>
    );
  }

  // Build the payload for PDF export
  function buildExportPayload() {
    const matches = rules && elements.length > 0
      ? matchCategories(elements, rules)
      : [];
    const best = getBestMatch(matches);

    return {
      elements: elements.map(el => ({
        baseCode: el.baseCode,
        type: el.type,
        markers: el.markers,
        comboJumps: el.comboJumps,
        bv: el.bv,
      })),
      category: best ? `${best.categoryLabel} — ${best.segmentLabel}` : undefined,
      segmentLabel: best?.segmentLabel ?? "Programme",
      validation: best?.results.map(r => ({
        label: r.label,
        status: r.status,
        detail: r.detail,
      })),
    };
  }

  async function handleDownload() {
    setExporting(true);
    try {
      const payload = buildExportPayload();
      await downloadPdfPost("/reports/program/pdf", payload);
    } catch (e: any) {
      alert(`Erreur : ${e.message}`);
    } finally {
      setExporting(false);
    }
  }

  async function handleEmail() {
    setExporting(true);
    setEmailStatus(null);
    try {
      const payload = buildExportPayload();
      const result = await request<{ ok: boolean; message: string }>("/reports/program/email", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      setEmailStatus(result);
      setTimeout(() => setEmailStatus(null), 4000);
    } catch (e: any) {
      setEmailStatus({ ok: false, message: e.message });
      setTimeout(() => setEmailStatus(null), 4000);
    } finally {
      setExporting(false);
    }
  }

  const exportButtons = elements.length > 0 ? (
    <div className="flex items-center gap-2">
      {emailStatus && (
        <span className={`text-xs ${emailStatus.ok ? "text-green-600" : "text-error"}`}>
          {emailStatus.message}
        </span>
      )}
      <button
        onClick={handleEmail}
        disabled={exporting}
        className="flex items-center gap-1 text-xs text-on-surface-variant hover:text-primary transition-colors disabled:opacity-50"
        title="Envoyer par email"
      >
        <span className="material-symbols-outlined text-sm">mail</span>
        Email
      </button>
      <button
        onClick={handleDownload}
        disabled={exporting}
        className="flex items-center gap-1 text-xs text-on-surface-variant hover:text-primary transition-colors disabled:opacity-50"
        title="Télécharger le PDF"
      >
        <span className="material-symbols-outlined text-sm">download</span>
        PDF
      </button>
    </div>
  ) : null;

  return (
    <div data-tour="programme-contenu" className="flex flex-col lg:flex-row gap-6">
      {/* Left column — main content */}
      <div className="flex-1 min-w-0 space-y-6">
        {/* Competition loader */}
        <CompetitionLoader onLoad={loadFromScore} exportActions={exportButtons} />

        {/* Element picker + controls */}
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[200px]">
            <ElementPicker
              sov={sov}
              includePairs={false}
              onSelect={addElement}
              placeholder="Ajouter un élément..."
            />
          </div>

          {elements.length > 0 && (
            <button
              onClick={clearProgram}
              className="text-xs text-on-surface-variant hover:text-error transition-colors shrink-0"
            >
              Tout effacer
            </button>
          )}
        </div>

        {/* Program table */}
        <ProgramTable
          sov={sov}
          elements={elements}
          includePairs={false}
          onUpdateMarkers={updateMarkers}
          onUpdateComboJumpMarkers={updateComboJumpMarkers}
          onAddComboJump={addComboJump}
          onReplaceElement={replaceElement}
          onDeleteElement={deleteElement}
          onReorder={reorderElements}
        />
      </div>

      {/* Right column — category panel (stacks below on mobile) */}
      <div className="lg:w-80 shrink-0">
        <div className="lg:sticky lg:top-20">
          <CategoryPanel elements={elements} rulesData={rules} />
        </div>
      </div>
    </div>
  );
}
