# Custom AGH System-Level Updates

This folder adds a panel button (`Custom update`) and a backend endpoint:

- `POST /control/custom_update`
- `GET /control/custom_update_status`

The endpoint runs an external command:

- default: `/usr/local/sbin/agh-custom-update`
- override with env var: `AGH_CUSTOM_UPDATE_CMD`

Status endpoint command:

- default: `/usr/local/sbin/agh-custom-status`
- override with env var: `AGH_CUSTOM_UPDATE_STATUS_CMD`

## Scripts

- `agh-custom-manager.sh`:
  - checks if AGH is installed
  - installs missing build dependencies automatically (`go`, `npm`, `git`, `make`) on apt/dnf/yum/apk
  - clones/updates your fork
  - fast-forwards from upstream by default (`AGH_SYNC_UPSTREAM=1`)
  - builds AGH with version from `git describe` (avoids `v0.0.0-dev`)
  - installs/upgrades `/opt/AdGuardHome/AdGuardHome`
  - restarts service with rollback on failure
  - installs helper commands into `/usr/local/sbin`
  - auto-stashes local git changes before pull (`AGH_AUTO_STASH_LOCAL_CHANGES=1`, default)
  - reapplies local TTL prefetch patch automatically (`AGH_APPLY_LOCAL_PATCHES=1`, default)
  - skips rebuild/restart when no fork updates are detected (`AGH_SKIP_IF_NO_UPDATES=1`, default)

- `apply-ttl10-prefetch-patch.sh`:
  - applies the `10% before TTL expiry` optimistic prefetch patch
  - safe to rerun (detects if already applied)
  - intended to be used after upstream pulls

- `patches/0001-optimistic-prefetch-ttl10.patch`:
  - patch payload used by the apply script

- `agh-custom-update.sh`:
  - tiny wrapper that runs manager `apply` with upstream sync enabled

- `agh-custom-status` (installed by manager):
  - tiny wrapper that runs manager `status`

## First setup

Run as root:

```sh
cd /path/to/AdGuardHome
sudo AGH_REPO_URL="https://github.com/<your-user>/AdGuardHome.git" \
  ./scripts/custom/agh-custom-manager.sh apply
```

After first run:

- `/usr/local/sbin/agh-custom-manager` will exist
- `/usr/local/sbin/agh-custom-update` will exist
- `/usr/local/sbin/agh-custom-status` will exist
- Panel `Custom update` button will call this command via `/control/custom_update`
- Next updates can run without extra env vars (`/usr/local/sbin/agh-custom-update` or panel button)

## Notes

- This flow is designed for non-Docker, system-level installs.
- If upstream sync has conflicts, the script exits and keeps current running binary.
- Auto dependency install is enabled by default (`AGH_AUTO_INSTALL_DEPS=1`).
- Set `AGH_AUTO_INSTALL_DEPS=0` if you want strict/manual dependency management.
- Auto stash is enabled by default (`AGH_AUTO_STASH_LOCAL_CHANGES=1`).
- Rebuild skip is enabled by default (`AGH_SKIP_IF_NO_UPDATES=1`).
- Local custom patch reapply is enabled by default (`AGH_APPLY_LOCAL_PATCHES=1`).

## Manual patch-only usage (without manager)

If you use plain upstream AGH source and want to reapply only this feature:

```sh
cd /path/to/AdGuardHome
./scripts/custom/apply-ttl10-prefetch-patch.sh .
```
