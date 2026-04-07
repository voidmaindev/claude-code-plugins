---
name: cicd_aws
description: Set up GitHub Actions CI/CD that builds Docker Compose images, pushes to Docker Hub, and deploys to an existing AWS EC2 host behind an existing ALB with Cloudflare subdomains
user-invocable: true
argument-hint: "[--reconfigure]"
---

Wire up GitHub Actions to build Docker Compose services, push them to Docker Hub, and deploy them over SSH to an existing AWS EC2 host that already has Docker installed. As a one-time setup step, also wire the project into an existing AWS ALB (target groups + host-header listener rules), create Cloudflare proxied CNAME records for one subdomain per exposed service, and add the necessary EC2 security-group ingress rules. The deploy phase makes ZERO AWS or Cloudflare API calls — only SSH + Docker.

**Config file:** `cicd_aws.config` (in repo root, visible filename, `key=value` format, auto-added to `.gitignore`)

**Constants (hardcoded):**
- **Workflow file:** `.github/workflows/cicd.yml`
- **Working branch (always):** `stable` — becomes the GitHub default branch
- **Deploy branch resolution order:** if `main` exists use `main`; else if `master` exists use `master`; else create `master`
- **Image registry:** Docker Hub (`docker.io`), public images only
- **Image tags on every deploy:** `latest` AND short git SHA (7 chars)
- **EC2 deploy directory:** `~/apps/<repo-name>/` (created on first deploy)
- **Health-check fallback path:** `/`
- **Health-check preferred paths in order:** `/health`, `/healthz`, `/status`, `/ping`, `/actuator/health`, `/readyz`, `/livez`
- **Health-check scan regex patterns by language:**
  - Express/Koa/Fastify: `app\.(?:get|use)\(['"]([^'"]+)['"]`
  - FastAPI/Flask: `@app\.(?:get|route)\(['"]([^'"]+)['"]`
  - Go (net/http, gorilla, chi, gin): `mux\.HandleFunc\(['"]([^'"]+)['"]` and `router\.(?:GET|Handle)\(['"]([^'"]+)['"]`
  - Spring Boot: `@(?:Get|Request)Mapping\(['"]([^'"]+)['"]`
