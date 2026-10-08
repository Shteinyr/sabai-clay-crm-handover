import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'

test('local demo is empty and never connects to the former cloud', async ({ page }) => {
  const remote: string[] = []
  page.on('request', (request) => {
    if (request.url().includes('supabase.co')) remote.push(request.url())
  })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: /Сегодня/ }).first()).toBeVisible()
  await expect(page.locator('.appointmentCard')).toHaveCount(0)
  await page.getByRole('button', { name: 'Календарь' }).click()
  await expect(page.locator('.appointmentCard')).toHaveCount(0)
  expect(remote).toEqual([])
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  expect(await page.locator('.bottomNav').evaluate((nav) => nav.getBoundingClientRect().bottom <= window.innerHeight)).toBe(true)
})

test('no bundled cloud defaults, email privileges or historical Excel payload', async () => {
  const client = await readFile('src/data/supabaseClient.ts', 'utf8')
  const auth = await readFile('src/hooks/useAuthProfile.ts', 'utf8')
  const seed = await readFile('src/data/seedData.ts', 'utf8')
  expect(client).not.toContain('fallbackSupabase')
  expect(client).not.toMatch(/https:\/\/[a-z0-9]{20}\.supabase\.co/)
  expect(auth).not.toContain('@gmail.com')
  expect(auth).not.toContain('fallbackProfileForEmail')
  expect(auth).toContain(".from('staff_profiles')")
  expect(seed).toContain('clients: []')
  expect(await readFile('supabase/schema.sql', 'utf8')).not.toContain('\\ncreate')
})
