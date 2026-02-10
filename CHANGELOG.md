# Changelog

## 1.0.0 - 2026-02-10

### BREAKING CHANGES

- Removed `domain` and `type` fields from memory write/update API payloads.
- Clients still sending `domain` or `type` will now fail input validation.

### Notes

- This release marks a breaking API contract change and requires client-side payload updates.
