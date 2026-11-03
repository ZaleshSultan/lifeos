/** Stable public codes only; raw backend/provider diagnostics never become product copy. */
export function captureErrorMessage(
  code: string | undefined,
  status?: number,
): string | null {
  if (code === "capture_disabled" || code === "capture_unavailable")
    return "Входящие временно недоступны. Существующие данные LifeOS сохранены.";
  if (code?.includes("expired"))
    return "Время просмотра истекло. Обнови разбор, снова проверь предложения и выбери действия.";
  if (
    code === "capture_permission_denied" ||
    code === "capture_action_permission_denied" ||
    code === "assistant_permission_denied"
  )
    return "Это действие выключено текущими правилами сервера. Запись сохранена; выбери разрешённые действия.";
  if (status === 409 || code?.includes("conflict"))
    return "Запись или задача изменилась. Твои правки остаются на экране; обнови текущую версию перед новым подтверждением.";
  if (
    code === "capture_invalid_request" ||
    code === "capture_invalid_input" ||
    status === 400
  )
    return "Проверь поля, дату и выбранные действия. Секреты и неподдерживаемые команды не выполняются.";
  if (status === 404)
    return "Запись не найдена или недоступна этому аккаунту. Обнови историю.";
  if (code?.includes("sensitive") || code?.includes("credential"))
    return "Пароли, cookies и ключи доступа нельзя сохранять в захватах или памяти. Убери секретные данные.";
  if (status === 429)
    return "Достигнут предел обработки. Подожди перед безопасной повторной попыткой.";
  if (status === 503)
    return "Обработка временно недоступна. Исходная запись сохранена, если сервер уже принял её; обнови историю перед новым запросом.";
  return null;
}
