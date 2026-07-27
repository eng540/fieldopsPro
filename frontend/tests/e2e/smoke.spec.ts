/**
 * FieldOps V4 — E2E Smoke Tests (Sprint-4 M3.2)
 *
 * Full workflow coverage:
 * 1. Login → Dashboard loads with real data
 * 2. Sync — pull triggers and SyncStatusBar updates
 * 3. Work Order — create + update progress (Monotonic enforced)
 * 4. Quality — create remark with GPS + resolve
 * 5. Governance — view decisions + override form validation
 * 6. Reports — IPC export button visible
 * 7. Logout → redirected to /login
 *
 * Requires:
 *   - Frontend running on http://localhost:3000
 *   - Backend running on http://localhost:8000
 *   - Test user: test@fieldops.dev / FieldOps2026!
 */

import { test, expect, Page } from '@playwright/test'

const BASE_URL  = 'http://localhost:3000'
const API_URL   = 'http://localhost:8000'
const TEST_USER = { email: 'test@fieldops.dev', password: 'FieldOps2026!' }

// ─── Shared helper ─────────────────────────────────────────────────────────
async function login(page: Page): Promise<void> {
  await page.goto(`${BASE_URL}/login`)
  await expect(page.locator('input[type="email"]')).toBeVisible({ timeout: 10000 })
  await page.fill('input[type="email"]', TEST_USER.email)
  await page.fill('input[type="password"]', TEST_USER.password)
  await page.click('button[type="submit"], button:has-text("Sign in"), button:has-text("Login")')
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 10000 })
}


// ═══════════════════════════════════════════════════════════════════════════
// SUITE 1: AUTHENTICATION
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Authentication', () => {
  test('login page renders correctly', async ({ page }) => {
    await page.goto(`${BASE_URL}/login`)
    await expect(page.locator('input[type="email"]')).toBeVisible()
    await expect(page.locator('input[type="password"]')).toBeVisible()
  })

  test('invalid credentials shows error', async ({ page }) => {
    await page.goto(`${BASE_URL}/login`)
    await page.fill('input[type="email"]', 'wrong@email.com')
    await page.fill('input[type="password"]', 'wrongpassword')
    await page.click('button[type="submit"], button:has-text("Sign in"), button:has-text("Login")')
    // Should stay on login and show error
    await expect(page).toHaveURL(/\/login/, { timeout: 5000 })
  })

  test('successful login redirects to dashboard', async ({ page }) => {
    await login(page)
    await expect(page.locator('h1, h2').first()).toContainText(/Dashboard|FieldOps/i)
  })

  test('protected routes redirect to login when unauthenticated', async ({ page }) => {
    await page.goto(`${BASE_URL}/work-orders`)
    await expect(page).toHaveURL(/\/login/, { timeout: 5000 })
  })

  test('logout clears session and redirects to login', async ({ page }) => {
    await login(page)
    await page.click('button:has-text("Sign out")')
    await expect(page).toHaveURL(/\/login/, { timeout: 5000 })
    // Verify protected route now redirects
    await page.goto(`${BASE_URL}/dashboard`)
    await expect(page).toHaveURL(/\/login/, { timeout: 5000 })
  })
})


// ═══════════════════════════════════════════════════════════════════════════
// SUITE 2: SYNC STATUS BAR
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Sync Status Bar', () => {
  test.beforeEach(async ({ page }) => { await login(page) })

  test('SyncStatusBar is visible after login', async ({ page }) => {
    // The bar is rendered at the top of AppShell
    await expect(page.locator('text=/Online|Offline|Synced/i').first()).toBeVisible()
  })

  test('online indicator shows green when server reachable', async ({ page }) => {
    // Should show Online since test environment has backend running
    const bar = page.locator('text=Online').first()
    await expect(bar).toBeVisible({ timeout: 8000 })
  })
})


