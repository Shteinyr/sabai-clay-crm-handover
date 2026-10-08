import { expect, test } from '@playwright/test'

function isoDateOffset(days: number) {
  const date = new Date()
  date.setDate(date.getDate() + days)
  return date.toISOString().slice(0, 10)
}

test('core mobile CRM flow works locally', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.addInitScript(() => window.localStorage.clear())
  await page.goto('/')
  await expect(page.getByRole('heading', { name: /Сегодня/ })).toBeVisible()
  const today = new Date().toISOString().slice(0, 10)

  await page.getByRole('button', { name: /Новая запись/ }).first().click()
  await page.getByLabel('Имя клиента').fill('Тест Сабай')
  await page.getByLabel('Телефон / WhatsApp').fill('66999999999')
  await page.getByRole('textbox', { name: 'Instagram' }).fill('instagram.com/sabai.clay')
  await expect(page.getByRole('link', { name: 'Открыть' })).toHaveAttribute('href', 'https://instagram.com/sabai.clay')
  await page.getByLabel('Дата').fill(today)
  await page.getByLabel('Время').fill('14:30')
  await page.getByLabel('Кол-во человек').fill('3')
  await page.getByLabel('Сумма THB').fill('1500')
  await page.getByRole('button', { name: 'Сохранить запись' }).click()

  await expect(page.getByText('Тест Сабай').first()).toBeVisible()
  const todayCard = page.locator('.appointmentCard').filter({ hasText: 'Тест Сабай' }).first()
  await todayCard.getByRole('button', { name: /Статус: Бронь/ }).click()
  await todayCard.getByRole('button', { name: 'Роспись после первого обжига', exact: true }).click()
  await expect(todayCard.getByRole('button', { name: /Статус: Роспись после первого обжига/ })).toBeVisible()
  await expect(todayCard.getByRole('link', { name: 'Instagram' })).toHaveAttribute('href', 'https://instagram.com/sabai.clay')
  await expect(todayCard.getByText('3 чел.')).toBeVisible()
  await expect(todayCard.getByText(/Готовность/)).toBeVisible()
  await todayCard.getByRole('button', { name: /Открыть запись: Тест Сабай/ }).click()
  await expect(page.getByRole('heading', { name: 'Редактировать запись' })).toBeVisible()
  await page.getByRole('button', { name: 'Закрыть' }).click()

  await page.getByRole('button', { name: 'Календарь' }).click()
  await expect(page.getByText('Тест Сабай').first()).toBeVisible()
  await expect(page.getByRole('button', { name: 'Сделки' })).toHaveCount(0)

  await page.getByRole('button', { name: 'Финансы' }).click()
  await page.getByRole('button', { name: 'Расход' }).click()
  await page.getByLabel('Сумма THB').fill('500')
  await page.getByLabel('Описание').fill('Тестовый расход')
  await page.getByRole('button', { name: 'Сохранить расход' }).click()
  await expect(page.getByText('Расходы').first()).toBeVisible()
  await page.getByRole('button', { name: /Редактировать расход: Тестовый расход/ }).click()
  await page.getByLabel('Сумма THB').fill('700')
  await page.getByLabel('Описание').fill('Исправленный расход')
  await page.getByRole('button', { name: 'Сохранить изменения' }).click()
  await expect(page.getByText('Исправленный расход')).toBeVisible()
  await expect(page.getByText('700 THB').first()).toBeVisible()
})

test('calendar readiness filter shows due soon and fresh overdue appointments', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.addInitScript(() => window.localStorage.clear())
  await page.goto('/')

  await page.getByRole('button', { name: /Новая запись/ }).first().click()
  await page.getByLabel('Имя клиента').fill('Скоро готово')
  await page.getByLabel('Дата').fill(isoDateOffset(-20))
  await page.getByLabel('Время').fill('11:00')
  await page.getByLabel('Сумма THB').fill('1200')
  await page.getByRole('button', { name: 'Сохранить запись' }).click()

  await page.getByRole('button', { name: /Новая запись/ }).first().click()
  await page.getByLabel('Имя клиента').fill('Старая готовность')
  await page.getByLabel('Дата').fill(isoDateOffset(-30))
  await page.getByLabel('Время').fill('12:00')
  await page.getByLabel('Сумма THB').fill('1200')
  await page.getByRole('button', { name: 'Сохранить запись' }).click()

  await page.getByRole('button', { name: 'Календарь' }).click()
  await page.getByRole('button', { name: 'Готовность', exact: true }).click()

  await expect(page.getByText('Скоро готово').first()).toBeVisible()
  await expect(page.getByText('Старая готовность')).toHaveCount(0)

  const readyCard = page.locator('.appointmentCard').filter({ hasText: 'Скоро готово' }).first()
  await readyCard.getByRole('button', { name: /Статус: Бронь/ }).click()
  await readyCard.getByRole('button', { name: 'Изделие выдано', exact: true }).click()
  await page.evaluate(() => {
    const storageKey = 'sabai-clay-crm-data-v2'
    const rawData = window.localStorage.getItem(storageKey)
    if (!rawData) return
    const data = JSON.parse(rawData)
    const appointment = data.appointments.find((item: { clientName: string }) => item.clientName === 'Скоро готово')
    if (!appointment) return
    appointment.status = 'Изделие выдано'
    const deal = data.deals.find((item: { appointmentId: string }) => item.appointmentId === appointment.id)
    if (deal) deal.status = 'Ожидание изделия'
    window.localStorage.setItem(storageKey, JSON.stringify(data))
  })
  await page.reload()
  await page.getByRole('button', { name: 'Календарь' }).click()
  await page.getByRole('button', { name: 'Все', exact: true }).click()
  await page.getByRole('button', { name: 'Готовность', exact: true }).click()
  await expect(page.getByText('Скоро готово')).toHaveCount(0)

  await page.getByRole('button', { name: 'Сегодня' }).first().click()
  await expect(page.getByRole('button', { name: /Просрочено/ })).toBeDisabled()
  await expect(page.getByText('Скоро готово')).toHaveCount(0)
})

