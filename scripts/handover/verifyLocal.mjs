import assert from 'node:assert/strict'
import { createClient } from '@supabase/supabase-js'
import { readFile, writeFile } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'

const configPath = process.argv[2]
if (!configPath) throw new Error('Pass the private local Supabase status JSON. This test writes fixtures only locally.')
const config = JSON.parse(await readFile(configPath, 'utf8'))
if (!['127.0.0.1', 'localhost'].includes(new URL(config.API_URL).hostname)) throw new Error('Local-only test: refusing a cloud URL')
const options = { auth: { persistSession: false, autoRefreshToken: false } }
const admin = createClient(config.API_URL, config.SERVICE_ROLE_KEY, options)
const anon = createClient(config.API_URL, config.ANON_KEY, options)
const prefix = `handover-${Date.now()}`
const password = randomBytes(24).toString('base64url')
async function checked(request) { const result = await request; if (result.error) throw result.error; return result.data }
async function account(label, profile) {
  const email = `${prefix}-${label}@example.com`
  await checked(admin.auth.admin.createUser({ email, password, email_confirm: true }))
  if (profile) await checked(admin.from('staff_profiles').insert({ email, display_name: profile.teacher, ...profile }))
  const client = createClient(config.API_URL, config.ANON_KEY, options)
  await checked(client.auth.signInWithPassword({ email, password }))
  return { client, email }
}
const staff = await account('admin', { role: 'admin', teacher: 'Другое', is_active: true })
const teacher = await account('teacher', { role: 'teacher', teacher: 'Алина', is_active: true })
const stranger = await account('stranger')
assert.equal(await checked(anon.rpc('is_allowed_staff')), false)
assert.equal(await checked(stranger.client.rpc('is_allowed_staff')), false)
assert.equal(await checked(teacher.client.rpc('is_allowed_staff')), true)
assert.equal(await checked(staff.client.rpc('is_staff_admin')), true)
assert.equal(await checked(teacher.client.rpc('is_staff_admin')), false)
assert.ok((await anon.from('clients').insert({ id: `${prefix}-denied`, name: 'Denied' })).error)
assert.ok((await stranger.client.from('clients').insert({ id: `${prefix}-unknown-denied`, name: 'Denied' })).error)

const id = `${prefix}-client`
await checked(staff.client.from('clients').insert({ id, name: 'Local handover fixture' }))
const date = new Date().toISOString().slice(0, 10)
const membership = `${prefix}-membership`
await checked(staff.client.from('memberships').insert({
  id: membership, client_id: id, client_name: 'Local fixture', name: 'Local package',
  kind: 'sessions', purchase_date: date, expires_at: '2099-12-31', purchase_amount: 3900, initial_sessions: 4,
}))
const appointment = `${prefix}-appointment`
await checked(teacher.client.from('appointments').insert({
  id: appointment, client_id: id, client_name: 'Local fixture', appointment_date: date,
  appointment_time: '12:00', service_type: 'Групповые', item: 'Кружка', amount: 975,
  teacher: 'Алина', status: 'Бронь', payment_method: 'membership', membership_id: membership, membership_charge_amount: 975,
}))
await checked(teacher.client.rpc('set_membership_appointment_status', { p_appointment_id: appointment, p_status: 'Ожидание изделия' }))
await checked(teacher.client.rpc('set_membership_appointment_status', { p_appointment_id: appointment, p_status: 'Готово к выдаче' }))
const redemptions = await checked(staff.client.from('membership_redemptions').select('*').eq('appointment_id', appointment))
assert.equal(redemptions.length, 1); assert.equal(Number(redemptions[0].allocated_value), 975)
await checked(teacher.client.rpc('set_membership_appointment_status', { p_appointment_id: appointment, p_status: 'Бронь' }))
assert.ok((await checked(staff.client.from('membership_redemptions').select('reversed_at').eq('appointment_id', appointment)))[0].reversed_at)
await checked(teacher.client.from('appointments').update({ client_name: 'Edited local fixture' }).eq('id', appointment))
await checked(teacher.client.from('expenses').insert({ id: `${prefix}-expense`, expense_date: date, month: date.slice(0, 7), paid_by: 'Алина', category: 'Налоги', description: 'Local fixture', amount: 500 }))
await checked(teacher.client.from('expenses').update({ amount: 700 }).eq('id', `${prefix}-expense`))
await checked(teacher.client.from('appointments').update({ deleted_at: new Date().toISOString() }).eq('id', appointment))
assert.ok((await checked(staff.client.from('appointments').select('deleted_at').eq('id', appointment)))[0].deleted_at)

await writeFile(`${configPath}.fixture.json`, JSON.stringify({ email: staff.email, password, teacherEmail: teacher.email, strangerEmail: stranger.email }), { mode: 0o600 })
console.log('Local RLS, admin/teacher/stranger roles, create/edit/expense, soft delete and atomic membership redemption/reversal passed. Test fixtures are local only.')
