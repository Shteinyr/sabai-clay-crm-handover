export async function collectReportPages<T extends Record<string, unknown>>(
  fetchPage: (from: number, to: number) => Promise<{ rows: T[]; count: number | null }>,
  verifyCount: () => Promise<number | null>,
  pageSize = 500,
) {
  const rows: T[] = []
  let expectedCount: number | null = null

  while (expectedCount === null || rows.length < expectedCount) {
    const page = await fetchPage(rows.length, rows.length + pageSize - 1)
    if (page.count == null) throw new Error('Не удалось проверить полноту данных.')
    if (expectedCount !== null && page.count !== expectedCount) {
      throw new Error('Данные изменились во время подготовки отчёта. Повторите выгрузку.')
    }
    expectedCount = page.count
    if (!page.rows.length && rows.length < expectedCount) {
      throw new Error('Получены не все данные. Повторите выгрузку.')
    }
    rows.push(...page.rows)
  }

  const ids = new Set(rows.map((row) => String(row.id ?? '')))
  if (rows.length !== expectedCount || ids.size !== rows.length) {
    throw new Error('Получены неполные или повторяющиеся данные. Повторите выгрузку.')
  }
  if (await verifyCount() !== expectedCount) {
    throw new Error('Данные изменились во время подготовки отчёта. Повторите выгрузку.')
  }
  return rows
}