test('calendar appointment can be edited and deleted', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.addInitScript(() => window.localStorage.clear())
  await page.goto('/')

  await page.getByRole('button', { name: /Новая запись/ }).first().click()
  await page.getByLabel('Имя клиента').fill('Редактируемый клиент')
  await page.getByLabel('Дата').fill('2026-05-20')
  await page.getByLabel('Время').fill('15:00')
  await page.getByLabel('Сумма THB').fill('1800')
  await page.getByRole('button', { name: 'Сохранить запись' }).click()

  await page.getByRole('button', { name: 'Календарь' }).click()
  await expect(page.getByText('Редактируемый клиент').first()).toBeVisible()
  const editableCard = page.locator('.appointmentCard').filter({ hasText: 'Редактируемый клиент' }).first()
  await editableCard.getByRole('button', { name: /Статус: Бронь/ }).click()
  await editableCard.getByRole('button', { name: 'Клиент оповещен', exact: true }).click()
  await expect(editableCard.getByRole('button', { name: /Статус: Клиент оповещен/ })).toBeVisible()

  await editableCard.getByRole('button', { name: /Открыть запись: Редактируемый клиент/ }).click()
  await page.getByLabel('Имя клиента').fill('Клиент после правки')
  await page.getByLabel('Сумма THB').fill('2100')
  await page.getByRole('button', { name: 'Сохранить изменения' }).click()

  await expect(page.getByText('Клиент после правки').first()).toBeVisible()
  await expect(page.getByText('2 100 THB').first()).toBeVisible()
  const updatedCard = page.locator('.appointmentCard').filter({ hasText: 'Клиент после правки' }).first()
  await updatedCard.getByRole('button', { name: /Открыть запись: Клиент после правки/ }).click()
  await page.getByRole('button', { name: 'Удалить запись' }).click()
  await expect(page.getByText('Клиент после правки')).toHaveCount(0)
})


