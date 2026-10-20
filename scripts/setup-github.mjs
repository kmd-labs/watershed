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

const run = (cmd, opts = {}) => execSync(cmd, { stdio: 'inherit', ...opts });
const runSilent = (cmd, opts = {}) => execSync(cmd, { stdio: 'pipe', ...opts });

try {
  // 1. Verify GitHub CLI authentication
  try {
    runSilent('gh auth status');
  } catch {
    console.warn('⚠️ GitHub CLI (gh) is not authenticated. Please run "gh auth login" and then "npm run setup:github".');
    process.exit(0);
  }

  // 2. Ensure repo exists on GitHub under kmd-labs (or create it if missing)
  try {
    runSilent(`gh repo view ${repo}`);
  } catch {
    console.log(`Creating public repository ${repo}...`);
    run(`gh repo create ${repo} --public`);
  }

  // 3. Ensure origin remote is configured
  try {
    runSilent('git remote get-url origin');
  } catch {
    run(`git remote add origin https://github.com/${repo}.git`);
  }

  // 4. Enable GitHub Pages via GitHub Actions BEFORE pushing so the initial workflow succeeds immediately
  console.log(`🌐 Enabling GitHub Pages (GitHub Actions) on ${repo}...`);
  try {
    runSilent(`gh api repos/${repo}/pages -X POST -f build_type=workflow`);
    console.log('✅ GitHub Pages enabled with GitHub Actions!');
  } catch {
    try {
      runSilent(`gh api repos/${repo}/pages -X PUT -f build_type=workflow`);
      console.log('✅ GitHub Pages updated to GitHub Actions!');
    } catch {}
  }

  // 5. Push main branch
  console.log(`🚀 Pushing main branch to ${repo}...`);
  run('git push -u origin main');

  // 6. Confirm GitHub Pages status after branch creation
  try {
    runSilent(`gh api repos/${repo}/pages -X POST -f build_type=workflow`);
  } catch {
    try {
      runSilent(`gh api repos/${repo}/pages -X PUT -f build_type=workflow`);
    } catch {}
  }

  // 7. Apply canonical KMD main branch protection (1 PR review, dismiss stale reviews, org admins bypass)
  console.log(`🔒 Applying KMD branch protection rules to ${repo} (main)...`);
  try {
    execSync(`gh api repos/${repo}/branches/main/protection -X PUT --input -`, {
      input: JSON.stringify(protection),
      stdio: ['pipe', 'inherit', 'inherit']
    });
    console.log(`✅ Branch protection applied to main!`);
  } catch (protErr) {
    console.warn('⚠️ Could not apply branch protection rules automatically (requires org admin privileges).');
  }

  console.log(`\n🎉 Repository setup complete: https://github.com/${repo}`);
  console.log(`🌐 Live site URL: https://kmd-labs.github.io/watershed/\n`);
} catch (err) {
  console.error('⚠️ Could not complete GitHub repo setup automatically:', err.message);
  console.warn('Run "npm run setup:github" once your repository is ready.');
}
