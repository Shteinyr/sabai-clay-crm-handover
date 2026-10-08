import { ChevronRight, Plus } from 'lucide-react'
import { useState } from 'react'
import type { FormEvent } from 'react'
import {
  getMembershipStatus,
  membershipBalanceLabel,
} from '../data/membershipLogic'
import type { Membership, MembershipKind, MembershipRedemption } from '../data/types'

const todayIso = new Date().toISOString().slice(0, 10)

function addMonths(date: string, months: number) {
  const [year, month, day] = date.split('-').map(Number)
  const parsed = new Date(Date.UTC(year, month - 1, day))
  parsed.setUTCMonth(parsed.getUTCMonth() + months)
  return `${parsed.getUTCFullYear()}-${String(parsed.getUTCMonth() + 1).padStart(2, '0')}-${String(parsed.getUTCDate()).padStart(2, '0')}`
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })
    .format(new Date(`${value}T00:00:00`))
}

function formatMoney(value: number) {
  return `${new Intl.NumberFormat('ru-RU').format(Math.round(value))} THB`
}

function kindLabel(kind: MembershipKind) {
  if (kind === 'sessions') return 'Пакет занятий'
  if (kind === 'balance') return 'Баланс THB'
  return 'Безлимит'
}

export function MembershipsPanel({
  canEdit,
  memberships,
  redemptions,
  onAdd,
  onEdit,
}: {
  canEdit: boolean
  memberships: Membership[]
  redemptions: MembershipRedemption[]
  onAdd: () => void
  onEdit: (membership: Membership) => void
}) {
  const [expanded, setExpanded] = useState(true)
  const sorted = [...memberships].sort((a, b) => {
    const aStatus = getMembershipStatus(a, redemptions, todayIso)
    const bStatus = getMembershipStatus(b, redemptions, todayIso)
    if (aStatus === 'Активен' && bStatus !== 'Активен') return -1
    if (aStatus !== 'Активен' && bStatus === 'Активен') return 1
    return b.purchaseDate.localeCompare(a.purchaseDate)
  })

  return (
    <section className="panel membershipsPanel">
      <div className="panelHeader">
        <h3>Абонементы</h3>
        <div className="panelActions">
          <button className="secondaryButton compactButton" type="button" onClick={() => setExpanded((value) => !value)}>
            {expanded ? 'Скрыть' : 'Показать'}
          </button>
          {canEdit && (
            <button className="iconTextButton compactButton" type="button" onClick={onAdd}>
              <Plus size={18} />
              Добавить
            </button>
          )}
        </div>
      </div>
      {expanded && sorted.length ? (
        <div className="membershipList">
          {sorted.map((membership) => {
            const status = getMembershipStatus(membership, redemptions, todayIso)
            return (
              <article className={`membershipCard ${status === 'Активен' ? '' : 'finished'}`} key={membership.id}>
                <div className="membershipCardMain">
                  <div className="membershipTitleLine">
                    <div>
                      <strong>{membership.name}</strong>
                      <span>{membership.clientName}</span>
                    </div>
                    <span className={`membershipStatus ${status === 'Активен' ? 'active' : 'finished'}`}>{status}</span>
                  </div>
                  <div className="membershipMeta">
                    <span>{kindLabel(membership.kind)}</span>
                    <span>{membershipBalanceLabel(membership, redemptions)}</span>
                  </div>
                  <div className="membershipMeta">
                    <strong>{formatMoney(membership.purchaseAmount)}</strong>
                    <span>до {formatDate(membership.expiresAt)}</span>
                  </div>
                </div>
                {canEdit && (
                  <button
                    aria-label={`Редактировать абонемент: ${membership.name}`}
                    className="chevronButton"
                    type="button"
                    onClick={() => onEdit(membership)}
                  >
                    <ChevronRight size={18} />
                  </button>
                )}
              </article>
            )
          })}
        </div>
      ) : expanded ? (
        <p className="muted">Проданных абонементов пока нет.</p>
      ) : (
        <p className="muted">Список абонементов скрыт.</p>
      )}
    </section>
  )
}

