export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function apiErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    let code: unknown;
    try {
      const body: unknown = JSON.parse(error.message);
      if (body && typeof body === "object" && "error" in body)
        code = body.error;
    } catch {
      // Backend details and proxy HTML must not become user-facing messages.
    }
    if (code === "telegram_user_not_linked")
      return "Откройте бота и выполните /start, затем откройте LifeOS снова.";
    if (code === "telegram_user_pending")
      return "Заявка ожидает одобрения. После одобрения откройте LifeOS снова.";
    if (code === "telegram_user_blocked")
      return "Доступ к LifeOS заблокирован. Обратитесь к администратору.";
    if (code === "daily_life_conflict" || code === "ideal_human_conflict")
      return "Запись изменилась в другой сессии. Загрузите сохранённую версию и повторите правки.";
    if (code === "meal_draft_expired")
      return "Черновик фото истёк. Выберите фото заново или запишите еду вручную.";
    if (code === "meal_vision_unavailable")
      return "Фотоанализ пока не подключён. Запишите еду вручную в дневнике.";
    if (code === "invalid_daily_life_input" || code === "invalid_meal_analysis")
      return "Проверьте введённые значения и формат фото. Изменения не сохранены.";
    if (code === "record_not_found")
      return "Запись больше недоступна. Обновите экран.";
    if (
      typeof code === "string" &&
      code.startsWith("ai_") &&
      error.status === 429
    )
      return "Достигнут лимит AI. Еду можно записать вручную; автоматического повтора не будет.";
    if (error.status === 401 || error.status === 403)
      return "Откройте LifeOS заново из Telegram, чтобы обновить доступ.";
    if (code === "database_not_configured" || error.status === 503)
      return "Сервис временно недоступен. Попробуйте немного позже.";
    if (error.status === 429)
      return "Слишком много запросов. Подождите немного и повторите попытку.";
  }
  return "Проверьте подключение и повторите попытку.";
}
