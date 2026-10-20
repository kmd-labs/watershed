#!/usr/bin/env node
import { execSync } from 'node:child_process';

const repo = 'kmd-labs/watershed';
const protection = {
  "required_status_checks": null,
  "enforce_admins": false,
  "required_pull_request_reviews": {
    "dismiss_stale_reviews": true,
    "require_code_owner_reviews": false,
    "require_last_push_approval": false,
    "required_approving_review_count": 1
  },
  "restrictions": null,
  "required_linear_history": false,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "block_creations": false,
  "required_conversation_resolution": false,
  "lock_branch": false,
  "allow_fork_syncing": false
};

try {
  // Ensure repo exists on GitHub under kmd-labs (or create it if missing)
  try {
    execSync(`gh repo view ${repo}`, { stdio: 'ignore' });
  } catch {
    console.log(`Creating public repository ${repo}...`);
    execSync(`gh repo create ${repo} --public --source=. --remote=origin`, { stdio: 'inherit' });
  }

  // Ensure origin remote is configured and main is pushed
  try {
    execSync('git remote get-url origin', { stdio: 'ignore' });
  } catch {
    execSync(`git remote add origin https://github.com/${repo}.git`, { stdio: 'inherit' });
  }
  execSync('git push -u origin main', { stdio: 'inherit' });

  // Enable GitHub Pages via GitHub Actions workflow if not already enabled
  try {
    execSync(`gh api repos/${repo}/pages -X POST -f build_type=workflow`, { stdio: 'ignore' });
  } catch {
    try {
      execSync(`gh api repos/${repo}/pages -X PUT -f build_type=workflow`, { stdio: 'ignore' });
    } catch {}
  }

  // Apply canonical KMD main branch protection (1 PR review, dismiss stale reviews, only org admins bypass)
  console.log(`🔒 Applying KMD branch protection rules to ${repo} (main)...`);
  execSync(`gh api repos/${repo}/branches/main/protection -X PUT --input -`, {
    input: JSON.stringify(protection),
    stdio: ['pipe', 'inherit', 'inherit']
  });
  console.log(`✅ Branch protection & GitHub Pages active on ${repo}!`);
} catch (err) {
  console.warn('⚠️ Could not complete GitHub repo/protection setup automatically. Run "npm run setup:github" once the repo is pushed.');
}
