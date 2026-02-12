# Keyv to SQLite Migration Guide

## Status

This document is retained for historical context only.

The project now starts from a fresh SQLite database and does not include Keyv-to-SQLite migration tooling.

## Current Deployment Path

- Initialize and run service directly on SQLite schema (`memories`, `memory_links`).
- Use normal backup/rollback procedures described in `docs/DEPLOYMENT_GUIDE.md`.
- If historical Keyv data import is required in the future, implement a dedicated one-off tool outside current runtime.
