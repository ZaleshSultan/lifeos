export class WebApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}
export async function webRequest<T>(
  resource: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(`/web/api/bridge/${resource}`, {
    ...options,
    credentials: "same-origin",
    cache: "no-store",
    headers: { "content-type": "application/json", ...options.headers },
  });
  if (
    response.redirected ||
    (!response.headers.get("content-type")?.includes("application/json") &&
      response.status !== 204)
  )
    throw new WebApiError(401, "invalid_web_session");
  if (response.status === 204) return undefined as T;
  const body = (await response.json().catch(() => null)) as {
    data?: T;
    error?: string;
  } | null;
  if (!response.ok)
    throw new WebApiError(response.status, body?.error ?? "request_failed");
  return body && "data" in body ? (body.data as T) : (body as T);
}
export function webErrorMessage(error: unknown): string {
  if (error instanceof WebApiError) {
    if (error.status === 401 || error.status === 403)
      return "Доступ истёк или отозван. Открой новый вход командой /web в Telegram.";
    if (error.status === 409)
      return "Запись изменилась в другом окне. Обнови сохранённую версию перед повторным сохранением.";
    if (error.status === 400)
      return "Проверь введённые значения и дату. Пустые поля можно не заполнять.";
    if (error.status === 429)
      return "Достигнут лимит запросов. Подожди перед повторной попыткой.";
    if (error.status === 404)
      return "Этот модуль временно недоступен. Существующие данные сохранены.";
  }
  return "Сервис временно недоступен. Проверь соединение и повтори попытку.";
}
