#!/usr/bin/env bash
set -euo pipefail

date_label="${1:?date label is required}"
message_prefix="${2:?commit message prefix is required}"

data_files=()
while IFS= read -r data_file; do
  if [ -n "${data_file}" ]; then
    data_files+=("${data_file}")
  fi
done < <(
  {
    git diff --name-only -- data
    git ls-files --others --exclude-standard -- data
  } | sort -u
)

if [ "${#data_files[@]}" -eq 0 ]; then
  echo "No data changes to commit."
  exit 0
fi

git status --short -- data

commit_count=0
for data_file in "${data_files[@]}"; do
  if [ -z "${data_file}" ]; then
    continue
  fi

  git add -- "${data_file}"

  if git diff --cached --quiet -- "${data_file}"; then
    git reset -q -- "${data_file}"
    continue
  fi

  git diff --cached --stat -- "${data_file}"
  commit_subject="${message_prefix} ${data_file#data/} (${date_label})"
  git commit -m "${commit_subject}" -- "${data_file}"
  commit_count=$((commit_count + 1))
done

echo "Committed ${commit_count} data file(s)."
