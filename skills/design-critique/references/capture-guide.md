# Capture Guide

Reference for capturing screenshots from real running applications.

## Platform Detection

```
Check: does {APP_PATH}/app.config.ts or {APP_PATH}/app.json exist?
  YES -> PLATFORM = "rn" (React Native / Expo)
  NO  -> Check: does package.json contain "expo" or "react-native"?
    YES -> PLATFORM = "rn"
    NO  -> PLATFORM = "web"
```

## Server Lifecycle

### Web (Rails API + Vite Dev Server)

```bash
# Start API (if not already running)
pgrep -f 'rails.*server' > /dev/null || (cd apps/api && bin/rails s -p 3000 &)

# Start Vite dev server (if not already running)
pgrep -f 'vite' > /dev/null || (cd apps/web-client && pnpm dev --port 5173 &)

# Health check (wait up to 30 seconds)
for i in $(seq 1 30); do
  curl -sf http://localhost:3000/healthz > /dev/null 2>&1 && break
  sleep 1
done
curl -sf http://localhost:5173 > /dev/null 2>&1 || echo "Vite not ready"
```

### Mobile (Expo Dev Server)

```bash
# Start Expo (if not already running)
pgrep -f 'expo.*start' > /dev/null || (cd apps/mobile && npx expo start --dev-client &)

# Wait for Metro bundler
sleep 5
```

### Simulator/Emulator

For mobile, verify a device is available:

```bash
# iOS
xcrun simctl list devices booted | grep -q "Booted" || echo "No iOS simulator booted"

# Android
adb devices | grep -q "device$" || echo "No Android device connected"
```

## Authentication (Web)

Playwright CLI logs in via the real login flow using the seed user credentials. No mock tokens.

```
# Using Playwright CLI (mcp__playwright tool or CLI):
1. Navigate to http://localhost:5173/login
2. Fill email field with "design-review@example.com"
3. Fill password field with "password123"
4. Click submit / press Enter
5. Wait for redirect to dashboard (confirms auth success)
```

The session persists across all subsequent screenshots in the same browser context. No need to re-authenticate between pages.

## Web Capture (Playwright CLI)

### Capture sequence

```
1. Ensure servers running (health check)
2. Run seed: cd apps/api && bin/rails design:seed:{feature_slug}
3. Open browser, log in as seed user
4. For each target page:
   a. Navigate to URL
   b. Wait for network idle (no pending requests)
   c. Screenshot at desktop width (1440px)
   d. Screenshot at tablet width (768px) - if responsive matters
   e. Screenshot at mobile width (375px) - if responsive matters
   f. Capture interactive states (open modals, expanded sections, hover states)
5. Save all screenshots to /tmp/design-review/{feature}/
6. Write manifest
```

### Viewport sizes

| Name    | Width  | When to use                              |
|---------|--------|------------------------------------------|
| Desktop | 1440px | Always                                   |
| Tablet  | 768px  | When layout has responsive breakpoints   |
| Mobile  | 375px  | When layout has responsive breakpoints   |

### Limits

- Max 10 screenshots per capture round
- Overwritten each round (designers always see latest)

## Mobile Capture (Maestro MCP)

### Capture sequence

```
1. Ensure Expo + simulator running
2. Run seed: cd apps/api && bin/rails design:seed:{feature_slug}
3. Use Maestro MCP tools:
   - launch_app: Start/restart the app with clearState
   - tap_on: Navigate to target screens
   - take_screenshot: Capture each state
4. Save screenshots to /tmp/design-review/{feature}/
5. Write manifest
```

### Maestro MCP tools reference

| Tool                    | Purpose                           |
|-------------------------|-----------------------------------|
| `launch_app`            | Start app, optionally clear state |
| `tap_on`                | Tap a UI element by text or ID    |
| `input_text`            | Type into a field                 |
| `take_screenshot`       | Capture current screen            |
| `inspect_view_hierarchy`| Debug: see all elements           |
| `back`                  | Press back button                 |

### Screenshot naming

```
01-{screen}-default.png
02-{screen}-scrolled.png
03-{screen}-{state}.png
```

## Manifest Format

After capture, write a manifest file listing what each screenshot shows:

```markdown
# Design Review Manifest

**Feature:** {feature_slug}
**Platform:** {web | mobile}
**Captured:** {timestamp}
**Seed task:** design:seed:{feature_slug}

## Screenshots

| File | Page/Screen | Viewport | State | Description |
|------|-------------|----------|-------|-------------|
| 01-work-orders-desktop.png | /work-orders | 1440px | Default | Work order list with all SLA states |
| 02-work-orders-tablet.png | /work-orders | 768px | Default | Tablet responsive layout |
| 03-work-orders-red-detail.png | /work-orders/123 | 1440px | Red SLA | Detail view of breached task |
| ... | ... | ... | ... | ... |
```

## Cleanup

Servers started by the agent are killed when the session ends:

```bash
# Kill by port (more reliable than PID)
lsof -ti :3000 | xargs kill 2>/dev/null || true   # Rails
lsof -ti :5173 | xargs kill 2>/dev/null || true   # Vite
lsof -ti :8081 | xargs kill 2>/dev/null || true   # Metro

# Kill orphaned processes
pkill -f 'node.*vitest' 2>/dev/null || true
pkill -f 'node.*jest' 2>/dev/null || true
```

Cleanup happens at session end, not between phases. Servers stay running for the duration of the critique.
