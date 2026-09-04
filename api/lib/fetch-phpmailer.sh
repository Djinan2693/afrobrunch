#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
V=v6.9.3
for f in PHPMailer.php SMTP.php Exception.php; do
  curl -sL "https://raw.githubusercontent.com/PHPMailer/PHPMailer/$V/src/$f" -o "$f"
  echo "  $f"
done