export function MembershipForm({
  membership,
  redemptions,
  serviceTypes,
  submitLabel = 'Продать абонемент',
  onDelete,
  onSubmit,
}: {
  membership?: Membership
  redemptions: MembershipRedemption[]
  serviceTypes: string[]
  submitLabel?: string
  onDelete?: () => void
  onSubmit: (formData: FormData) => void
}) {
  const [kind, setKind] = useState<MembershipKind>(membership?.kind ?? 'sessions')
  const [purchaseDate, setPurchaseDate] = useState(membership?.purchaseDate ?? todayIso)
  const [expiresAt, setExpiresAt] = useState(membership?.expiresAt ?? addMonths(membership?.purchaseDate ?? todayIso, 6))
  const hasUsage = Boolean(membership && redemptions.some((redemption) => redemption.membershipId === membership.id))
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    onSubmit(new FormData(event.currentTarget))
  }

  return (
    <form className="formStack membershipForm" onSubmit={handleSubmit}>
      {hasUsage && <p className="formNotice">Абонемент уже использован. Можно изменить только срок и комментарий.</p>}
      <div className="contactCompactGrid">
        <label>Название<input name="name" required disabled={hasUsage} defaultValue={membership?.name ?? ''} placeholder="Детская лепка" /></label>
        <label>Имя клиента<input name="clientName" required disabled={hasUsage} defaultValue={membership?.clientName ?? ''} /></label>
        <label>Телефон / WhatsApp<input name="phone" disabled={hasUsage} defaultValue={membership?.phone ?? membership?.whatsapp ?? ''} /></label>
        <label>Instagram<input name="instagram" disabled={hasUsage} defaultValue={membership?.instagram ?? ''} /></label>
        <label>Telegram<input name="telegram" disabled={hasUsage} defaultValue={membership?.telegram ?? ''} /></label>
      </div>
      <div className="membershipKindControl" aria-label="Тип абонемента">
        {(['sessions', 'balance', 'unlimited'] as MembershipKind[]).map((item) => (
          <button
            className={kind === item ? 'active' : ''}
            disabled={hasUsage}
            key={item}
            type="button"
            onClick={() => setKind(item)}
          >
            {kindLabel(item)}
          </button>
        ))}
      </div>
      <input name="kind" type="hidden" value={kind} />
      <div className="formGrid">
        <label>Дата продажи
          <input
            name="purchaseDate"
            type="date"
            required
            disabled={hasUsage}
            value={purchaseDate}
            onChange={(event) => {
              const nextDate = event.currentTarget.value
              setPurchaseDate(nextDate)
              setExpiresAt(addMonths(nextDate, 6))
            }}
          />
        </label>
        <label>Срок действия<input name="expiresAt" type="date" required value={expiresAt} onChange={(event) => setExpiresAt(event.currentTarget.value)} /></label>
      </div>
      <div className="formGrid">
        <label>Оплата THB<input name="purchaseAmount" type="number" min="0" required disabled={hasUsage} defaultValue={membership?.purchaseAmount ?? ''} /></label>
        {kind === 'sessions' && (
          <label>Количество занятий<input name="initialSessions" type="number" min="1" required disabled={hasUsage} defaultValue={membership?.initialSessions ?? 4} /></label>
        )}
        {kind === 'balance' && (
          <label>Номинал THB<input name="initialBalance" type="number" min="1" required disabled={hasUsage} defaultValue={membership?.initialBalance ?? membership?.purchaseAmount ?? ''} /></label>
        )}
      </div>
      {!hasUsage && (
        <fieldset className="serviceScope">
          <legend>Разрешенные занятия</legend>
          <div>
            {Array.from(new Set(serviceTypes)).map((service) => (
              <label className="smallCheck" key={service}>
                <input
                  name="allowedServiceTypes"
                  type="checkbox"
                  value={service}
                  defaultChecked={membership?.allowedServiceTypes.includes(service) ?? true}
                />
                {service}
              </label>
            ))}
          </div>
        </fieldset>
      )}
      <label>Комментарий<textarea name="comment" rows={3} defaultValue={membership?.comment ?? ''} placeholder="Условия и важные детали" /></label>
      <button className="primaryButton wide" type="submit">{submitLabel}</button>
      {onDelete && !hasUsage && <button className="dangerButton wide" type="button" onClick={onDelete}>Удалить абонемент</button>}
    </form>
  )
}
