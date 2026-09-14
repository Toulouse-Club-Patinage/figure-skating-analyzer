import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { api, type AttachSkaterResponse } from "../api/client";

/** `request` lève « 429 Too Many Requests: {"detail": "..."} » : on n'affiche
 * que le message métier, pas le bruit HTTP. */
function extractDetail(message: string): string {
  const start = message.indexOf("{");
  if (start !== -1) {
    try {
      const parsed = JSON.parse(message.slice(start));
      if (typeof parsed?.detail === "string") return parsed.detail;
    } catch {
      // corps non JSON : on retombe sur le message générique
    }
  }
  return "Le rattachement a échoué. Réessayez plus tard.";
}

/** Formulaire de rattachement d'un patineur supplémentaire.
 *
 * Le formulaire public de création de compte ne sert qu'une fois : c'est ici
 * qu'un parent ajoute un second enfant en cours de saison. Mêmes preuves
 * exigées qu'à l'inscription (licence + date de naissance).
 */
function AddSkaterForm({ onDone }: { onDone: () => void }) {
  const [licenceNumber, setLicenceNumber] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [result, setResult] = useState<AttachSkaterResponse | null>(null);
  const [error, setError] = useState("");

  const mutation = useMutation({
    mutationFn: api.me.attachSkater,
    onSuccess: (data) => {
      setResult(data);
      setError("");
      if (data.status === "created") {
        setLicenceNumber("");
        setBirthDate("");
        onDone();
      }
    },
    onError: (e: Error) => {
      setResult(null);
      setError(extractDetail(e.message));
    },
  });

  const canSubmit = licenceNumber.trim() !== "" && birthDate !== "";

  const tone =
    result?.status === "created"
      ? "text-primary"
      : result?.status === "rejected"
        ? "text-error"
        : "text-on-surface-variant";

  return (
    <form
      data-tour="mes-patineurs-ajout"
      className="bg-surface-container rounded-xl p-5 max-w-md"
      onSubmit={(e) => {
        e.preventDefault();
        mutation.mutate({ licence_number: licenceNumber.trim(), birth_date: birthDate });
      }}
    >
      <h2 className="font-headline font-bold text-on-surface text-sm mb-1">
        Ajouter un patineur
      </h2>
      <p className="text-xs text-on-surface-variant mb-4">
        Renseignez le numéro de licence et la date de naissance du patineur que vous
        souhaitez suivre.
      </p>

      <label
        className="block text-sm text-on-surface-variant mb-1"
        htmlFor="attach-licence"
      >
        Numéro de licence
      </label>
      <input
        id="attach-licence"
        value={licenceNumber}
        onChange={(e) => setLicenceNumber(e.target.value)}
        className="w-full bg-surface-container-lowest rounded-lg px-3 py-2 text-sm text-on-surface mb-4 font-mono"
        autoComplete="off"
      />

      <label
        className="block text-sm text-on-surface-variant mb-1"
        htmlFor="attach-birth"
      >
        Date de naissance
      </label>
      <input
        id="attach-birth"
        type="date"
        value={birthDate}
        onChange={(e) => setBirthDate(e.target.value)}
        className="w-full bg-surface-container-lowest rounded-lg px-3 py-2 text-sm text-on-surface mb-4"
      />

      <button
        type="submit"
        disabled={!canSubmit || mutation.isPending}
        className="bg-primary text-on-primary rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50"
      >
        {mutation.isPending ? "Vérification…" : "Rattacher"}
      </button>

      {result && <p className={`text-sm mt-4 ${tone}`}>{result.detail}</p>}
      {error && <p className="text-sm mt-4 text-error">{error}</p>}
    </form>
  );
}

export default function MySkatersPage() {
  const queryClient = useQueryClient();
  // `?ajouter=1` : on arrive par le lien « Ajouter un patineur » de la nav,
  // le formulaire est donc déjà ce qu'on venait chercher.
  const [searchParams] = useSearchParams();
  const [showAdd, setShowAdd] = useState(searchParams.get("ajouter") === "1");
  const { data: skaters, isLoading } = useQuery({
    queryKey: ["me", "skaters"],
    queryFn: api.me.skaters,
  });

  const refreshSkaters = () =>
    queryClient.invalidateQueries({ queryKey: ["me", "skaters"] });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <span className="material-symbols-outlined animate-spin text-primary text-3xl">
          progress_activity
        </span>
      </div>
    );
  }

  const addButton = (
    <button
      onClick={() => setShowAdd((v) => !v)}
      className="flex items-center gap-2 text-primary text-sm font-medium"
    >
      <span className="material-symbols-outlined text-xl">
        {showAdd ? "close" : "person_add"}
      </span>
      {showAdd ? "Annuler" : "Ajouter un patineur"}
    </button>
  );

  if (!skaters || skaters.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4">
        <span className="material-symbols-outlined text-on-surface-variant text-5xl">
          person_off
        </span>
        <p className="text-on-surface-variant text-sm">
          Aucun patineur associé à votre compte.
        </p>
        {addButton}
        {showAdd && <AddSkaterForm onDone={refreshSkaters} />}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div data-tour="mes-patineurs-liste" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {skaters.map((s) => (
          <Link
            key={s.id}
            to={`/patineurs/${s.id}/analyse`}
            className="bg-surface-container rounded-xl p-5 hover:bg-surface-container-high transition-colors group"
          >
            <div className="flex items-center gap-3">
              <span className="material-symbols-outlined text-primary text-2xl">
                ice_skating
              </span>
              <div>
                <p className="font-headline font-bold text-on-surface group-hover:text-primary transition-colors">
                  {s.first_name} {s.last_name}
                </p>
                {s.club && (
                  <p className="text-xs text-on-surface-variant mt-0.5">{s.club}</p>
                )}
              </div>
            </div>
          </Link>
        ))}
      </div>

      {addButton}
      {showAdd && <AddSkaterForm onDone={refreshSkaters} />}
    </div>
  );
}
