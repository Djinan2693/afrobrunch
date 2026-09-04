#!/usr/bin/env bash
# ---------------------------------------------------------------------------
#  Afro Brunch — deploiement sur cPanel
#
#  Usage :  ./deploy.sh
#
#  Le jeton API est lu dans .cpanel-token (ignore par git, jamais publie).
#  Seuls les fichiers reellement references par le site sont envoyes.
# ---------------------------------------------------------------------------
set -euo pipefail
cd "$(dirname "$0")"

CPANEL_USER=afrobrunch
CPANEL_HOST=https://s23.srv-console.com:2083
DOCROOT=/public_html
SITE=https://afrobrunch.online

if [ -n "${CPANEL_TOKEN:-}" ]; then
  TOKEN=$CPANEL_TOKEN
elif [ -f .cpanel-token ]; then
  TOKEN=$(tr -d ' \t\n\r' < .cpanel-token)
else
  echo "Jeton introuvable. Placez-le dans .cpanel-token, ou exportez CPANEL_TOKEN." >&2
  exit 1
fi

api () { curl -s -k --max-time 60 -H "Authorization: cpanel $CPANEL_USER:$TOKEN" "$@"; }

echo "==> Liste des fichiers utilises par le site"
python3 - > /tmp/afro-deploy-list.txt <<'PY'
import re, os
files = {"index.html", "verify.html", "favicon.svg", ".htaccess"}
for page in ("index.html", "verify.html"):
    h = open(page, encoding="utf-8").read()
    files |= {r[2:] for r in re.findall(r'(?:src|href)="(\./[^"]+)"', h)}
    files |= {r[2:] for r in re.findall(r"url\('(\./[^']+)'\)", h)}
for sheet in ("assets/css/style.css", "assets/css/afrobrunch.css"):
    c = open(sheet, encoding="utf-8").read()
    for r in re.findall(r"url\('(\.\./[^']+)'\)", c):
        files.add(os.path.normpath(os.path.join(os.path.dirname(sheet), r)))
print("\n".join(sorted(f for f in files if os.path.isfile(f))))
PY

TOTAL=$(wc -l < /tmp/afro-deploy-list.txt | tr -d ' ')
echo "    $TOTAL fichier(s)"

echo "==> Televersement"
OK=0; KO=0
# le "|| [ -n \"$f\" ]" rattrape une derniere ligne sans retour a la ligne
while IFS= read -r f || [ -n "$f" ]; do
  [ -z "$f" ] && continue
  d=$(dirname "$f"); dir="$DOCROOT/$d"; [ "$d" = "." ] && dir="$DOCROOT"
  if api -X POST "$CPANEL_HOST/execute/Fileman/upload_files" \
       -F "dir=$dir" -F "overwrite=1" -F "file-1=@$f" | grep -q '"succeeded":1'; then
    OK=$((OK+1))
  else
    KO=$((KO+1)); echo "    ECHEC : $f" >&2
  fi
done < /tmp/afro-deploy-list.txt
echo "    $OK envoye(s), $KO echec(s)"

echo "==> Verification en ligne"
for p in "" verify.html assets/js/config.js assets/css/afrobrunch.css; do
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$SITE/$p")
  printf "    %-32s %s\n" "/$p" "$code"
done

[ "$KO" -eq 0 ] || exit 1
echo "==> Termine : $SITE"
