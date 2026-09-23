import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";

import { api, type AccountRequestLicence } from "../api/client";

export default function RequestAccountPage() {
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [licences, setLicences] = useState<AccountRequestLicence[]>([
    { licence_number: "", birth_date: "" },
  ]);
  const [submitted, setSubmitted] = useState(false);

  const mutation = useMutation({
    mutationFn: api.auth.requestAccount,
    onSuccess: () => setSubmitted(true),
  });

  const updateLicence = (index: number, patch: Partial<AccountRequestLicence>) =>
    setLicences((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));

  const canSubmit =
    email.trim() !== "" &&
    firstName.trim() !== "" &&
    lastName.trim() !== "" &&
    licences.every((l) => l.licence_number.trim() !== "" && l.birth_date !== "");

  if (submitted) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center p-6">
        <div className="bg-surface-container rounded-2xl p-8 max-w-md w-full">
          <h1 className="font-headline text-xl text-on-surface mb-3">Demande envoyée</h1>
          <p className="text-on-surface-variant text-sm mb-6">
            Si les informations fournies sont valides, vous recevrez un email contenant vos
            identifiants de connexion.
          </p>
          <Link to="/login" className="text-primary text-sm font-medium">
            Retour à la connexion
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface flex items-center justify-center p-6">
      <form
        className="bg-surface-container rounded-2xl p-8 max-w-md w-full"
        onSubmit={(e) => {
          e.preventDefault();
          mutation.mutate({
            email,
            display_name: `${firstName.trim()} ${lastName.trim()}`,
            licences,
          });
        }}
      >
        <h1 className="font-headline text-xl text-on-surface mb-2">Demander un compte</h1>
        <p className="text-on-surface-variant text-sm mb-6">
          Renseignez le numéro de licence et la date de naissance de chaque patineur que vous
          souhaitez suivre.
        </p>

        <label className="block text-sm text-on-surface-variant mb-1">Votre email</label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full bg-surface rounded-lg px-3 py-2 mb-4 text-on-surface"
          required
        />

        <div className="grid grid-cols-2 gap-3 mb-4">
          <div>
            <label className="block text-sm text-on-surface-variant mb-1">Votre prénom</label>
            <input
              type="text"
              autoComplete="given-name"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              className="w-full bg-surface rounded-lg px-3 py-2 text-on-surface"
              required
            />
          </div>
          <div>
            <label className="block text-sm text-on-surface-variant mb-1">Votre nom</label>
            <input
              type="text"
              autoComplete="family-name"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              className="w-full bg-surface rounded-lg px-3 py-2 text-on-surface"
              required
            />
          </div>
        </div>

        {licences.map((licence, index) => (
          <div key={index} className="bg-surface rounded-lg p-3 mb-3">
            <label className="block text-sm text-on-surface-variant mb-1">
              Numéro de licence
            </label>
            <input
              type="text"
              inputMode="numeric"
              value={licence.licence_number}
              onChange={(e) => updateLicence(index, { licence_number: e.target.value })}
              className="w-full bg-surface-container rounded-lg px-3 py-2 mb-2 font-mono text-on-surface"
              required
            />
            <label className="block text-sm text-on-surface-variant mb-1">
              Date de naissance
            </label>
            <input
              type="date"
              value={licence.birth_date}
              onChange={(e) => updateLicence(index, { birth_date: e.target.value })}
              className="w-full bg-surface-container rounded-lg px-3 py-2 text-on-surface"
              required
            />
            {licences.length > 1 && (
              <button
                type="button"
                onClick={() => setLicences((prev) => prev.filter((_, i) => i !== index))}
                className="text-error text-sm mt-2"
              >
                Retirer
              </button>
            )}
          </div>
        ))}

        <button
          type="button"
          onClick={() =>
            setLicences((prev) => [...prev, { licence_number: "", birth_date: "" }])
          }
          className="text-primary text-sm font-medium mb-6"
        >
          + Ajouter un patineur
        </button>

        {mutation.isError && (
          <p className="text-error text-sm mb-4">{(mutation.error as Error).message}</p>
        )}

        <button
          type="submit"
          disabled={!canSubmit || mutation.isPending}
          className="w-full bg-primary text-on-primary rounded-lg py-2.5 font-medium disabled:opacity-50"
        >
          {mutation.isPending ? "Envoi..." : "Envoyer la demande"}
        </button>

        <Link to="/login" className="block text-center text-primary text-sm mt-4">
          Retour à la connexion
        </Link>
      </form>
    </div>
  );
}