- **GitHub Secrets written:** `EC2_SSH_KEY`, `EC2_HOST`, `EC2_USER`, `DOCKERHUB_USERNAME`, `DOCKERHUB_TOKEN`
- **GitHub Variables written:** `DEPLOY_BRANCH`, `COMPOSE_PROJECT_NAME`, plus one `<SERVICE>_HOST_PORT` per service whose host port was resolved
- **AWS resource tagging:** every AWS resource created by this skill is tagged `ManagedBy=cicd_aws_skill`, `Repo=<repo-name>`, `Service=<service-name>`
- **Assumed-present resources** (skill never creates or modifies these): EC2 instance with Docker, ALB with HTTPS:443 listener bound to a wildcard ACM cert covering the chosen domain, Cloudflare zone for that domain (added via the Cloudflare dashboard with NS delegation already in place at the registrar)
- **Required AWS IAM permissions** (the user's local `aws` CLI principal must have these):
  ```
  sts:GetCallerIdentity
  ec2:DescribeRegions
  ec2:DescribeInstances
  ec2:DescribeSecurityGroups
  ec2:DescribeSecurityGroupRules
  ec2:DescribeVpcs
  ec2:AuthorizeSecurityGroupIngress
  elasticloadbalancing:DescribeLoadBalancers
  elasticloadbalancing:DescribeListeners
  elasticloadbalancing:DescribeListenerCertificates
  elasticloadbalancing:DescribeRules
  elasticloadbalancing:DescribeTargetGroups
  elasticloadbalancing:DescribeTargetHealth
  elasticloadbalancing:DescribeTags
  elasticloadbalancing:CreateTargetGroup
  elasticloadbalancing:ModifyTargetGroup
  elasticloadbalancing:RegisterTargets
  elasticloadbalancing:CreateRule
  elasticloadbalancing:ModifyRule
  elasticloadbalancing:AddTags
  acm:DescribeCertificate
  acm:ListCertificates
  ```
- **Cloudflare API base:** `https://api.cloudflare.com/client/v4`
- **Cloudflare API token scope required:** `Zone:Zone:Read` AND `Zone:DNS:Edit`, scoped to the chosen zone (or to all zones on the account)
- **Cloudflare default record state on every record this skill creates:** `type=CNAME`, `proxied=true`, `ttl=1` (auto, required when proxied)

**Procedure:**

1. **Environment sanity checks** — Run all of these. Collect failures and report them all together before stopping (so the user fixes everything at once):
   - `git rev-parse --show-toplevel` — must succeed. Record as `<repo_root>` and `cd` to it.
   - `gh auth status` — must succeed. If not, tell user to run `gh auth login` and STOP.
   - `gh repo view --json nameWithOwner,defaultBranchRef,url` — capture `<gh_repo_slug>` (e.g. `voidmaindev/myapp`), `<gh_repo_url>`, and `<repo_name>` = the part after `/`.
   - `gh --version` — must be `2.34` or newer (needed for `gh variable set`). STOP with upgrade instructions if older.
   - Look for `<repo_root>/docker-compose.yml` or `<repo_root>/compose.yml`. STOP with `"No docker-compose.yml or compose.yml found in repo root. This skill only supports Docker Compose projects."` if neither exists.
   - Look for `<repo_root>/.github/workflows/cicd.yml`. If it exists AND `--reconfigure` was NOT passed, use the AskUserQuestion tool with options **Overwrite** / **Cancel**. Cancel → STOP with `"No changes made."`.
   - `which aws` and `aws --version` — must succeed. If not, print the OS-specific install command (don't install silently) and STOP.
   - `aws sts get-caller-identity --output json` — if it fails with "Unable to locate credentials" or similar, walk the user through `aws configure` (or `aws configure sso`), wait for them to finish, then re-run this command. STOP only if the user gives up. On success, record `<aws_account_id>` and `<aws_arn>`.
   - `which ssh` and `which docker` — must succeed.

2. **Detect re-run state:**
   - Check for `<repo_root>/cicd_aws.config`.
   - **If it does NOT exist** AND `--reconfigure` was not passed → proceed to Step 3 as a fresh run.
   - **If it exists** OR `--reconfigure` was passed → parse the file into `<existing_config>`. Use the AskUserQuestion tool (dialog mode) to ask:
     > "`cicd_aws.config` already exists in this repo. What would you like to do?"
     > Options: **Update specific fields** / **Reconfigure from scratch** / **Cancel**
   - If `--reconfigure` was passed, skip the dialog and behave as if the user picked **Reconfigure from scratch**.
   - **Cancel** → STOP, no changes.
   - **Reconfigure from scratch** → keep the old config in memory for reference but proceed as a fresh run; only overwrite the file at the very end.
   - **Update specific fields** → present a second AskUserQuestion listing each config key with its current value, let the user multi-select which to re-ask. Run only the affected steps. At the end, re-emit the workflow file and GitHub Secrets/Variables so they stay in sync.

3. **Parse `docker-compose.yml`:**
   - Read and parse `<repo_root>/docker-compose.yml` (or `compose.yml`) as YAML.
   - For each service collect: `name` (service key), `image` (string), `build.context` (default `.` if `build` is a string, the `context` key if it's a map, or null if no `build`), `ports[]` (handle all three forms: short string `"3000:3000"`, bare short `3000:3000`, long form `{ target: 3000, published: 3000, protocol: tcp, mode: host }`).
   - **STOP** if any service is missing `image:` — name the offender: `"Service '<name>' has no image: field. Every service must declare a Docker Hub image name so CI can push it. Add an image: field and re-run."`
   - **STOP** if any image uses a non-Docker-Hub registry. An image uses a non-Docker-Hub registry if the part before the first `/` contains a `.` or `:` (e.g. `gcr.io/foo/bar`, `ghcr.io/foo/bar`, `123456789.dkr.ecr.us-east-1.amazonaws.com/bar`). Message: `"Service '<name>' uses non-Docker-Hub registry '<image>'. This skill only supports Docker Hub in v1."`
   - **STOP** if there are zero services.
   - Build an in-memory list `services = [{name, image, build_context, host_ports: [...]}]`.

4. **Collect deployment inputs from the user** (free-text prompts in this order):
   1. **EC2 host:** "What's the public DNS or IP of the EC2 instance to deploy to?" → `<ec2_host>`
   2. **EC2 SSH user:** "What SSH user should GitHub Actions connect as? (e.g., `ubuntu`, `ec2-user`, `admin`)" → `<ec2_user>`
   3. **SSH private key path:** "Full local path to the SSH private key for that user." → `<ssh_key_path>`
      - Validate `ls "<ssh_key_path>"` succeeds.
      - Read the first line and confirm it starts with `-----BEGIN`. NEVER print key contents.
   4. **AWS region:** "AWS region where the EC2, ALB, and hosted zone live (e.g., `us-east-1`)." → `<aws_region>`
      - Validate via `aws ec2 describe-regions --region-names <aws_region> --region <aws_region>`.
   5. **Docker Hub username:** → `<dockerhub_username>`
   6. **Docker Hub access token or password:** "Paste a Docker Hub access token (recommended) or your password. This is written to a GitHub Secret and never stored locally." → `<dockerhub_token>` (in memory only, never written to the config file).
   7. **Cloudflare API token:** "Paste a Cloudflare API token with `Zone:Zone:Read` and `Zone:DNS:Edit` permission scoped to the zone you'll deploy into (or to all zones). The token is saved to the local `cicd_aws.config` file (which is in `.gitignore`) so re-runs don't have to re-prompt." → `<cf_api_token>`.
      - On re-run mode, if `<existing_config>` already contains `cloudflare_api_token`, present that value as the default — the user can press Enter to accept it or paste a new one.
      - Validate immediately (always, even when reusing the saved value):
        ```bash
        curl -fsS -H "Authorization: Bearer <cf_api_token>" https://api.cloudflare.com/client/v4/user/tokens/verify
        ```
      - STOP on non-success with `"Cloudflare token verification failed: <api error message>"`.

5. **Verify SSH connection to EC2:**
   ```bash
   ssh -i "<ssh_key_path>" -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=5 <ec2_user>@<ec2_host> 'docker compose version && docker ps && id'
   ```
   - If it fails, distinguish the error and report clearly:
     - `Permission denied (publickey)` → wrong key file or wrong SSH user
     - `Connection refused` / `timed out` → EC2 security group blocks port 22 from your IP
     - `docker: command not found` → Docker not installed on EC2
     - `docker compose: 'compose' is not a docker command` → old standalone `docker-compose`; v1 needs the modern `docker compose` plugin
     - Failure on `docker ps` (but `docker --version` works) → SSH user not in the `docker` group
     - Something about `Enter passphrase` → the key is passphrase-protected; tell user: `"Passphrase-protected keys can't be used by GitHub Actions. Generate a new key without a passphrase or strip the passphrase with ssh-keygen -p."`
   - STOP on any failure.

6. **Verify Docker Hub credentials:**
   ```bash
   echo "<dockerhub_token>" | docker login -u "<dockerhub_username>" --password-stdin
   ```
   - STOP on failure with: `"Docker Hub authentication failed. Check the username and token."`
   - On success, immediately run `docker logout` so the creds don't linger in the local Docker config.

7. **Determine deploy branch:**
   - `git ls-remote --heads origin main master`
   - If `refs/heads/main` is present → `<deploy_branch> = main`
   - Else if `refs/heads/master` is present → `<deploy_branch> = master`
   - Else → `<deploy_branch> = master` and mark `create_deploy_branch = true`
   - `git ls-remote --heads origin stable` — if not present, mark `create_stable_branch = true`
   - Make NO remote changes yet — those happen in Step 20.

8. **Port collision detection (one-time, with re-run preservation):**
   - Over SSH, run: `ssh ... 'docker ps --format "{{.Ports}}"'`. Parse each line; ports look like `0.0.0.0:3000->3000/tcp, :::3000->3000/tcp` or `0.0.0.0:8080->80/tcp`. Extract every host port (left of `->`).
   - Also: `ssh ... 'ss -tlnH 2>/dev/null || netstat -tlnH 2>/dev/null'`. Parse listening TCP ports. Union with the docker set into `<ec2_taken_ports>`. Fall back gracefully if neither command is present.
   - **For re-runs only:** read existing `<SERVICE>_HOST_PORT` GitHub Variables via `gh variable list --json name,value` to get `<previous_allocations>`.
   - For each compose service that has host ports, for each `{host, container}` pair:
     1. If a previous allocation exists for this service+index AND that port is NOT in `<ec2_taken_ports>` → reuse it.
     2. If a previous allocation exists but the port IS now in use → ask the user: `"Previously allocated port <port> for service '<name>' is now in use by something else on the EC2 host. Reallocate to <new_port>?"`. STOP if they decline.
     3. Else, if the original `host` port is free → use `host`.
     4. Else, walk upward from `host+1` to the next free port (not in `<ec2_taken_ports>`, not already assigned to another service in this run).
   - **127.0.0.1 binding:** if a service marked-for-exposure has a host port bound to `127.0.0.1` (compose form like `"127.0.0.1:3000:3000"`), auto-rewrite to `0.0.0.0:` in the rewritten compose. Print a notice in the final summary about which services were auto-rewritten.
   - Variable naming: `<SERVICE>_HOST_PORT` (UPPER_SNAKE of service name). If a service has multiple host ports, suffix with `_2`, `_3`, etc.
   - Build the rewritten `docker-compose.yml` IN MEMORY (do NOT write yet):
     - Short-form ports become: `"${<SERVICE>_HOST_PORT:-<original_host>}:<container>"`
     - Long-form ports get: `published: ${<SERVICE>_HOST_PORT:-<original_host>}`
   - Record `<port_map>` = `{ service_name: resolved_host_port }`.

9. **Choose exposed services:**
   - Use AskUserQuestion (multi-select) listing every service that has at least one host port: `"Which services should be publicly exposed through the ALB?"`
   - Allow zero selection. If zero, set `<exposed_services> = []` and skip Steps 10–14 (the workflow + branch setup still make sense for private deployments).
   - For each selected service that has multiple host ports, follow up with a single-select: `"Service '<name>' exposes ports X and Y. Which one is the HTTP entrypoint for external traffic?"`
   - Record per-service `<external_port>`.

10. **Choose Cloudflare zone:**
    - ```bash
      curl -fsS -H "Authorization: Bearer <cf_api_token>" \
        "https://api.cloudflare.com/client/v4/zones?per_page=50&status=active"
      ```
    - Parse `result[]`, collect `{id, name}` for each active zone.
    - STOP if zero zones returned: `"The Cloudflare token has no zones visible. Either the token is scoped to a zone you don't own, or no zones exist on the account."`
    - Present the zones via AskUserQuestion (single-select): `"Which Cloudflare zone should the subdomains be created in?"`
    - Record `<cloudflare_zone_id>` and `<cloudflare_zone_name>` (the bare zone name, no trailing dot).

11. **Per-service subdomain assignment:**
    - For each service in `<exposed_services>`:
      - Default subdomain = the service name lowercased with underscores replaced by hyphens (e.g. `api_v2` → `api-v2`). Default FQDN = `<default>.<cloudflare_zone_name>`.
      - Free-text prompt: `"Subdomain for service '<service>'? [default: <default>] — full FQDN will be <fqdn>."`
      - Empty answer → use the default. Bare label → append `.<cloudflare_zone_name>`. Full FQDN → verify it ends with `.<cloudflare_zone_name>`. Trim trailing dots and whitespace.
      - Validate uniqueness within this run (no two services point at the same FQDN).
    - Record `<service_fqdn_map>`.

12. **Choose ALB:**
    - `aws elbv2 describe-load-balancers --region <aws_region> --query 'LoadBalancers[?Type==\`application\` && Scheme==\`internet-facing\`].{Name:LoadBalancerName,Arn:LoadBalancerArn,DNS:DNSName,HostedZoneId:CanonicalHostedZoneId,VpcId:VpcId,SGs:SecurityGroups}' --output json`
    - v1 supports `internet-facing` ALBs only — STOP if none.
    - Single-select via AskUserQuestion: `"Which ALB should public traffic route through?"`
    - Record `<alb_arn>`, `<alb_dns>`, `<alb_vpc_id>`, `<alb_sg_ids>`.

13. **Verify HTTPS listener exists and certificates cover all chosen FQDNs:**
    - `aws elbv2 describe-listeners --load-balancer-arn <alb_arn> --region <aws_region> --output json`
    - Find the listener where `Port == 443` and `Protocol == HTTPS`. STOP if none with: `"ALB '<name>' has no HTTPS:443 listener. Create one with an ACM cert covering *.<cloudflare_zone_name> before re-running this skill."`
    - Record `<https_listener_arn>`.
    - Collect default certs from the listener AND all SNI certs via `aws elbv2 describe-listener-certificates --listener-arn <arn> --region <aws_region>`.
    - For each cert, `aws acm describe-certificate --certificate-arn <arn> --region <aws_region> --query 'Certificate.{D:DomainName,S:SubjectAlternativeNames}'`.
    - For each chosen FQDN, verify at least one cert covers it. Coverage rules:
      - Literal match against `DomainName` or any SAN.
      - Wildcard match: a cert for `*.foo.com` covers `api.foo.com` but does NOT cover `foo.com` (apex) and does NOT cover `x.api.foo.com` (sub-sub).
    - STOP if any FQDN is uncovered, naming the missing one(s). Do NOT touch ACM.

14. **Detect health-check paths** (per exposed service):
    - If the service has a `build.context`:
      - Recursively scan files under `<repo_root>/<build_context>` whose extensions are in `{.js, .ts, .mjs, .cjs, .py, .go, .java, .kt, .rb, .php, .rs}`.
      - Apply the regex patterns from the Constants section to extract candidate paths.
      - Rank candidates by the preferred-paths priority list. Pick the highest-ranked one that appears at least once.
      - If no preferred path matches but other paths were found, pick the first matched path.
      - If no matches at all, fall back to `/`.
    - If the service has no `build.context` (image-only), fall back to `/` silently.
    - Do NOT prompt the user.
    - Record `<service_healthcheck_map>`.

15. **Detect EC2 instance ID and security groups:**
    - Determine whether `<ec2_host>` is an IP address (regex `^\d+\.\d+\.\d+\.\d+$`) or a DNS name.
    - **If IP:** `aws ec2 describe-instances --filters Name=ip-address,Values=<ec2_host> --region <aws_region> --query 'Reservations[].Instances[].{Id:InstanceId,SGs:SecurityGroups[].GroupId,Vpc:VpcId,State:State.Name}' --output json`. If empty, retry with `Name=private-ip-address,Values=<ec2_host>`.
    - **If DNS:** try `Name=dns-name,Values=<ec2_host>` first, then `Name=private-dns-name,Values=<ec2_host>`. If still empty, ask the user to paste the instance ID directly (free-text prompt).
    - If zero or multiple matches, ask the user to paste the instance ID manually.
    - **STOP** if the instance's `VpcId` does not match `<alb_vpc_id>`: `"EC2 instance is in VPC <vpc>, but the chosen ALB is in VPC <alb_vpc>. Cross-VPC ALB targeting is out of scope for v1."`
    - Warn if `State.name != running` but continue.
    - Record `<ec2_instance_id>`, `<ec2_sg_ids>` (list), `<ec2_vpc_id>`.
    - If the EC2 has multiple SGs, ask: `"EC2 instance has SGs [<list>]. Which one should receive the inbound rules for the new ports?"` → `<ec2_primary_sg_id>`.
    - If the ALB has multiple SGs, ask the user to pick one too → `<alb_primary_sg_id>`.

16. **Plan confirmation** — Show a single consolidated summary of EVERYTHING that will be done, then ask for confirmation:
    - **Git/GitHub changes:**
      - Default branch: `<current>` → `stable`
      - Branches to create: `stable` (if missing), `<deploy_branch>` (if missing)
      - Files to write: `.github/workflows/cicd.yml`, rewritten `docker-compose.yml`, `.gitignore` (append `cicd_aws.config`), `cicd_aws.config`
      - GitHub Secrets to set: `EC2_SSH_KEY`, `EC2_HOST`, `EC2_USER`, `DOCKERHUB_USERNAME`, `DOCKERHUB_TOKEN`
      - GitHub Variables to set: `DEPLOY_BRANCH=<deploy_branch>`, `COMPOSE_PROJECT_NAME=<repo_name>`, and `<SERVICE>_HOST_PORT=<port>` × N
    - **AWS changes per exposed service `<name>`:**
      - Create target group `<repo>-<service>-tg`
      - Register EC2 instance `<id>:<resolved_port>`
      - Add SG ingress rule on `<ec2_primary_sg_id>` allowing TCP `<port>` from `<alb_primary_sg_id>`
      - Add listener rule (host-header `<fqdn>`) on the 443 listener
    - **Cloudflare changes per exposed service `<name>`:**
      - Create proxied CNAME `<fqdn>` → `<alb_dns>` in zone `<cloudflare_zone_name>`
    - **Compose file edits:** list which `ports:` entries are being rewritten with env var placeholders, and which 127.0.0.1 bindings are being auto-rewritten to 0.0.0.0.
    - **De-exposure check:** if this is a re-run AND a previously-exposed service is no longer in the list, STOP and tell the user: `"Service '<name>' was previously exposed. v1 cannot un-expose; either keep it exposed or remove its AWS + Cloudflare resources manually (delete the listener rule, target group, Cloudflare CNAME record, and SG rule), then re-run."`
    - Use AskUserQuestion: `"Apply these changes?"` → **Apply** / **Cancel**.
    - **Cancel** → STOP, zero changes.

17. **Apply: GitHub Secrets and Variables** (BEFORE pushing code so the workflow has them on first run):
    - `gh secret set EC2_SSH_KEY --body-file "<ssh_key_path>"` (use `--body-file` — never load the key into a shell variable)
    - `gh secret set EC2_HOST --body "<ec2_host>"`
    - `gh secret set EC2_USER --body "<ec2_user>"`
    - `gh secret set DOCKERHUB_USERNAME --body "<dockerhub_username>"`
    - `gh secret set DOCKERHUB_TOKEN --body "<dockerhub_token>"`
    - `gh variable set DEPLOY_BRANCH --body "<deploy_branch>"`
    - `gh variable set COMPOSE_PROJECT_NAME --body "<repo_name>"`
    - For each entry in `<port_map>`: `gh variable set <VAR_NAME> --body "<port>"`
    - STOP on any failure.

18. **Apply: AWS resources and Cloudflare DNS** — for each exposed service, in this strict order. ALL `aws` commands include `--region <aws_region>` explicitly. Retry AWS calls on `ThrottlingException` / `RequestLimitExceeded` 3 times with 2s/4s/8s backoff. Retry Cloudflare calls on HTTP `429` 3 times with the same backoff.

    1. **Create target group.** Sanitize the name first: lowercase the `<repo>` and `<service>` portions, replace `_` with `-`, collapse consecutive `--` to one, trim leading/trailing `-`. If `<repo>-<service>-tg` exceeds 32 characters, truncate the `<repo>` portion (NOT the `-<service>-tg` suffix). Document any truncation in the summary.
       - **Idempotency check first:** `aws elbv2 describe-target-groups --names <tg_name> --region <aws_region> 2>/dev/null`. If it exists, verify the port and VPC match. If they match, reuse the ARN. If they don't match, STOP with `"Target group <name> already exists with different port/VPC. Resolve manually before re-running."`
       - Otherwise create:
         ```bash
         aws elbv2 create-target-group \
           --name <tg_name> \
           --protocol HTTP --port <resolved_host_port> \
           --vpc-id <alb_vpc_id> \
           --target-type instance \
           --health-check-protocol HTTP \
           --health-check-path <healthcheck> \
           --health-check-port <resolved_host_port> \
           --healthy-threshold-count 2 \
           --unhealthy-threshold-count 2 \
           --health-check-interval-seconds 15 \
           --health-check-timeout-seconds 5 \
           --matcher HttpCode=200-399 \
           --tags Key=ManagedBy,Value=cicd_aws_skill Key=Repo,Value=<repo_name> Key=Service,Value=<service> \
           --region <aws_region>
         ```
       - Record `<tg_arn>`.

    2. **Register target:**
       ```bash
       aws elbv2 register-targets \
         --target-group-arn <tg_arn> \
         --targets Id=<ec2_instance_id>,Port=<resolved_host_port> \
         --region <aws_region>
       ```
       (Naturally idempotent.)

    3. **Add SG ingress rule** on the EC2 primary SG (MUST happen BEFORE creating the listener rule, so target group health checks succeed on first registration):
       ```bash
       aws ec2 authorize-security-group-ingress \
         --group-id <ec2_primary_sg_id> \
         --ip-permissions 'IpProtocol=tcp,FromPort=<port>,ToPort=<port>,UserIdGroupPairs=[{GroupId=<alb_primary_sg_id>,Description="cicd_aws <repo>/<service>"}]' \
         --region <aws_region>
       ```
       On `InvalidPermission.Duplicate`, log `"already exists, skipping"` and continue.

    4. **Compute next free listener rule priority:**
       - `aws elbv2 describe-rules --listener-arn <https_listener_arn> --query 'Rules[].Priority' --output json --region <aws_region>`
       - Parse as integers (ignore `"default"`). Pick the smallest positive integer not in the used set, starting from 1. Reserve it locally so a second service in the same run doesn't reuse it.

    5. **Create listener rule:**
       - **Idempotency check first:** `aws elbv2 describe-rules --listener-arn <https_listener_arn> --region <aws_region> --output json` and look for an existing rule whose single condition is `host-header == <fqdn>`. If found, run `aws elbv2 modify-rule --rule-arn <existing> --actions Type=forward,TargetGroupArn=<new_tg_arn> --region <aws_region>` to re-point it.
       - Otherwise create:
         ```bash
         aws elbv2 create-rule \
           --listener-arn <https_listener_arn> \
           --priority <rule_priority> \
           --conditions Field=host-header,Values=<fqdn> \
           --actions Type=forward,TargetGroupArn=<tg_arn> \
           --tags Key=ManagedBy,Value=cicd_aws_skill Key=Repo,Value=<repo_name> Key=Service,Value=<service> \
           --region <aws_region>
         ```
       - Record `<listener_rule_arn>`.

    6. **Create Cloudflare CNAME record (proxied):**
       - **Idempotency check first.** If `<existing_config>` (re-run mode) has `cloudflare_record_id_<svc>`, fetch it directly to verify it still exists:
         ```bash
         curl -fsS -H "Authorization: Bearer <cf_api_token>" \
           "https://api.cloudflare.com/client/v4/zones/<cloudflare_zone_id>/dns_records/<cloudflare_record_id_svc>"
         ```
         If the lookup 404s, fall through to the by-name lookup below.
       - Otherwise (or on 404 above), look up by name:
         ```bash
         curl -fsS -H "Authorization: Bearer <cf_api_token>" \
           "https://api.cloudflare.com/client/v4/zones/<cloudflare_zone_id>/dns_records?type=CNAME&name=<fqdn>"
         ```
       - If a record exists AND its `content` is NOT `<alb_dns>`, STOP and ask the user before overwriting (mirror the existing safety rule). Do NOT silently overwrite.
       - If a record exists with the right `content` and `proxied=true`, reuse its `id`.
       - If a record exists with the right `content` but `proxied=false`, run a `PUT` to flip it to proxied (see PUT body below) and reuse the `id`.
       - Otherwise, create a new record:
         ```bash
         curl -fsS -X POST \
           -H "Authorization: Bearer <cf_api_token>" \
           -H "Content-Type: application/json" \
           "https://api.cloudflare.com/client/v4/zones/<cloudflare_zone_id>/dns_records" \
           -d '{"type":"CNAME","name":"<fqdn>","content":"<alb_dns>","ttl":1,"proxied":true,"comment":"cicd_aws_skill <repo_name>/<service>"}'
         ```
       - On existing-but-stale (right name, wrong content, user approved overwrite): use
         ```bash
         curl -fsS -X PUT \
           -H "Authorization: Bearer <cf_api_token>" \
           -H "Content-Type: application/json" \
           "https://api.cloudflare.com/client/v4/zones/<cloudflare_zone_id>/dns_records/<id>" \
           -d '{"type":"CNAME","name":"<fqdn>","content":"<alb_dns>","ttl":1,"proxied":true,"comment":"cicd_aws_skill <repo_name>/<service>"}'
         ```
       - On any HTTP 4xx, surface the Cloudflare `errors[].message` verbatim and STOP.
       - Record `<cloudflare_record_id_<svc>>` from the response `result.id`. Cloudflare propagates effectively instantly when proxied — no polling loop needed.

19. **Apply: repo file changes** (only after AWS and Cloudflare are happy):
    1. Write the rewritten `docker-compose.yml` (env var port placeholders, 127.0.0.1 → 0.0.0.0 rewrites).
    2. Write `.github/workflows/cicd.yml` from the template below. Substitute the actual service image names extracted from the parsed compose file into the build/push loop.
    3. Update `.gitignore`: if `cicd_aws.config` is not already listed, append it on its own line preceded by the comment `# cicd_aws skill local config`. **This MUST happen before `git add`.**
    4. Write `cicd_aws.config` using the schema below.

    **`cicd_aws.config` schema** (key=value, one per line, no quoting, arrays use `,` separator):
    ```
    ec2_host=<>
    ec2_user=<>
    ssh_key_path=<>
    dockerhub_username=<>
    aws_region=<>
    aws_account_id=<>
    cloudflare_api_token=<>
    cloudflare_zone_id=<>
    cloudflare_zone_name=<>
    alb_arn=<>
    alb_dns=<>
    alb_vpc_id=<>
    alb_primary_sg_id=<>
    ec2_instance_id=<>
    ec2_primary_sg_id=<>
    deploy_branch=<>
    repo_slug=<>
    compose_project_name=<>
    https_listener_arn=<>
    exposed_services=svc1,svc2,...
    subdomain_<svc>=<fqdn>
    healthcheck_<svc>=<path>
    tg_arn_<svc>=<arn>
    listener_rule_arn_<svc>=<arn>
    listener_rule_priority_<svc>=<int>
    host_port_<svc>=<port>
    cloudflare_record_id_<svc>=<id>
    ```
    Do NOT write `dockerhub_token` or SSH key contents into this file. Ever. The `cloudflare_api_token` IS persisted here on purpose — Docker Hub has GitHub Secrets as its persistence layer, but Cloudflare has nowhere else to live, and this file is force-added to `.gitignore` before any `git add` (Step 19.3).

    **`.github/workflows/cicd.yml` template** — emit this verbatim, replacing `<...>` placeholders with the actual computed values. The `services` matrix is filled from the parsed compose file.

    ```yaml
    name: cicd_aws

    on:
      push:
        branches: [stable, main, master]

    jobs:
      build:
        runs-on: ubuntu-latest
        steps:
          - uses: actions/checkout@v4

          - name: Compute short SHA
            run: echo "SHORT_SHA=$(git rev-parse --short=7 HEAD)" >> $GITHUB_ENV

          - uses: docker/setup-buildx-action@v3

          - name: Build images
            env:
              # Default port env vars from GitHub Variables so compose's ${VAR:-default} interpolation works
              <SERVICE>_HOST_PORT: ${{ vars.<SERVICE>_HOST_PORT }}
              # ... one line per resolved port var
            run: docker compose -f docker-compose.yml build

          - name: Log in to Docker Hub
            if: github.ref_name == vars.DEPLOY_BRANCH
            uses: docker/login-action@v3
            with:
              username: ${{ secrets.DOCKERHUB_USERNAME }}
              password: ${{ secrets.DOCKERHUB_TOKEN }}

          - name: Tag and push images
            if: github.ref_name == vars.DEPLOY_BRANCH
            run: |
              # For each compose service image, tag with :latest and :$SHORT_SHA, then push both
              docker tag <image1> <image1>:${SHORT_SHA}
              docker push <image1>
              docker push <image1>:${SHORT_SHA}
              # ... repeat per service

      deploy:
        needs: build
        if: github.ref_name == vars.DEPLOY_BRANCH
        runs-on: ubuntu-latest
        steps:
          - uses: actions/checkout@v4

          - name: Install SSH key
            run: |
              mkdir -p ~/.ssh
              echo "${{ secrets.EC2_SSH_KEY }}" > ~/.ssh/id_ed25519
              chmod 600 ~/.ssh/id_ed25519
              ssh-keyscan -H "${{ secrets.EC2_HOST }}" >> ~/.ssh/known_hosts

          - name: Ensure remote app directory
            run: |
              ssh -i ~/.ssh/id_ed25519 ${{ secrets.EC2_USER }}@${{ secrets.EC2_HOST }} \
                "mkdir -p ~/apps/${{ vars.COMPOSE_PROJECT_NAME }}"

          - name: Copy compose file
            run: |
              scp -i ~/.ssh/id_ed25519 docker-compose.yml \
                ${{ secrets.EC2_USER }}@${{ secrets.EC2_HOST }}:~/apps/${{ vars.COMPOSE_PROJECT_NAME }}/docker-compose.yml

          - name: Write .env on remote
            env:
              <SERVICE>_HOST_PORT: ${{ vars.<SERVICE>_HOST_PORT }}
              # ... one line per resolved port var
              COMPOSE_PROJECT_NAME: ${{ vars.COMPOSE_PROJECT_NAME }}
            run: |
              ssh -i ~/.ssh/id_ed25519 ${{ secrets.EC2_USER }}@${{ secrets.EC2_HOST }} \
                "cat > ~/apps/${{ vars.COMPOSE_PROJECT_NAME }}/.env" <<EOF
              <SERVICE>_HOST_PORT=$<SERVICE>_HOST_PORT
              COMPOSE_PROJECT_NAME=$COMPOSE_PROJECT_NAME
              EOF

          - name: Deploy
            run: |
              ssh -i ~/.ssh/id_ed25519 ${{ secrets.EC2_USER }}@${{ secrets.EC2_HOST }} \
                "cd ~/apps/${{ vars.COMPOSE_PROJECT_NAME }} && docker compose pull && docker compose up -d --remove-orphans"

          - name: Verify all services running
            run: |
              ssh -i ~/.ssh/id_ed25519 ${{ secrets.EC2_USER }}@${{ secrets.EC2_HOST }} \
                "cd ~/apps/${{ vars.COMPOSE_PROJECT_NAME }} && docker compose ps --format json" \
                | jq -e 'all(.State == "running")'

          - name: Prune old images on EC2
            run: |
              ssh -i ~/.ssh/id_ed25519 ${{ secrets.EC2_USER }}@${{ secrets.EC2_HOST }} \
                "docker image prune -f"

          - name: Remove SSH key
            if: always()
            run: rm -f ~/.ssh/id_ed25519
    ```

20. **Apply: git branches, commit, push, default branch:**
    1. `git checkout -B stable` (force-move local `stable` to current HEAD).
    2. Verify `cicd_aws.config` is in `.gitignore` (re-read the file). If not, STOP — never commit the config file.
    3. `git add .github/workflows/cicd.yml docker-compose.yml .gitignore` (deliberately do NOT `git add cicd_aws.config`).
    4. `git commit -m "chore(ci): add cicd_aws deployment pipeline"`
    5. `git push -u origin stable`
    6. If `<create_deploy_branch>`:
       - `git branch <deploy_branch> stable`
       - `git push -u origin <deploy_branch>`
    7. `gh repo edit --default-branch stable`
    8. Verify: `gh repo view --json defaultBranchRef`
    - Do NOT auto-merge `stable` into `<deploy_branch>`. The user does that manually when ready for the first real deploy.

21. **Final summary** — Display:
    - GitHub URL: `<gh_repo_url>`
    - Default branch: `stable`
    - Deploy branch: `<deploy_branch>`
    - Public URLs (per exposed service): `https://<fqdn>`
    - AWS resources created (per service): target group ARN + listener rule priority + SG ingress rule
    - Cloudflare records created (per service): `<fqdn> → <alb_dns> [proxied]` in zone `<cloudflare_zone_name>`
    - GitHub Secrets set (by name only, never values)
    - GitHub Variables set (`name=value`)
    - Compose port rewrites (which entries became env vars)
    - Any 127.0.0.1 → 0.0.0.0 rewrites
    - `cicd_aws.config` location and reminder it is gitignored (and that it now contains the Cloudflare API token — do NOT share or commit this file)
    - Next steps:
      - `"Run \`git checkout <deploy_branch> && git merge stable && git push\` to trigger the first real deploy."`
      - `"On push to \`stable\`: GitHub Actions builds the images (no push, no deploy) — this is your daily loop."`
      - `"On push to \`<deploy_branch>\`: GitHub Actions builds, pushes to Docker Hub, and deploys over SSH."`
      - `"Cloudflare proxied records propagate effectively instantly. If a URL doesn't resolve right away, check the Cloudflare dashboard."`
      - `"To update any value: re-run \`/cicd_aws --reconfigure\` or edit \`cicd_aws.config\` and re-run \`/cicd_aws\`."`
      - `"Records are created with Cloudflare proxy ON (orange cloud). If your app needs the real client IP, read it from the \`CF-Connecting-IP\` request header."`
      - `"To prevent direct-IP bypass of Cloudflare's WAF, restrict the ALB security group's 443 inbound to Cloudflare's published IP ranges (https://www.cloudflare.com/ips/). The skill does not modify the ALB SG."`
      - `"To control how Cloudflare talks to the ALB, set the zone's SSL mode to \`Full\` or \`Full (Strict)\` in the Cloudflare dashboard. The ALB has a valid ACM cert, so \`Full (Strict)\` works. Default Cloudflare SSL mode is \`Flexible\`, which only does HTTP to origin and will cause redirect loops."`

**Rules:**
- **NEVER** make AWS or Cloudflare API calls at deploy time. The GitHub Actions workflow only does SSH + Docker. All AWS and Cloudflare mutations happen once, locally, during skill execution.
- **NEVER** store the Docker Hub token, SSH private key contents, or any GitHub-Secret-managed credential in `cicd_aws.config`. Those live only in GitHub Secrets. The Cloudflare API token IS an exception — it is persisted in `cicd_aws.config` because it has no other persistence layer, and the file is force-added to `.gitignore` before any `git add`.
- **NEVER** put the Cloudflare API token in any GitHub Secret, GitHub Variable, `.env` file, or any file other than `cicd_aws.config`. It must never leave the local machine.
- **NEVER** touch ACM certificates. If a cert is missing or doesn't cover a chosen FQDN, STOP and tell the user.
- **NEVER** create or modify the ALB itself, its HTTPS:443 listener itself, or the Cloudflare zone settings themselves (SSL mode, page rules, WAF, Universal SSL, etc.). Only create rules, target groups, DNS records, and security group entries underneath existing resources.
- **NEVER** mutate the ALB's own security group inbound rules to lock it down to Cloudflare IPs. The skill only touches the EC2 SG (allowing the ALB SG inbound). Locking down the ALB SG to Cloudflare's published IP ranges is documented as a manual follow-up in the final summary.
- **NEVER** overwrite an existing Cloudflare DNS record whose `content` is not already `<alb_dns>` for the chosen ALB — STOP and ask.
- **NEVER** rename `main` ↔ `master`. Use whichever is present.
- **NEVER** push to `<deploy_branch>` automatically. The user merges manually when ready.
- **NEVER** print SSH key contents, Docker Hub tokens, or any secret value to the terminal. When `gh secret set` needs a file, pass it via `--body-file`.
- **NEVER** un-expose a previously-exposed service in v1 — STOP and tell the user to remove the AWS and Cloudflare resources manually.
- **NEVER** silently re-allocate a previously-used host port; warn first.
- **NEVER** commit `cicd_aws.config` — it must be in `.gitignore` before the first `git add`.
- **NEVER** use `-uall` on `git status`.
- **NEVER** proceed if any pre-flight check fails. Report all failures before stopping.
- **ALWAYS** pass `--region <aws_region>` explicitly on every AWS call.
- **ALWAYS** tag AWS resources created by this skill with `ManagedBy=cicd_aws_skill, Repo=<repo_name>, Service=<service>`.
- **ALWAYS** make AWS and Cloudflare mutations idempotent: describe/lookup first, skip if matching, STOP if mismatched.
- **ALWAYS** verify SSH, Docker Hub, AWS identity, Cloudflare token, and ACM cert coverage BEFORE any mutating action.
- **ALWAYS** show the full plan (Step 16) and get explicit user confirmation before applying anything.
- **ALWAYS** preserve existing port allocations on re-run unless the old port is actually taken on the EC2.
- **ALWAYS** sanitize target group names: lowercase, `_` → `-`, collapse `--`, trim, truncate to 32 chars.
- **ALWAYS** retry AWS calls 3× with 2s/4s/8s backoff on `ThrottlingException` / `RequestLimitExceeded`.
- **ALWAYS** auto-rewrite `127.0.0.1:` host port bindings to `0.0.0.0:` on services marked for ALB exposure (and note it in the summary).

$ARGUMENTS
