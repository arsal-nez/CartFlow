# CartFlow

CartFlow is a portfolio-grade, cloud-native e-commerce and inventory application.

The repository is organized as an independently deployable monorepo:

```text
cartflow/
  backend/    # Serverless Framework + AWS Lambda API (products, cart, inventory, uploads, auth)
  frontend/   # React customer storefront + admin dashboard
  docs/
  .github/workflows/
```

## Stack

- Frontend: React, Vite, TypeScript, React Router, TanStack Query, React Hook Form, Zod.
- Backend: Node.js, TypeScript, Serverless Framework, AWS Lambda, API Gateway HTTP API, DynamoDB, S3, Cognito, Middy, Zod.
- Quality: strict TypeScript, ESLint, Prettier, Jest (unit + integration), GitHub Actions.

## Commands

```bash
npm install
npm run typecheck
npm run lint
npm test
npm run frontend:build
npm run backend:build
```

Each command runs across both npm workspaces (`backend`, `frontend`). Scope to one with
`--workspace=backend` or `--workspace=frontend`, e.g. `npm run test --workspace=backend`.

## CI/CD

Three GitHub Actions workflows live in `.github/workflows/`:

| Workflow          | Trigger                                                                         | Purpose                                                                  |
| ----------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `backend-ci.yml`  | PRs touching `backend/**`, pushes to `main`, and as a reusable `workflow_call`  | `npm install` → lint → typecheck → test → build for `@cartflow/backend`  |
| `frontend-ci.yml` | PRs touching `frontend/**`, pushes to `main`, and as a reusable `workflow_call` | `npm install` → lint → typecheck → test → build for `@cartflow/frontend` |
| `deploy.yml`      | Pushes to `main` (and manual dispatch)                                          | Calls both CI workflows as jobs, then deploys — see below                |

**Deployment only happens after CI succeeds.** `deploy.yml` calls `backend-ci.yml` and
`frontend-ci.yml` as reusable workflows and makes every deploy job `needs: [backend-ci,
frontend-ci]`. This is a job-graph dependency, not a polling check: GitHub Actions will not
start a deploy job unless both CI jobs completed successfully in the same run, so there's no
window where a broken build could reach production.

- **Backend** deploys via the Serverless Framework straight to AWS (`serverless deploy --stage
prod`), authenticated through short-lived credentials obtained via GitHub's OIDC provider —
  no AWS access key or secret is ever stored in GitHub or committed to source control.
- **Frontend** deploys to Vercel via the Vercel CLI (`vercel pull` → `vercel build` → `vercel
deploy --prebuilt`), authenticated with a Vercel API token stored as an encrypted GitHub
  secret.

### Configuring deploy credentials

Deployment secrets are configured once, outside of source control, as **GitHub Actions
repository secrets** (Settings → Secrets and variables → Actions). None of these values are
ever written to a workflow file or committed to the repo:

**AWS (backend), via OpenID Connect — no long-lived keys:**

1. In AWS IAM, add `token.actions.githubusercontent.com` as an OIDC identity provider (one time
   per AWS account).
2. Create an IAM role that trusts that provider, scoped to this repository (and, ideally, to
   the `main` branch specifically) via a trust-policy condition on
   `repo:<org>/<repo>:ref:refs/heads/main`. Attach only the permissions the `serverless deploy`
   actually needs (CloudFormation, Lambda, API Gateway, DynamoDB, S3, Cognito, IAM
   `PassRole`/role creation for the stack) — not `AdministratorAccess`.
3. Add that role's ARN as the repository secret `AWS_DEPLOY_ROLE_ARN`. Optionally set the
   repository **variable** `AWS_REGION` (defaults to `us-east-1` if unset).

**Vercel (frontend):**

1. Create a Vercel project for `frontend/` (either set its dashboard "Root Directory" to
   `frontend`, or run `vercel link` from inside `frontend/` locally once to establish the
   project).
2. Generate a Vercel API token (Vercel → Account Settings → Tokens) scoped to that project if
   possible.
3. Add three repository secrets: `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` (the
   latter two come from `.vercel/project.json` after `vercel link`, or the Vercel dashboard).

**Optional extra safeguard:** both deploy jobs target a GitHub Actions **environment** named
`production`. Creating that environment (Settings → Environments) is optional, but it unlocks
environment-scoped secrets and, if you want it, a required-reviewer approval gate that sits in
front of every deploy — on top of, not instead of, the CI gate above.

## Branch protection recommendations

CI enforcement only matters if it can't be bypassed. Configure these on `main` under
**Settings → Branches → Branch protection rules**:

- **Require a pull request before merging** — disable direct pushes to `main` (including for
  admins, if your plan supports it) so every change goes through review and CI.
- **Require status checks to pass before merging**, and select the two CI jobs by name:
  - `Backend CI / Install, lint, typecheck, test, build`
  - `Frontend CI / Install, lint, typecheck, test, build`
- **Require branches to be up to date before merging** — re-runs CI against the actual merge
  result, not a stale base, so `deploy.yml`'s post-merge run isn't the first time a bad
  combination of changes is actually tested together.
- **Require conversation resolution before merging.**
- **Require signed commits**, if your team's workflow supports it.
- **Do not allow bypassing the above settings**, including for repository administrators —
  otherwise the protection is opt-in, not enforced.
- **Restrict who can push to matching branches** to a small deploy/release group, or to no one
  (merge-only via PR).

With this configured, `main` can only ever advance via a reviewed PR that passed both CI
workflows — which is exactly the precondition `deploy.yml` also independently re-verifies
before it will deploy anything.

## Documentation

Architecture and implementation planning live in `docs/`.

Infrastructure is defined in `backend/serverless.yml` with stage configuration in
`backend/config/` (`dev.yml` for local/PR-adjacent development, `prod.yml` for the deployed
stage).