test('guest master split is snapshotted and included in finance', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.addInitScript(() => window.localStorage.clear())
  await page.goto('/')

  await page.getByRole('button', { name: 'Еще', exact: true }).click()
  const mastersPanel = page.locator('.guestMastersPanel')
  await mastersPanel.getByRole('button', { name: 'Добавить' }).click()
  await page.getByLabel('Имя мастера').fill('Сомчай')
  await page.getByLabel('Базовая ставка').fill('50')
  await page.getByRole('button', { name: 'Добавить мастера' }).click()
  await expect(mastersPanel.getByText('Сомчай')).toBeVisible()
  await expect(mastersPanel.getByText('50%')).toBeVisible()

  await page.getByRole('button', { name: 'Новая запись' }).click()
  await page.getByLabel('Имя клиента').fill('Гость мастера 50')
  await page.getByLabel('Дата').fill(new Date().toISOString().slice(0, 10))
  await page.getByLabel('Сумма THB').fill('2400')
  await page.getByLabel('Кто проводит').selectOption({ label: 'Сомчай' })
  await expect(page.getByText('Студии').locator('..')).toContainText('1 200 THB')
  await page.getByRole('button', { name: 'Сохранить запись' }).click()

  const firstCard = page.locator('.appointmentCard').filter({ hasText: 'Гость мастера 50' }).first()
  await expect(firstCard.getByText('План: студии 1 200 THB · мастеру 1 200 THB')).toBeVisible()

  await page.getByRole('button', { name: 'Финансы' }).click()
  await expect(page.getByText('В этом месяце проведенных занятий с приглашенными мастерами нет.')).toBeVisible()

  await page.getByRole('button', { name: 'Сегодня' }).click()
  await firstCard.getByRole('button', { name: /Статус: Бронь/ }).click()
  await firstCard.getByRole('button', { name: 'Ожидание изделия', exact: true }).click()
  await expect(firstCard.getByText('В студию 1 200 THB · Мастеру 1 200 THB')).toBeVisible()

  await page.getByRole('button', { name: 'Еще', exact: true }).click()
  await mastersPanel.getByRole('button', { name: 'Редактировать мастера: Сомчай' }).click()
  await page.getByLabel('Базовая ставка').fill('40')
  await page.getByRole('button', { name: 'Сохранить изменения' }).click()

  await page.getByRole('button', { name: 'Сегодня' }).click()
  await expect(firstCard.getByText('В студию 1 200 THB · Мастеру 1 200 THB')).toBeVisible()

  await page.getByRole('button', { name: 'Новая запись' }).click()
  await page.getByLabel('Имя клиента').fill('Гость мастера 40')
  await page.getByLabel('Дата').fill(new Date().toISOString().slice(0, 10))
  await page.getByLabel('Сумма THB').fill('2400')
  await page.getByLabel('Кто проводит').selectOption({ label: 'Сомчай' })
  await expect(page.getByLabel('Ставка мастера')).toHaveValue('40')
  await page.getByRole('button', { name: 'Сохранить запись' }).click()

  const secondCard = page.locator('.appointmentCard').filter({ hasText: 'Гость мастера 40' }).first()
  await expect(secondCard.getByText('План: студии 1 440 THB · мастеру 960 THB')).toBeVisible()
  await secondCard.getByRole('button', { name: /Статус: Бронь/ }).click()
  await secondCard.getByRole('button', { name: 'Ожидание изделия', exact: true }).click()

  await page.getByRole('button', { name: 'Финансы' }).click()
  const guestReport = page.locator('.guestMasterFinanceCard').filter({ hasText: 'Сомчай' })
  await expect(guestReport).toContainText('2 занятия')
  await expect(guestReport).toContainText('4 800 THB')
  await expect(guestReport).toContainText('2 160 THB')
  await expect(guestReport).toContainText('2 640 THB')
  await expect(page.getByText('Доли приглашенных мастеров')).toBeVisible()

  await page.getByRole('button', { name: 'Еще', exact: true }).click()
  await mastersPanel.getByRole('button', { name: 'Редактировать мастера: Сомчай' }).click()
  await page.getByRole('button', { name: 'Архивировать мастера' }).click()
  await page.getByRole('button', { name: 'Закрыть' }).click()
  await expect(mastersPanel.getByText('В архиве')).toBeVisible()
  await page.getByRole('button', { name: 'Новая запись' }).click()
  await expect(page.getByLabel('Кто проводит').getByRole('option', { name: 'Сомчай' })).toHaveCount(0)
})


test('membership sale is counted once and visit redeems package once', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.addInitScript(() => window.localStorage.clear())
  await page.goto('/')

  await page.getByRole('button', { name: 'Еще', exact: true }).click()
  const membershipsPanel = page.locator('.membershipsPanel')
  await membershipsPanel.getByRole('button', { name: 'Добавить' }).click()
  await page.getByLabel('Название').fill('Детская лепка')
  await page.getByLabel('Имя клиента').fill('Ребенок по абонементу')
  await page.getByLabel('Оплата THB').fill('3900')
  await page.getByLabel('Количество занятий').fill('4')
  await page.getByRole('button', { name: 'Продать абонемент' }).click()

  const membershipCard = membershipsPanel.locator('.membershipCard').filter({ hasText: 'Детская лепка' })
  await expect(membershipCard).toContainText('Осталось 4 из 4')
  await expect(membershipCard).toContainText('3 900 THB')

  await page.getByRole('button', { name: 'Новая запись' }).click()
  await page.getByRole('button', { name: 'Абонемент', exact: true }).click()
  await expect(page.getByLabel('Имя клиента')).toHaveValue('Ребенок по абонементу')
  await expect(page.getByLabel('Стоимость занятия')).toHaveValue('975')
  await page.getByLabel('Дата').fill(new Date().toISOString().slice(0, 10))
  await page.getByRole('button', { name: 'Сохранить запись' }).click()

  const appointmentCard = page.locator('.appointmentCard').filter({ hasText: 'Ребенок по абонементу' }).first()
  await expect(appointmentCard).toContainText('Осталось 4 из 4')
  await appointmentCard.getByRole('button', { name: /Статус: Бронь/ }).click()
  await appointmentCard.getByRole('button', { name: 'Ожидание изделия', exact: true }).click()
  await expect(appointmentCard).toContainText('Осталось 3 из 4')

  await page.getByRole('button', { name: 'Финансы' }).click()
  const membershipFinance = page.locator('.membershipFinancePanel')
  await expect(membershipFinance).toContainText('Получено')
  await expect(membershipFinance).toContainText('3 900 THB')
  await expect(membershipFinance).toContainText('Посещений')
  await expect(membershipFinance).toContainText('1')
  await expect(membershipFinance).toContainText('2 925 THB')

  await page.getByRole('button', { name: 'Сегодня' }).click()
  await appointmentCard.getByRole('button', { name: /Статус: Ожидание изделия/ }).click()
  await appointmentCard.getByRole('button', { name: 'Бронь', exact: true }).click()
  await expect(appointmentCard).toContainText('Осталось 4 из 4')

  await page.getByRole('button', { name: 'Финансы' }).click()
  await expect(membershipFinance).toContainText('Посещений')
  await expect(membershipFinance).toContainText('0')
  await expect(membershipFinance).toContainText('3 900 THB')
})