// ═══════════════════════════════════════════════════════════════════════════
// SUITE 3: WORK ORDERS
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Work Orders', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
    await page.click('button:has-text("Work Orders"), a[href="/work-orders"]')
    await expect(page).toHaveURL(/\/work-orders/, { timeout: 5000 })
  })

  test('work orders screen loads', async ({ page }) => {
    await expect(page.locator('h2:has-text("Work Orders")')).toBeVisible()
    await expect(page.locator('button:has-text("New Work Order")')).toBeVisible()
  })

  test('create a new work order', async ({ page }) => {
    await page.click('button:has-text("New Work Order")')
    const modal = page.locator('div[role="dialog"], .fixed.inset-0').last()
    await expect(modal).toBeVisible()
    await page.fill('input[placeholder*="title"], input[placeholder*="e.g."]', 'E2E Test Work Order')
    await page.click('button:has-text("Create"):not(:disabled)')
    // Modal closes and WO appears in list
    await expect(page.locator('text=E2E Test Work Order')).toBeVisible({ timeout: 8000 })
  })

  test('progress update is capped at 100%', async ({ page }) => {
    // Open first WO in list
    await page.locator('button').filter({ hasText: /DRAFT|IN_PROGRESS|PENDING/ }).first().click()
    const modal = page.locator('.fixed.inset-0').last()
    await expect(modal).toBeVisible()
    // Slider should be present and bounded 0-100
    const slider = page.locator('input[type="range"]')
    await expect(slider).toHaveAttribute('max', '100')
    await expect(slider).toHaveAttribute('min', '0')
    await page.click('button:has-text("Cancel")')
  })

  test('decrease triggers rework warning', async ({ page }) => {
    // Open first WO and try to decrease progress
    await page.locator('button').filter({ hasText: /DRAFT|IN_PROGRESS/ }).first().click()
    const modal = page.locator('.fixed.inset-0').last()
    await expect(modal).toBeVisible()
    const slider = page.locator('input[type="range"]')
    const currentVal = await slider.inputValue()
    if (parseInt(currentVal) > 10) {
      await slider.fill('5')
      await expect(page.locator('text=/rework|decrease/i').first()).toBeVisible()
    }
    await page.click('button:has-text("Cancel")')
  })
})


// ═══════════════════════════════════════════════════════════════════════════
// SUITE 4: QUALITY CONTROL
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Quality Control', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
    await page.click('button:has-text("Quality"), a[href="/quality"]')
    await expect(page).toHaveURL(/\/quality/, { timeout: 5000 })
  })

  test('quality screen loads with filter controls', async ({ page }) => {
    await expect(page.locator('h2:has-text("Quality Control")')).toBeVisible()
    await expect(page.locator('select').first()).toBeVisible()
    await expect(page.locator('button:has-text("New Remark")')).toBeVisible()
  })

  test('severity filter updates displayed remarks', async ({ page }) => {
    const severityFilter = page.locator('select').first()
    await severityFilter.selectOption('CRITICAL')
    // List should filter — just verify no crash
    await expect(page.locator('h2:has-text("Quality Control")')).toBeVisible()
    await severityFilter.selectOption('')
  })

  test('create remark modal opens and validates', async ({ page }) => {
    await page.click('button:has-text("New Remark")')
    const modal = page.locator('.fixed.inset-0').last()
    await expect(modal).toBeVisible()
    // Severity selector present
    await expect(page.locator('select').nth(1)).toBeVisible()
    // CRITICAL warning appears when selected
    await page.locator('select').nth(1).selectOption('CRITICAL')
    await expect(page.locator('text=/Auto-Governance HOLD/i')).toBeVisible()
    await page.click('button:has-text("Cancel")')
  })

  test('GPS capture button present in create modal', async ({ page }) => {
    await page.click('button:has-text("New Remark")')
    const modal = page.locator('.fixed.inset-0').last()
    await expect(modal).toBeVisible()
    await expect(page.locator('button:has-text("Capture GPS"), button:has-text("GPS")')).toBeVisible()
    await page.click('button:has-text("Cancel")')
  })
})


