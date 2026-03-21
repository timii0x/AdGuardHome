#!/bin/sh
set -eu

AGH_MANAGER_PATH="${AGH_MANAGER_PATH:-/usr/local/sbin/agh-custom-manager}"

exec "$AGH_MANAGER_PATH" apply
