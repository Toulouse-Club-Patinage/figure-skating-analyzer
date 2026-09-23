# Interroger SkateLab depuis Claude

SkateLab expose un **serveur MCP** : Claude peut lire les résultats de compétition
avec **vos droits** SkateLab (un compte patineur ne voit que ses patineurs
rattachés). Lecture seule ; les données d'entraînement ne sont jamais partagées.

URL du serveur : `https://skatelab.toulouseclubpatinage.com/mcp`

## claude.ai (web, Desktop, mobile)
1. Paramètres → Connecteurs → **Ajouter un connecteur personnalisé**.
2. Nom : `SkateLab` ; URL : l'URL ci-dessus. Laisser les champs OAuth vides.
3. **Se connecter** → la page SkateLab s'ouvre : connectez-vous, puis **Autoriser**.

## Claude Code
```bash
claude mcp add --transport http skatelab https://skatelab.toulouseclubpatinage.com/mcp
```
Puis `/mcp` dans Claude Code → authentifier → autoriser dans le navigateur.

## Révoquer
SkateLab → **Mon compte** → *Applications connectées* → **Révoquer**. Se
déconnecter partout ou changer de mot de passe coupe aussi l'accès.

## Exemples de questions
- « Compare les PCS de <patineur> sur ses trois dernières compétitions. »
- « Quels sauts le club rate le plus en Régional 2 cette saison ? »