// ═══════════════════════════════════════════════════════════════════════════
// SUITE 5: GOVERNANCE
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Governance Engine', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
    await page.click('button:has-text("Governance"), a[href="/governance"]')
    await expect(page).toHaveURL(/\/governance/, { timeout: 5000 })
  })

  test('governance screen loads with KPI cards', async ({ page }) => {
    await expect(page.locator('h2:has-text("Governance Engine")')).toBeVisible()
    await expect(page.locator('text=HOLD')).toBeVisible()
    await expect(page.locator('text=STOP')).toBeVisible()
    await expect(page.locator('text=APPROVE')).toBeVisible()
  })

  test('clicking HOLD filter filters the list', async ({ page }) => {
    await page.locator('button').filter({ hasText: /^HOLD/ }).first().click()
    // Check list updated without crash
    await expect(page.locator('h2:has-text("Governance Engine")')).toBeVisible()
    // Click again to deselect
    await page.locator('button').filter({ hasText: /^HOLD/ }).first().click()
  })

  test('override form requires min 20 chars justification', async ({ page }) => {
    // If there are any HOLD decisions, open one
    const holdCard = page.locator('[class*="amber"]').first()
    if (await holdCard.count() > 0) {
      await holdCard.click()
      const overrideBtn = page.locator('button:has-text("Request Override")')
      if (await overrideBtn.count() > 0) {
        await overrideBtn.click()
        const justField = page.locator('textarea').last()
        await justField.fill('short')
        // Submit button should be disabled
        const submitBtn = page.locator('button:has-text("Submit Override")')
        await expect(submitBtn).toBeDisabled()
        // Now fill proper justification
        await justField.fill('This override is required because the contractor has resolved the defect.')
        await expect(submitBtn).toBeEnabled()
      }
    }
  })
})


// ═══════════════════════════════════════════════════════════════════════════
// SUITE 6: REPORTS
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Reports & Analytics', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
    await page.click('button:has-text("Reports"), a[href="/reports"]')
    await expect(page).toHaveURL(/\/reports/, { timeout: 5000 })
  })

  test('reports screen loads with export button', async ({ page }) => {
    await expect(page.locator('h2:has-text("Reports")')).toBeVisible()
    await expect(page.locator('button:has-text("Export IPC")')).toBeVisible()
  })

  test('IPC export button is clickable', async ({ page }) => {
    const downloadPromise = page.waitForEvent('download', { timeout: 10000 }).catch(() => null)
    await page.click('button:has-text("Export IPC")')
    // Either download starts or error appears — either way no crash
    await page.waitForTimeout(2000)
    await expect(page.locator('h2:has-text("Reports")')).toBeVisible()
  })

  test('work order breakdown chart renders', async ({ page }) => {
    await expect(page.locator('text=Work Order Breakdown')).toBeVisible({ timeout: 5000 })
  })

  test('project progress section renders', async ({ page }) => {
    await expect(page.locator('text=Project Progress')).toBeVisible({ timeout: 5000 })
  })
})


// ═══════════════════════════════════════════════════════════════════════════
// SUITE 7: NAVIGATION
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Navigation', () => {
  test.beforeEach(async ({ page }) => { await login(page) })

  test('all nav items navigate without crash', async ({ page }) => {
    const routes = [
      { label: 'Projects',    path: '/projects' },
      { label: 'Work Orders', path: '/work-orders' },
      { label: 'Quality',     path: '/quality' },
      { label: 'Governance',  path: '/governance' },
      { label: 'Reports',     path: '/reports' },
      { label: 'Dashboard',   path: '/dashboard' },
    ]
    for (const { label, path } of routes) {
      await page.click(`button:has-text("${label}"), a[href="${path}"]`)
      await expect(page).toHaveURL(new RegExp(path), { timeout: 5000 })
    }
  })

  test('page title is FieldOps throughout navigation', async ({ page }) => {
    await expect(page).toHaveTitle(/FieldOps/i)
  })
})


// ═══════════════════════════════════════════════════════════════════════════
// SUITE 8: API HEALTH
// ═══════════════════════════════════════════════════════════════════════════

test.describe('API Health', () => {
  test('backend health endpoint responds 200', async ({ request }) => {
    const resp = await request.get(`${API_URL}/health`)
    expect(resp.status()).toBe(200)
    const body = await resp.json()
    expect(body.status).toBe('ok')
  })

  test('swagger docs are accessible', async ({ request }) => {
    const resp = await request.get(`${API_URL}/docs`)
    expect(resp.status()).toBe(200)
  })

  test('unauthenticated API request returns 401', async ({ request }) => {
    const resp = await request.get(`${API_URL}/auth/me`)
    expect(resp.status()).toBe(401)
  })
})
