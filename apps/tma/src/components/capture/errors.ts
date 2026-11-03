/** Stable public codes only; raw backend/provider diagnostics never become product copy. */
export function captureErrorMessage(
  code: string | undefined,
  status?: number,
): string | null {
  if (code === "capture_correction_unclear") return "Не удалось однозначно понять уточнение. Укажи одно неподтверждённое предложение или измени его поля вручную. Текст сохранён на экране.";
  if (code === "capture_model_fallback") return "Внешний AI-разбор не завершился. Предложения подготовлены правилами LifeOS; проверь их перед подтверждением.";
  if (code === "voice_reference_expired")
    return "Срок доступа к аудио истёк. Исходная запись сохранена; введи текст вручную или отправь голос заново.";
  if (
    code === "voice_consent_required" ||
    code === "capture_external_consent_required"
  )
    return "Для внешней обработки нужно отдельное согласие и разрешённые настройки провайдера. Можно продолжить вручную.";
  if (
    code === "voice_transcription_unavailable" ||
    code === "transcription_unavailable" ||
    code === "capture_model_unavailable" ||
    code === "capture_external_unavailable"
  )
    return "Автоматическая обработка недоступна. Исходная запись сохранена; добавь или уточни текст вручную.";
  if (code === "voice_unsupported" || code === "voice_too_large")
    return "Голосовая запись не подходит для обработки. Добавь текст вручную или отправь поддерживаемую запись до 120 секунд и 5 МиБ.";
  if (code === "voice_quota_exceeded" || code === "ai_quota_exceeded")
    return "Достигнут лимит внешней обработки. Автоматического повтора нет; текст можно добавить вручную.";
  if (
    code === "voice_download_timeout" ||
    code === "voice_transcription_timeout" ||
    code === "voice_download_failed" ||
    code === "voice_download_origin_rejected" ||
    code === "voice_transcription_failed" ||
    code === "voice_empty_transcript"
  )
    return "Не удалось получить надёжную расшифровку. Исходная запись сохранена; добавь текст вручную или проверь состояние перед повтором.";
  if (code === "voice_cancelled")
    return "Обработка остановлена. Исходная запись сохранена, доступен ручной ввод текста.";
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
