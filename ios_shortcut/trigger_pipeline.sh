#!/bin/bash
# GitHub Actions ワークフローをiPhoneのショートカットアプリから起動するためのcurlコマンド例
# このコマンドをiOSショートカットの「URLの内容を取得」アクションに設定する

# ── 設定 ────────────────────────────────────────────────
GITHUB_TOKEN="ghp_xxxxxxxxxxxxxxxxxxxx"  # GitHub Personal Access Token (repo, workflow スコープ)
REPO_OWNER="anyn24-hub"
REPO_NAME="affiriate"
WORKFLOW_FILE="daily_pipeline.yml"
BRANCH="main"
# ────────────────────────────────────────────────────────

curl -s -X POST \
  -H "Accept: application/vnd.github+json" \
  -H "Authorization: Bearer ${GITHUB_TOKEN}" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  "https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/actions/workflows/${WORKFLOW_FILE}/dispatches" \
  -d "{\"ref\":\"${BRANCH}\",\"inputs\":{\"skip_tdnet\":\"false\",\"dry_run\":\"false\"}}"

echo "✅ パイプライン起動完了！GitHub Actionsページで進捗を確認してください。"
echo "https://github.com/${REPO_OWNER}/${REPO_NAME}/actions"
