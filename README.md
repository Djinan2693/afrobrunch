# Afro Brunch — site et billetterie semi-manuelle

Landing page + tunnel de réservation avec paiement par QR code (GCash / BPI),
validation manuelle par l'organisateur depuis un simple email, enregistrement
automatique dans un Google Sheet et vérification du numéro de réservation à l'entrée.

Base graphique : template [Grilli](https://github.com/codewithsadee/grilli) (MIT), restylé Afro Brunch.

---

## Comment ça marche

```
                      index.html  (#booking)
                            │
        1. nom, email, tél, nombre de places
        2. scan du QR GCash ou BPI, paiement
        3. n° de transaction + capture d'écran
                            │
                     ▼  requête vers
              Google Apps Script (Code.gs)
                            │
        ┌───────────────────┼────────────────────────┐
        ▼                   ▼                        ▼
  Google Sheet        Google Drive            2 emails partent
  onglet              capture d'écran         • acheteur : « demande reçue »
  « Reservations »    (privée)                • organisateur : preuve + boutons
  statut PENDING                                [VALIDER] [REFUSER]
                                                        │
                          l'organisateur clique VALIDER │
                                                        ▼
                            • statut → CONFIRMED dans « Reservations »
                            • nom ajouté à l'onglet « Guest list »
                            • email à l'acheteur avec son N° DE RÉSERVATION + QR
                                                        │
                                                        ▼
                          verify.html  ← contrôle à l'entrée
                          (et pointage des arrivées en mode staff)
```

---

## Fichiers

| Fichier | Rôle |
|---|---|
| `index.html` | La landing page + le tunnel de réservation en 4 étapes |
| `verify.html` | Vérification d'un numéro de réservation (public + mode staff) |
| `assets/js/config.js` | **Le seul fichier à modifier côté site** — API, tarifs adulte/enfant, contacts |
| `assets/js/booking.js` | Logique du tunnel : étapes, QR, compression de la capture, envoi |
| `assets/js/verify.js` | Interrogation du serveur pour vérifier un numéro |
| `assets/css/afrobrunch.css` | Surcouche graphique Afro Brunch (le template n'est pas modifié) |
| `apps-script/Code.gs` | **Tout le backend** : Sheet, Drive, emails, validation, vérification |

---

## Mise en route — 6 étapes, environ 20 minutes

### 1. Créer le Google Sheet

Sur [sheets.new](https://sheets.new), créez un classeur et nommez-le par exemple
**Afro Brunch 2026**. Vous n'avez aucune colonne à créer : le script s'en charge.

### 2. Installer le script

Dans ce classeur : **Extensions › Apps Script**.
Supprimez le contenu de `Code.gs`, collez tout le contenu de `apps-script/Code.gs`,
puis remplissez les **4 lignes marquées `<< A REMPLIR >>`** en haut du fichier :

| Ligne | À mettre |
|---|---|
| `ORGANIZER_EMAILS` | l'adresse qui reçoit les demandes à valider (plusieurs séparées par une virgule) |
| `SITE_URL` | l'adresse GitHub Pages du site, avec le `/` final |
| `SECRET` | une longue phrase inventée par vous — elle signe les liens de validation, ne la partagez jamais |
| `STAFF_KEY` | un mot de passe pour le mode pointage à l'entrée |

Enregistrez (⌘S).

### 3. Lancer `setup` une fois

En haut de l'éditeur, choisissez la fonction **`setup`** puis **Exécuter**.
Google demande les autorisations (Gmail, Sheets, Drive) : acceptez —
sur l'écran « Google n'a pas validé cette application », cliquez sur
*Paramètres avancés* puis *Accéder à …*.

Le journal doit afficher les feuilles créées et, le cas échéant, ce qu'il reste à remplir.

### 4. Déployer en application web

**Déployer › Nouveau déploiement › Type : Application web**, puis :

- Exécuter en tant que : **moi**
- Qui a accès : **tout le monde**

Cliquez sur **Déployer** et copiez l'URL obtenue — elle se termine par `/exec`.

> ⚠️ À chaque modification de `Code.gs`, refaites **Déployer › Gérer les déploiements ›
> ✏️ › Version : nouvelle version**. Sinon vos changements ne sont pas pris en compte.

### 5. Brancher le site

Ouvrez `assets/js/config.js` et remplissez les deux lignes `<< A REMPLIR >>` :

```js
API_URL:  'https://script.google.com/macros/s/AKfy…/exec',   // l'URL de l'étape 4
SITE_URL: 'https://afrobrunch.online/',   // deja rempli
```

### 6. Publier sur GitHub Pages

```bash
cd "/Users/Djinan/Documents/Site en construction/AfroBrunch"
git init
git add .
git commit -m "Afro Brunch — site et billetterie"
git branch -M main
git remote add origin https://github.com/Djinan2693/afrobrunch.git
git push -u origin main
```

Puis sur GitHub : **Settings › Pages › Source : Deploy from a branch › `main` / `root`**.
Le site est en ligne au bout d'une minute sur `https://afrobrunch.online/`.

---

## Vérifier que tout fonctionne

1. Dans l'éditeur Apps Script, lancez la fonction **`sendTestEmail`** :
   vous devez recevoir l'email organisateur avec les deux boutons.
2. Ouvrez le site, faites une réservation complète avec votre propre adresse email.
3. Vous recevez l'email « demande reçue », l'organisateur reçoit l'email à valider.
4. Cliquez sur **Validate the payment** : une page de confirmation s'affiche,
   la ligne passe à `CONFIRMED`, le nom apparaît dans l'onglet **Guest list**,
   et vous recevez le numéro de réservation.
5. Sur `verify.html`, saisissez ce numéro : il doit ressortir **Confirmed**.

---

## Le jour de l'événement

Ouvrez sur le téléphone de la personne à l'entrée :

```
https://afrobrunch.online/verify.html?staff=VOTRE_STAFF_KEY
```

Chaque numéro saisi affiche le nom, le détail adultes / enfants et le statut.
Un bouton **Mark as checked in** apparaît pour pointer l'arrivée : l'heure est
inscrite dans le Sheet, et un invité déjà pointé est signalé
(*Already checked in*) — ce qui empêche qu'un même numéro serve deux fois.

En mode staff, l'onglet **I lost my number** accepte aussi la **recherche par nom
seul** (même partiel) : pratique quand quelqu'un se présente sans rien. Pour le
public, en revanche, l'adresse email est obligatoire — sinon n'importe qui
pourrait parcourir votre liste d'invités en tapant des noms au hasard.

L'onglet **Guest list** du classeur est la liste à imprimer en secours.

---

## Production — ce qui est en place

Le site est en ligne sur **https://afrobrunch.online** (hébergement cPanel, compte
`afrobrunch`, serveur `45.67.139.10` / `s23.srv-console.com`).

Déploiement d'une mise à jour :

```bash
./deploy.sh
```

Le script n'envoie que les fichiers réellement référencés par le site. Le jeton API
est lu dans `.cpanel-token`, **exclu du dépôt** — ce dépôt est public, aucune
credential ne doit y figurer.

### DNS et messagerie

| Élément | Valeur | Rôle |
|---|---|---|
| Serveurs de noms | `ns3.yottasrc.com`, `ns4.yottasrc.com` | les `*.h-goldh.com` pointaient vers 127.0.0.1 et cassaient tout le domaine |
| A / www | `45.67.139.10` | le site |
| MX | `mx.zoho.com` 10, `mx2` 20, `mx3` 50 | la messagerie chez Zoho |
| SPF | `v=spf1 +a +mx +ip4:45.67.139.10 include:zoho.com include:relay.mailchannels.net ~all` | autorise Zoho **et** le serveur cPanel |
| DKIM | `zmail._domainkey` | signature Zoho |
| DMARC | `_dmarc` : `p=none` | à resserrer en `quarantine` une fois les envois vérifiés |

Le domaine est en **Remote Mail Exchanger** dans cPanel : sans ce réglage, cPanel
continuerait de livrer le courrier localement malgré les MX Zoho, et rien
n'arriverait dans les boîtes Zoho.

---

## Tarifs

Les deux tarifs sont dans `assets/js/config.js` **et** dans `apps-script/Code.gs` —
pensez à les changer aux deux endroits si vous ajustez les prix :

| | Tarif | Réglage |
|---|---|---|
| Adulte | ₱1 700 | `PRICE_ADULT` |
| Enfant 7–12 ans | ₱700 | `PRICE_CHILD` — libellé : `CHILD_AGES` |
| Moins de 7 ans | **gratuit** | comptés mais jamais facturés — libellé : `INFANT_AGES` |

Le montant à payer est **toujours recalculé par le serveur** à partir du nombre
d'adultes et d'enfants : ce que le navigateur annonce n'est jamais pris pour argent
comptant.

Les moins de 7 ans sont saisis dans le formulaire mais coûtent ₱0. On les compte
quand même, car ils mangent et occupent une place : la feuille distingue
**Tickets** (billets payants) de **Guests** (personnes réellement à table). Une
réservation composée uniquement de moins de 7 ans est refusée — il faut au moins
un billet payant.

---

## Bon à savoir

- **Quota d'emails** : un compte Gmail gratuit peut envoyer **100 emails par jour**
  (1 500 avec Google Workspace). Chaque réservation en consomme 2, plus 1 à la
  validation. Au-delà de ~30 réservations par jour, étalez ou passez sur Workspace.
- **Les captures d'écran de paiement restent privées** : elles sont rangées dans le
  dossier Drive `Afro Brunch - Payment proofs` et envoyées à l'organisateur
  directement dans le corps de l'email — aucun lien public n'est créé.
- **Les liens de validation sont signés** avec votre `SECRET` : ils ne fonctionnent
  que pour une réservation et une action précises, et ne peuvent pas être devinés.
- **Rien n'est jamais perdu** : la ligne est écrite dans le Sheet *avant* l'envoi des
  emails. Si Gmail échoue, la demande est quand même dans le classeur et peut être
  traitée à la main (changez `Status` en `CONFIRMED`).
- **Modifier un statut à la main** dans le Sheet fonctionne, mais n'envoie aucun email.
- **Si vous aviez déjà lancé une version précédente**, la feuille `Reservations`
  contient les anciennes colonnes (sans *Adults* ni *Children*). Supprimez l'onglet
  et relancez `setup` : il sera recréé avec la bonne structure. Sans cela, les
  colonnes seront décalées.

---

## À personnaliser avant l'ouverture des ventes

Les 6 vignettes du menu ont été **découpées dans vos deux flyers** : ce sont donc bien
vos plats. Les images de fond (hero, cartes du haut, bandeau « Eat All You Can ») viennent
encore du template — remplacez-les par vos propres photos en gardant les noms de fichiers :

| Fichier | Où ça s'affiche |
|---|---|
| `assets/images/hero-slider-1..3.jpg` | Les 3 grandes images du haut (paysage, ~1880×950) |
| `assets/images/service-1..3.jpg` | Les 3 cartes « Three Ways To Eat » (~285×336) |
| `assets/images/dish-*.jpg` | Les 6 plats du menu — **déjà découpés dans vos flyers**, à remplacer par de vraies photos si vous en avez (carré, 300×300) |
| `assets/images/special-dish-banner.jpg` | La photo de la section « Eat All You Can » |

Les textes (menu, histoire, tarifs) sont directement dans `index.html`,
et les coordonnées / prix dans `assets/js/config.js`.

---

## Licence

Template graphique : [Grilli](https://github.com/codewithsadee/grilli) par codewithsadee, licence MIT
(voir `LICENSE-template-grilli`). Contenus, visuels et code de réservation : Afro Brunch.
