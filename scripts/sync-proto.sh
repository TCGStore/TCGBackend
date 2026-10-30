#!/usr/bin/env bash
# Copies the contracts from proto/ into the service repos cloned next to this one.
# Run it after merging a proto change, then open a PR in each service that changed.
set -euo pipefail

cd "$(dirname "$0")/.."
workspace=..

copy() {
  local service=$1; shift
  if [ ! -d "$workspace/$service" ]; then
    echo "skip $service (not cloned in $workspace)"
    return
  fi
  mkdir -p "$workspace/$service/proto"
  for file in "$@"; do
    cp "proto/$file" "$workspace/$service/proto/$file"
  done
  echo "$service: $*"
}

copy TCGCatalogService       catalog.proto
copy TCGOrderService         orders.proto catalog.proto events.md
copy TCGInventoryService     inventory.proto events.md
copy TCGUserService          users.proto
copy TCGNotificationService  notifications.proto events.md
