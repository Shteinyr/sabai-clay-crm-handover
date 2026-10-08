import type { Appointment, Membership, MembershipRedemption } from './types'

export type MembershipStatus = 'Активен' | 'Закончился' | 'Истек'

export function activeRedemptions(redemptions: MembershipRedemption[]) {
  return redemptions.filter((redemption) => !redemption.reversedAt)
}

export function redemptionsForMembership(membershipId: string, redemptions: MembershipRedemption[]) {
  return activeRedemptions(redemptions).filter((redemption) => redemption.membershipId === membershipId)
}

export function redemptionForAppointment(appointmentId: string, redemptions: MembershipRedemption[]) {
  return activeRedemptions(redemptions).find((redemption) => redemption.appointmentId === appointmentId)
}

export function getMembershipUsage(membership: Membership, redemptions: MembershipRedemption[]) {
  const active = redemptionsForMembership(membership.id, redemptions)
  return active.reduce(
    (usage, redemption) => ({
      allocatedValue: usage.allocatedValue + redemption.allocatedValue,
      balanceUsed: usage.balanceUsed + redemption.balanceUsed,
      sessionsUsed: usage.sessionsUsed + redemption.sessionsUsed,
      visits: usage.visits + 1,
    }),
    { allocatedValue: 0, balanceUsed: 0, sessionsUsed: 0, visits: 0 },
  )
}

export function getMembershipStatus(
  membership: Membership,
  redemptions: MembershipRedemption[],
  today: string,
): MembershipStatus {
  if (today > membership.expiresAt) return 'Истек'
  const usage = getMembershipUsage(membership, redemptions)
  if (membership.kind === 'sessions' && usage.sessionsUsed >= (membership.initialSessions ?? 0)) return 'Закончился'
  if (membership.kind === 'balance' && usage.balanceUsed >= (membership.initialBalance ?? 0)) return 'Закончился'
  return 'Активен'
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(value)
}

export function membershipBalanceLabel(membership: Membership, redemptions: MembershipRedemption[]) {
  const usage = getMembershipUsage(membership, redemptions)
  if (membership.kind === 'sessions') {
    const total = membership.initialSessions ?? 0
    return `Осталось ${Math.max(0, total - usage.sessionsUsed)} из ${total}`
  }
  if (membership.kind === 'balance') {
    return `Баланс ${formatNumber(Math.max(0, (membership.initialBalance ?? 0) - usage.balanceUsed))} THB`
  }
  return `Безлимит до ${new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' }).format(
    new Date(`${membership.expiresAt}T00:00:00`),
  )}`
}

export function validateMembershipRedemption(
  membership: Membership,
  appointment: Appointment,
  redemptions: MembershipRedemption[],
) {
  if (appointment.date < membership.purchaseDate) return 'Дата занятия раньше даты продажи абонемента.'
  if (appointment.date > membership.expiresAt) return 'Срок действия абонемента истек.'

  const usage = getMembershipUsage(membership, redemptions)
  if (membership.kind === 'sessions' && (membership.initialSessions ?? 0) - usage.sessionsUsed < 1) {
    return 'В абонементе не осталось занятий.'
  }
  if (membership.kind === 'balance') {
    const charge = Math.max(0, appointment.membershipChargeAmount ?? appointment.amount)
    if (charge <= 0) return 'Укажите сумму списания.'
    const available = Math.max(0, (membership.initialBalance ?? 0) - usage.balanceUsed)
    if (charge > available) return `Недостаточно средств: доступно ${formatNumber(available)} THB.`
  }
  return undefined
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

export function calculateMembershipRedemption(
  membership: Membership,
  appointment: Appointment,
  redemptions: MembershipRedemption[],
  id = `membership-redemption-${crypto.randomUUID()}`,
): MembershipRedemption {
  const usage = getMembershipUsage(membership, redemptions)
  let sessionsUsed = 0
  let balanceUsed = 0
  let allocatedValue: number

  if (membership.kind === 'sessions') {
    const total = Math.max(1, membership.initialSessions ?? 1)
    const remaining = total - usage.sessionsUsed
    sessionsUsed = 1
    allocatedValue = remaining === 1
      ? Math.max(0, roundMoney(membership.purchaseAmount - usage.allocatedValue))
      : roundMoney(membership.purchaseAmount / total)
  } else if (membership.kind === 'balance') {
    const initialBalance = Math.max(1, membership.initialBalance ?? 1)
    const remaining = initialBalance - usage.balanceUsed
    balanceUsed = Math.max(0, appointment.membershipChargeAmount ?? appointment.amount)
    allocatedValue = remaining === balanceUsed
      ? Math.max(0, roundMoney(membership.purchaseAmount - usage.allocatedValue))
      : roundMoney(membership.purchaseAmount * balanceUsed / initialBalance)
  } else {
    allocatedValue = Math.max(0, appointment.membershipChargeAmount ?? appointment.amount)
  }

  return {
    allocatedValue,
    appointmentId: appointment.id,
    balanceUsed,
    guestMasterId: appointment.guestMasterId,
    guestMasterName: appointment.guestMasterName,
    guestMasterRatePercent: appointment.guestMasterRatePercent,
    id,
    membershipId: membership.id,
    redeemedAt: new Date().toISOString(),
    sessionsUsed,
    teacher: appointment.teacher,
    visitDate: appointment.date,
  }
}

export function remainingMembershipObligation(membership: Membership, redemptions: MembershipRedemption[]) {
  if (membership.kind === 'unlimited') return 0
  const usage = getMembershipUsage(membership, redemptions)
  if (membership.kind === 'sessions') {
    const total = Math.max(1, membership.initialSessions ?? 1)
    if (total - usage.sessionsUsed <= 0) return 0
    return Math.max(0, roundMoney(membership.purchaseAmount - usage.allocatedValue))
  }
  const initialBalance = Math.max(1, membership.initialBalance ?? 1)
  const remainingBalance = Math.max(0, initialBalance - usage.balanceUsed)
  return roundMoney(membership.purchaseAmount * remainingBalance / initialBalance)
}
