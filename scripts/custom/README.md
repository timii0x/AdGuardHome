# Custom AGH System-Level Updates

This folder adds a panel button (`Custom update`) and a backend endpoint:

- `POST /control/custom_update`

The endpoint runs an external command:

- default: `/usr/local/sbin/agh-custom-update`
- override with env var: `AGH_CUSTOM_UPDATE_CMD`

## Scripts

- `agh-custom-manager.sh`:
  - checks if AGH is installed
  - installs missing build dependencies automatically (`go`, `npm`, `git`, `make`) on apt/dnf/yum/apk
  - clones/updates your fork
  - optionally fast-forwards from upstream
  - builds AGH
  - installs/upgrades `/opt/AdGuardHome/AdGuardHome`
  - restarts service with rollback on failure
  - installs helper commands into `/usr/local/sbin`

- `agh-custom-update.sh`:
  - tiny wrapper that runs manager `apply`

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
- Panel `Custom update` button will call this command via `/control/custom_update`

## Notes

- This flow is designed for non-Docker, system-level installs.
- If upstream sync has conflicts, the script exits and keeps current running binary.
- Auto dependency install is enabled by default (`AGH_AUTO_INSTALL_DEPS=1`).
- Set `AGH_AUTO_INSTALL_DEPS=0` if you want strict/manual dependency management.
