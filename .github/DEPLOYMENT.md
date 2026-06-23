# CI/CD setup

Two workflows live in `.github/workflows`:

| Workflow | Trigger | What it does |
| --- | --- | --- |
| `ci.yml` | PRs + pushes to any branch except `main` | `npm ci`, `prisma generate`, lint, test, `nest build` |
| `cd.yml` | push to `main` (and manual `workflow_dispatch`) | Build & push the Docker image to ACR, then `az containerapp update` |

Tests and the production build also run *inside* `backend/Dockerfile`, so a CD run can't deploy an image whose tests fail.

## One-time Azure setup (OIDC, no stored secrets)

GitHub authenticates to Azure with short-lived OIDC tokens — there is no
long-lived credential to rotate. Run these once (replace the org/repo if it ever
moves). Requires `az login` as someone who can create app registrations and
assign roles.

```bash
SUBSCRIPTION_ID=295f53a3-9253-4547-8062-51d425160903
RESOURCE_GROUP=sloms
ACR_NAME=slomsacregistry2026
APP_NAME=sloms-be-github-actions
REPO=Sonic-Labs-Ltd/sloms-be

# 1. Create an app registration + service principal
APP_ID=$(az ad app create --display-name "$APP_NAME" --query appId -o tsv)
az ad sp create --id "$APP_ID"
OBJECT_ID=$(az ad app show --id "$APP_ID" --query id -o tsv)

# 2. Federated credential: trust pushes to the main branch of this repo
az ad app federated-credential create \
  --id "$OBJECT_ID" \
  --parameters '{
    "name": "github-main",
    "issuer": "https://token.actions.githubusercontent.com",
    "subject": "repo:'"$REPO"':ref:refs/heads/main",
    "audiences": ["api://AzureADTokenExchange"]
  }'

# (Optional) also trust the "production" GitHub Environment, used by cd.yml:
az ad app federated-credential create \
  --id "$OBJECT_ID" \
  --parameters '{
    "name": "github-env-production",
    "issuer": "https://token.actions.githubusercontent.com",
    "subject": "repo:'"$REPO"':environment:production",
    "audiences": ["api://AzureADTokenExchange"]
  }'

# 3. Grant the SP the rights it needs
SP_ID=$(az ad sp show --id "$APP_ID" --query id -o tsv)

#    Push images to ACR
ACR_ID=$(az acr show --name "$ACR_NAME" --query id -o tsv)
az role assignment create --assignee-object-id "$SP_ID" \
  --assignee-principal-type ServicePrincipal \
  --role AcrPush --scope "$ACR_ID"

#    Update the Container App (Contributor on the resource group is simplest)
az role assignment create --assignee-object-id "$SP_ID" \
  --assignee-principal-type ServicePrincipal \
  --role Contributor \
  --scope "/subscriptions/$SUBSCRIPTION_ID/resourceGroups/$RESOURCE_GROUP"

# 4. Print the three values to store as GitHub secrets
echo "AZURE_CLIENT_ID=$APP_ID"
echo "AZURE_TENANT_ID=$(az account show --query tenantId -o tsv)"
echo "AZURE_SUBSCRIPTION_ID=$SUBSCRIPTION_ID"
```

## GitHub repo configuration

1. **Settings → Secrets and variables → Actions → New repository secret** — add:
   - `AZURE_CLIENT_ID`
   - `AZURE_TENANT_ID`
   - `AZURE_SUBSCRIPTION_ID`
2. **Settings → Environments → New environment** named `production`. Optionally
   add required reviewers there to make deploys manual-approval.
3. (Recommended) **Settings → Branches** — protect `main` and require the CI
   check to pass before merge.

## Notes

- The Container App `slomsapi` must already exist (it does, per
  `backend/src/config/containerapp-config.yaml`). `cd.yml` only updates its
  image; it does not create the app or environment.
- The `subject` in step 2 must match exactly. If you later deploy from a
  different branch or environment, add another federated credential for it.
